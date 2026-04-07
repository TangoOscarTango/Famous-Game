import { authenticateRequest, badRequest, corsHeaders, createServiceClient, ok, safeJson, serverError, unauthorized } from '../_shared/common.ts';

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: corsHeaders });
  if (req.method !== 'POST') return badRequest('Method not allowed');

  try {
    const user = await authenticateRequest(req);
    const body = await safeJson(req);
    const alias = typeof body.alias === 'string' ? body.alias : null;
    const service = createServiceClient();

    const { data, error } = await service.rpc('wallet_set_alias', {
      p_user_id: user.id,
      p_alias: alias,
    });

    if (error) return serverError('Failed to update wallet alias', error.message);
    return ok({ state: data });
  } catch (error: any) {
    if (String(error?.message || '').includes('Unauthorized')) return unauthorized();
    return serverError('Unexpected wallet-alias error', error?.message || error);
  }
});
