import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
};

const getEnv = (name: string): string => {
  const value = Deno.env.get(name);
  if (!value) throw new Error(`Missing environment variable: ${name}`);
  return value;
};

const createAuthClient = (authHeader: string | null) => {
  const supabaseUrl = getEnv('SUPABASE_URL');
  const supabaseAnonKey = getEnv('SUPABASE_ANON_KEY');
  return createClient(supabaseUrl, supabaseAnonKey, {
    auth: { persistSession: false, autoRefreshToken: false },
    global: { headers: { Authorization: authHeader ?? '' } },
  });
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
  const authClient = createAuthClient(authHeader);
  const { data, error } = await authClient.auth.getUser();
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

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: corsHeaders });
  if (req.method !== 'POST') return json(400, { error: 'Method not allowed' });

  try {
    const user = await authenticateRequest(req);
    const body = await safeJson(req);
    const alias = typeof body.alias === 'string' ? body.alias : null;
    const service = createServiceClient();

    const { data, error } = await service.rpc('wallet_set_alias', {
      p_user_id: user.id,
      p_alias: alias,
    });

    if (error) return json(500, { error: 'Failed to update wallet alias', details: error.message });
    return json(200, { state: data });
  } catch (error: any) {
    if (String(error?.message || '').includes('Unauthorized')) return json(401, { error: 'Unauthorized' });
    return json(500, { error: 'Unexpected wallet-alias error', details: error?.message || error });
  }
});
