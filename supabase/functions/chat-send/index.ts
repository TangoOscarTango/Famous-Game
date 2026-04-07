import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';

const COOLDOWN_MS = 10_000;
const MAX_MESSAGE_LENGTH = 280;
const COOLDOWN_BYPASS_COST_SATS = 1;

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers':
    'authorization, x-client-info, apikey, content-type, x-supabase-client-platform, x-supabase-client-version, x-supabase-api-version',
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
  try {
    return await req.json();
  } catch {
    return {};
  }
};

const json = (status: number, body: unknown) =>
  new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders, 'Content-Type': 'application/json' },
  });

const resolveExport = (mod: any, name: string): any => {
  const candidates = [mod, mod?.default, mod?.default?.default, mod?.module, mod?.module?.default];
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
  if (typeof CashuMint !== 'function' || typeof CashuWallet !== 'function') {
    throw new Error(`cashu-ts exports unavailable in edge runtime: ${Object.keys(mod || {}).join(',')}`);
  }
  return { CashuMint, CashuWallet };
};

const assertUnspentProofs = async (wallet: any, proofs: any[]) => {
  const states = await wallet.checkProofsStates(proofs);
  const hasBadState = states.some((state) => state.state !== 'UNSPENT');
  if (hasBadState) throw new Error('Mint rejected generated proofs as invalid.');
};

const getCooldownRemainingMs = async (service: ReturnType<typeof createServiceClient>, userId: string) => {
  const { data, error } = await service
    .from('chat_messages')
    .select('created_at')
    .eq('user_id', userId)
    .order('created_at', { ascending: false })
    .limit(1)
    .maybeSingle();

  if (error) throw error;
  if (!data?.created_at) return 0;

  const last = new Date(data.created_at).getTime();
  const remaining = last + COOLDOWN_MS - Date.now();
  return remaining > 0 ? remaining : 0;
};

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: corsHeaders });
  if (req.method !== 'POST') return json(400, { error: 'Method not allowed' });

  let requestId = crypto.randomUUID();
  let userId: string | null = null;
  let feeReserved = false;

  try {
    const user = await authenticateRequest(req);
    userId = user.id;

    const body = await safeJson(req);
    const rawMessage = String(body.message ?? '');
    const message = rawMessage.trim();
    const payToBypassCooldown = Boolean(body.payToBypassCooldown);

    if (!message) return json(400, { error: 'Message cannot be empty.' });
    if (message.length > MAX_MESSAGE_LENGTH) {
      return json(400, { error: `Message exceeds max length (${MAX_MESSAGE_LENGTH}).` });
    }

    const service = createServiceClient();
    const cooldownRemainingMs = await getCooldownRemainingMs(service, user.id);

    let chargedSats = 0;
    let state: unknown = null;

    if (cooldownRemainingMs > 0) {
      if (!payToBypassCooldown) {
        return json(429, {
          error: 'Cooldown active.',
          cooldownRemainingMs,
          cooldownSeconds: Math.ceil(cooldownRemainingMs / 1000),
          bypassCostFp: COOLDOWN_BYPASS_COST_SATS,
        });
      }

      requestId = typeof body.requestId === 'string' ? body.requestId : requestId;

      const { data: reservation, error: reserveError } = await service.rpc('wallet_reserve_withdraw', {
        p_user_id: user.id,
        p_request_id: requestId,
        p_amount_sats: COOLDOWN_BYPASS_COST_SATS,
      });

      if (reserveError) return json(400, { error: reserveError.message });
      if (!Array.isArray(reservation) || reservation.length === 0) {
        return json(400, { error: 'No reserve data returned for cooldown fee.' });
      }

      feeReserved = true;

      const row = reservation[0];
      const mintUrl = row.mint_url as string;
      const reservedProofs = (row.proofs as any[]) ?? [];

      const { CashuMint, CashuWallet } = await loadCashu();
      const mint = new CashuMint(mintUrl);
      const wallet = new CashuWallet(mint, { unit: 'sat' });
      await wallet.loadMint();

      const { keep, send } = await wallet.send(COOLDOWN_BYPASS_COST_SATS, reservedProofs);
      await assertUnspentProofs(wallet, keep);
      await assertUnspentProofs(wallet, send);

      const keepPayload = keep.map((proof) => ({
        id: proof.id,
        amount: proof.amount,
        secret: proof.secret,
        C: proof.C,
        dleq: proof.dleq ?? null,
        witness: proof.witness ?? null,
      }));

      const { data: feeState, error: finalizeError } = await service.rpc('wallet_finalize_fee', {
        p_user_id: user.id,
        p_request_id: requestId,
        p_mint_url: mintUrl,
        p_amount_sats: COOLDOWN_BYPASS_COST_SATS,
        p_keep_proofs: keepPayload,
        p_note: 'Cooldown bypass fee',
      });

      if (finalizeError) {
        await service.rpc('wallet_release_withdraw', {
          p_user_id: user.id,
          p_request_id: requestId,
          p_error: finalizeError.message,
        });
        return json(500, { error: 'Failed to process cooldown fee', details: finalizeError.message });
      }

      feeReserved = false;
      chargedSats = COOLDOWN_BYPASS_COST_SATS;
      state = feeState;
    }

    const { data: inserted, error: insertError } = await service
      .from('chat_messages')
      .insert({
        user_id: user.id,
        message,
      })
      .select('id, user_id, display_name, message, created_at')
      .single();

    if (insertError) {
      return json(500, { error: 'Failed to save message', details: insertError.message });
    }

    const nextPostAt = new Date(new Date(inserted.created_at).getTime() + COOLDOWN_MS).toISOString();

    return json(200, {
      message: 'Message sent.',
      record: inserted,
      chargedSats,
      cooldownMs: COOLDOWN_MS,
      nextPostAt,
      state,
    });
  } catch (error: any) {
    if (feeReserved && userId) {
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
    return json(500, { error: 'Unexpected chat-send error', details: error?.message || error });
  }
});
