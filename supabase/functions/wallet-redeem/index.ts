import { CashuMint, CashuWallet, getDecodedToken, type Proof } from 'npm:@cashu/cashu-ts';
import {
  authenticateRequest,
  badRequest,
  corsHeaders,
  createServiceClient,
  ok,
  safeJson,
  serverError,
  unauthorized,
} from '../_shared/common.ts';

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

const receiveWithFallback = async (wallet: CashuWallet, token: string): Promise<{ proofs: Proof[]; usedDleq: boolean }> => {
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

const assertUnspentProofs = async (wallet: CashuWallet, proofs: Proof[]) => {
  const states = await wallet.checkProofsStates(proofs);
  const hasBadState = states.some((state) => state.state !== 'UNSPENT');
  if (hasBadState) throw new Error('Mint rejected one or more proofs as spent or invalid.');
};

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: corsHeaders });
  if (req.method !== 'POST') return badRequest('Method not allowed');

  try {
    const user = await authenticateRequest(req);
    const body = await safeJson(req);
    const rawToken = typeof body.token === 'string' ? body.token : '';
    const requestId = typeof body.requestId === 'string' ? body.requestId : crypto.randomUUID();
    const note = typeof body.note === 'string' ? body.note : null;

    if (!rawToken.trim()) return badRequest('Token is required');

    const token = normalizeCashuToken(rawToken);
    const decoded = getDecodedToken(token);
    if (!decoded?.mint) return badRequest('Token does not contain a mint URL');
    if (!isMintAllowed(decoded.mint)) return badRequest('Mint is not in trusted allowlist');

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

    if (error) return serverError('Failed to persist redeem', error.message);

    return ok({
      message: `Redeemed token from ${decoded.mint}.`,
      state,
      usedDleq,
    });
  } catch (error: any) {
    if (String(error?.message || '').includes('Unauthorized')) return unauthorized();
    return serverError('Unexpected wallet-redeem error', error?.message || error);
  }
});
