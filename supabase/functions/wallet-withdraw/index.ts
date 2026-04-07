import { CashuMint, CashuWallet, getEncodedTokenV4, type Proof } from 'npm:@cashu/cashu-ts';
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

const assertUnspentProofs = async (wallet: CashuWallet, proofs: Proof[]) => {
  const states = await wallet.checkProofsStates(proofs);
  const hasBadState = states.some((state) => state.state !== 'UNSPENT');
  if (hasBadState) throw new Error('Mint rejected generated proofs as invalid.');
};

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: corsHeaders });
  if (req.method !== 'POST') return badRequest('Method not allowed');

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
      return badRequest('amountSats must be a positive number');
    }

    const service = createServiceClient();
    const { data: reservation, error: reserveError } = await service.rpc('wallet_reserve_withdraw', {
      p_user_id: user.id,
      p_request_id: requestId,
      p_amount_sats: Math.floor(amountSats),
    });

    if (reserveError) return badRequest(reserveError.message);
    if (!Array.isArray(reservation) || reservation.length === 0) {
      return badRequest('No reserve data returned.');
    }

    const row = reservation[0];
    const mintUrl = row.mint_url as string;
    const reservedProofs = (row.proofs as Proof[]) ?? [];
    const requestedAmount = Math.floor(amountSats);

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
      return serverError('Failed to finalize withdrawal', finalizeError.message);
    }

    return ok({
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

    if (String(error?.message || '').includes('Unauthorized')) return unauthorized();
    return serverError('Unexpected wallet-withdraw error', error?.message || error);
  }
});
