import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';

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

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: corsHeaders });
  if (req.method !== 'POST') return json(400, { error: 'Method not allowed' });

  try {
    const user = await authenticateRequest(req);
    const body = await safeJson(req);
    const channelSlug = String(body.channelSlug || 'global');
    const message = String(body.message || '');

    const service = createServiceClient();
    const { data, error } = await service.rpc('chat_send_message', {
      p_user_id: user.id,
      p_channel_slug: channelSlug,
      p_body: message,
    });

    if (error) {
      return json(400, { error: error.message });
    }

    return json(200, { message: 'Sent', record: data });
  } catch (error: any) {
    if (String(error?.message || '').includes('Unauthorized')) return json(401, { error: 'Unauthorized' });
    return json(500, { error: 'Unexpected chat-dock-send error', details: error?.message || error });
  }
});
