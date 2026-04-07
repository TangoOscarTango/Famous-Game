import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type, x-supabase-client-platform, x-supabase-client-version, x-supabase-api-version',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
};

const getEnv = (name: string): string => {
  const value = Deno.env.get(name);
  if (!value) throw new Error(`Missing environment variable: ${name}`);
  return value;
};

const createServiceClient = () => {
  const supabaseUrl = getEnv('SUPABASE_URL');
  const serviceRoleKey = getEnv('SUPABASE_SERVICE_ROLE_KEY');
  return createClient(supabaseUrl, serviceRoleKey, {
    auth: { persistSession: false, autoRefreshToken: false },
  });
};

const authenticateRequest = async (req: Request) => {
  const authHeader = req.headers.get('Authorization');
  const token = authHeader?.replace(/^Bearer\s+/i, '').trim();
  if (!token) throw new Error('Unauthorized');

  const service = createServiceClient();
  const { data, error } = await service.auth.getUser(token);
  if (error || !data?.user) throw new Error('Unauthorized');
  return data.user;
};

const safeJson = async (req: Request) => {
  try { return await req.json(); } catch { return {}; }
};

const json = (status: number, body: unknown) =>
  new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders, 'Content-Type': 'application/json' },
  });

const getTrustedMintList = (): string[] =>
  (Deno.env.get('CASHU_TRUSTED_MINTS') || '')
    .split(',')
    .map((value) => value.trim())
    .filter(Boolean);

const isMintAllowed = (mintUrl: string): boolean => {
  const trusted = getTrustedMintList();
  if (trusted.length === 0) return true;
  return trusted.includes(mintUrl);
};

const normalizeCashuToken = (token: string): string => token.trim().replace(/^cashu:/i, '');

const receiveWithFallback = async (wallet: any, token: string): Promise<{ proofs: any[]; usedDleq: boolean }> => {
  try {
    const proofs = await wallet.receive(token, { requireDleq: true });
    return { proofs, usedDleq: true };
  } catch (strictError: any) {
    const message = String(strictError?.message || '');
    if (!message.toLowerCase().includes('dleq')) throw strictError;
    const proofs = await wallet.receive(token, { requireDleq: false });
    return { proofs, usedDleq: false };
  }
};

const assertUnspentProofs = async (wallet: any, proofs: any[]) => {
  const states = await wallet.checkProofsStates(proofs);
  const hasBadState = states.some((state) => state.state !== 'UNSPENT');
  if (hasBadState) throw new Error('Mint rejected one or more proofs as spent or invalid.');
};

const resolveExport = (mod: any, name: string): any => {
  const candidates = [
    mod,
    mod?.default,
    mod?.default?.default,
    mod?.module,
    mod?.module?.default,
  ];

  for (const candidate of candidates) {
    const value = candidate?.[name];
    if (value) return value;
  }

  return undefined;
};

const loadCashu = async () => {
  const mod: any = await import('npm:@cashu/cashu-ts');
  const CashuMint = resolveExport(mod, 'CashuMint');
  const CashuWallet = resolveExport(mod, 'CashuWallet');
  const getDecodedToken = resolveExport(mod, 'getDecodedToken');

  if (typeof CashuMint !== 'function' || typeof CashuWallet !== 'function' || typeof getDecodedToken !== 'function') {
    throw new Error(`cashu-ts exports unavailable in edge runtime: ${Object.keys(mod || {}).join(',')}`);
  }

  return { CashuMint, CashuWallet, getDecodedToken };
};

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: corsHeaders });
  if (req.method !== 'POST') return json(400, { error: 'Method not allowed' });

  try {
    const user = await authenticateRequest(req);
    const body = await safeJson(req);
    const rawToken = typeof body.token === 'string' ? body.token : '';
    const requestId = typeof body.requestId === 'string' ? body.requestId : crypto.randomUUID();
    const note = typeof body.note === 'string' ? body.note : null;

    if (!rawToken.trim()) return json(400, { error: 'Token is required' });

    const token = normalizeCashuToken(rawToken);
    const { CashuMint, CashuWallet, getDecodedToken } = await loadCashu();
    const decoded = getDecodedToken(token);
    if (!decoded?.mint) return json(400, { error: 'Token does not contain a mint URL' });
    if (!isMintAllowed(decoded.mint)) return json(400, { error: 'Mint is not in trusted allowlist' });

    const mint = new CashuMint(decoded.mint);
    const wallet = new CashuWallet(mint, { unit: 'sat' });
    await wallet.loadMint();

    const { proofs, usedDleq } = await receiveWithFallback(wallet, token);
    await assertUnspentProofs(wallet, proofs);

    const service = createServiceClient();
    const proofsPayload = proofs.map((proof) => ({
      id: proof.id,
      amount: proof.amount,
      secret: proof.secret,
      C: proof.C,
      dleq: proof.dleq ?? null,
      witness: proof.witness ?? null,
    }));

    const { data: state, error } = await service.rpc('wallet_record_redeem', {
      p_user_id: user.id,
      p_request_id: requestId,
      p_mint_url: decoded.mint,
      p_proofs: proofsPayload,
      p_note: note ?? (usedDleq ? null : `Redeem from ${decoded.mint} (mint-state verified)`),
    });

    if (error) return json(500, { error: 'Failed to persist redeem', details: error.message });

    return json(200, {
      message: `Redeemed token from ${decoded.mint}.`,
      state,
      usedDleq,
    });
  } catch (error: any) {
    if (String(error?.message || '').includes('Unauthorized')) return json(401, { error: 'Unauthorized' });
    return json(500, { error: 'Unexpected wallet-redeem error', details: error?.message || error });
  }
});
