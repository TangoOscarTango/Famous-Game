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

const assertUnspentProofs = async (wallet: any, proofs: any[]) => {
  const states = await wallet.checkProofsStates(proofs);
  const hasBadState = states.some((state) => state.state !== 'UNSPENT');
  if (hasBadState) throw new Error('Mint rejected generated proofs as invalid.');
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
  const CashuMint = resolveExport(mod, 'CashuMint') ?? resolveExport(mod, 'Mint');
  const CashuWallet = resolveExport(mod, 'CashuWallet') ?? resolveExport(mod, 'Wallet');
  const getEncodedTokenV4 = resolveExport(mod, 'getEncodedTokenV4');

  if (typeof CashuMint !== 'function' || typeof CashuWallet !== 'function' || typeof getEncodedTokenV4 !== 'function') {
    throw new Error(`cashu-ts exports unavailable in edge runtime: ${Object.keys(mod || {}).join(',')}`);
  }

  return { CashuMint, CashuWallet, getEncodedTokenV4 };
};

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: corsHeaders });
  if (req.method !== 'POST') return json(400, { error: 'Method not allowed' });

  let requestId = crypto.randomUUID();
  let userId: string | null = null;

  try {
    const user = await authenticateRequest(req);
    userId = user.id;

    const body = await safeJson(req);
    requestId = typeof body.requestId === 'string' ? body.requestId : requestId;
    const note = typeof body.note === 'string' ? body.note : null;
    const amountSats = Number(body.amountSats);

    if (!Number.isFinite(amountSats) || amountSats <= 0) {
      return json(400, { error: 'amountSats must be a positive number' });
    }

    const service = createServiceClient();
    const { data: reservation, error: reserveError } = await service.rpc('wallet_reserve_withdraw', {
      p_user_id: user.id,
      p_request_id: requestId,
      p_amount_sats: Math.floor(amountSats),
    });

    if (reserveError) return json(400, { error: reserveError.message });
    if (!Array.isArray(reservation) || reservation.length === 0) {
      return json(400, { error: 'No reserve data returned.' });
    }

    const row = reservation[0];
    const mintUrl = row.mint_url as string;
    const reservedProofs = (row.proofs as any[]) ?? [];
    const requestedAmount = Math.floor(amountSats);

    const { CashuMint, CashuWallet, getEncodedTokenV4 } = await loadCashu();
    const mint = new CashuMint(mintUrl);
    const wallet = new CashuWallet(mint, { unit: 'sat' });
    await wallet.loadMint();

    const { keep, send } = await wallet.send(requestedAmount, reservedProofs);
    await assertUnspentProofs(wallet, keep);
    await assertUnspentProofs(wallet, send);

    const token = getEncodedTokenV4({ mint: mintUrl, proofs: send });

    const keepPayload = keep.map((proof) => ({
      id: proof.id,
      amount: proof.amount,
      secret: proof.secret,
      C: proof.C,
      dleq: proof.dleq ?? null,
      witness: proof.witness ?? null,
    }));

    const { data: state, error: finalizeError } = await service.rpc('wallet_finalize_withdraw', {
      p_user_id: user.id,
      p_request_id: requestId,
      p_mint_url: mintUrl,
      p_amount_sats: requestedAmount,
      p_keep_proofs: keepPayload,
      p_note: note,
    });

    if (finalizeError) {
      await service.rpc('wallet_release_withdraw', {
        p_user_id: user.id,
        p_request_id: requestId,
        p_error: finalizeError.message,
      });
      return json(500, { error: 'Failed to finalize withdrawal', details: finalizeError.message });
    }

    return json(200, {
      message: `Created ${requestedAmount} FP withdrawal token.`,
      token,
      mintUrl,
      amountSats: requestedAmount,
      state,
    });
  } catch (error: any) {
    if (userId) {
      try {
        const service = createServiceClient();
        await service.rpc('wallet_release_withdraw', {
          p_user_id: userId,
          p_request_id: requestId,
          p_error: String(error?.message || error),
        });
      } catch {
        // Best effort release.
      }
    }

    if (String(error?.message || '').includes('Unauthorized')) return json(401, { error: 'Unauthorized' });
    return json(500, { error: 'Unexpected wallet-withdraw error', details: error?.message || error });
  }
});
