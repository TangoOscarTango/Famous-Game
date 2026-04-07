import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';

export const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
};

const getEnv = (name: string): string => {
  const value = Deno.env.get(name);
  if (!value) throw new Error(`Missing environment variable: ${name}`);
  return value;
};

export const createAuthClient = (authHeader: string | null) => {
  const supabaseUrl = getEnv('SUPABASE_URL');
  const supabaseAnonKey = getEnv('SUPABASE_ANON_KEY');

  return createClient(supabaseUrl, supabaseAnonKey, {
    auth: { persistSession: false, autoRefreshToken: false },
    global: { headers: { Authorization: authHeader ?? '' } },
  });
};

export const createServiceClient = () => {
  const supabaseUrl = getEnv('SUPABASE_URL');
  const serviceRoleKey = getEnv('SUPABASE_SERVICE_ROLE_KEY');

  return createClient(supabaseUrl, serviceRoleKey, {
    auth: { persistSession: false, autoRefreshToken: false },
  });
};

export const authenticateRequest = async (req: Request) => {
  const authHeader = req.headers.get('Authorization');
  const authClient = createAuthClient(authHeader);
  const { data, error } = await authClient.auth.getUser();
  if (error || !data?.user) {
    throw new Error('Unauthorized');
  }
  return data.user;
};

export const safeJson = async (req: Request) => {
  try {
    return await req.json();
  } catch {
    return {};
  }
};

export const ok = (data: unknown) =>
  new Response(JSON.stringify(data), {
    status: 200,
    headers: { ...corsHeaders, 'Content-Type': 'application/json' },
  });

export const badRequest = (message: string, details?: unknown) =>
  new Response(JSON.stringify({ error: message, details }), {
    status: 400,
    headers: { ...corsHeaders, 'Content-Type': 'application/json' },
  });

export const unauthorized = () =>
  new Response(JSON.stringify({ error: 'Unauthorized' }), {
    status: 401,
    headers: { ...corsHeaders, 'Content-Type': 'application/json' },
  });

export const serverError = (message: string, details?: unknown) =>
  new Response(JSON.stringify({ error: message, details }), {
    status: 500,
    headers: { ...corsHeaders, 'Content-Type': 'application/json' },
  });
