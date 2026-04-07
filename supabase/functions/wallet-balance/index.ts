import { authenticateRequest, badRequest, corsHeaders, createServiceClient, ok, serverError, unauthorized } from '../_shared/common.ts';

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: corsHeaders });
  if (req.method !== 'POST') return badRequest('Method not allowed');

  try {
    const user = await authenticateRequest(req);
    const service = createServiceClient();

    const { data, error } = await service.rpc('wallet_get_state', {
      p_user_id: user.id,
      p_ledger_limit: 100,
    });

    if (error) return serverError('Failed to load wallet state', error.message);
    return ok({ state: data });
  } catch (error: any) {
    if (String(error?.message || '').includes('Unauthorized')) return unauthorized();
    return serverError('Unexpected wallet-balance error', error?.message || error);
  }
});
