/**
 * save-credentials
 *
 * Accepts per-user platform credentials from the browser, encrypts password
 * fields with AES-GCM, and upserts to the appropriate credentials table.
 *
 * Required Supabase Edge Function secrets:
 *   SUPABASE_URL                — auto-injected
 *   SUPABASE_ANON_KEY           — auto-injected (for user auth)
 *   SUPABASE_SERVICE_ROLE_KEY   — auto-injected (for DB write)
 *   CREDENTIALS_ENCRYPTION_KEY  — base64-encoded 32-byte AES key
 */
import { serve } from 'https://deno.land/std@0.168.0/http/server.ts';
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
};

const PLATFORM_TABLE: Record<string, string> = {
  doa:         'user_doa_credentials',
  estatesales: 'user_estatesales_credentials',
  mercari:     'user_mercari_credentials',
  poshmark:    'user_poshmark_credentials',
};

const PASSWORD_FIELDS = new Set([
  'doa_password',
  'estatesales_password',
  'mercari_password',
  'poshmark_password',
]);

async function encryptValue(plaintext: string, keyBase64: string): Promise<string> {
  const keyBytes = Uint8Array.from(atob(keyBase64), (c) => c.charCodeAt(0));
  const key = await crypto.subtle.importKey('raw', keyBytes, { name: 'AES-GCM' }, false, ['encrypt']);
  const iv = crypto.getRandomValues(new Uint8Array(12));
  const encoded = new TextEncoder().encode(plaintext);
  const ciphertext = await crypto.subtle.encrypt({ name: 'AES-GCM', iv }, key, encoded);
  return JSON.stringify({
    iv:         btoa(String.fromCharCode(...iv)),
    ciphertext: btoa(String.fromCharCode(...new Uint8Array(ciphertext))),
  });
}

serve(async (req) => {
  if (req.method === 'OPTIONS') {
    return new Response('ok', { headers: corsHeaders });
  }

  try {
    const { platform, fields } = await req.json();

    if (!platform || !fields || typeof fields !== 'object') {
      return new Response(
        JSON.stringify({ error: 'platform and fields are required' }),
        { status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' } },
      );
    }

    const table = PLATFORM_TABLE[platform as string];
    if (!table) {
      return new Response(
        JSON.stringify({ error: `Unknown platform: ${platform}` }),
        { status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' } },
      );
    }

    const encKey = Deno.env.get('CREDENTIALS_ENCRYPTION_KEY');
    if (!encKey) {
      throw new Error('CREDENTIALS_ENCRYPTION_KEY secret is not configured on this edge function.');
    }

    // Authenticate the caller
    const authHeader = req.headers.get('authorization') ?? '';
    const supabaseUser = createClient(
      Deno.env.get('SUPABASE_URL') ?? '',
      Deno.env.get('SUPABASE_ANON_KEY') ?? '',
      { global: { headers: { authorization: authHeader } } },
    );
    const { data: { user }, error: userErr } = await supabaseUser.auth.getUser();
    if (userErr || !user) {
      return new Response(
        JSON.stringify({ error: 'Unauthorized — valid session required' }),
        { status: 401, headers: { ...corsHeaders, 'Content-Type': 'application/json' } },
      );
    }

    // Encrypt password fields; pass through everything else (including null)
    const processedFields: Record<string, unknown> = {};
    for (const [k, v] of Object.entries(fields as Record<string, unknown>)) {
      if (typeof v === 'string' && PASSWORD_FIELDS.has(k) && v.length > 0) {
        processedFields[k] = await encryptValue(v, encKey);
      } else {
        processedFields[k] = v;
      }
    }

    const supabase = createClient(
      Deno.env.get('SUPABASE_URL') ?? '',
      Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') ?? '',
      { auth: { persistSession: false } },
    );

    const { error } = await supabase
      .from(table)
      .upsert(
        { user_id: user.id, ...processedFields, updated_at: new Date().toISOString() },
        { onConflict: 'user_id' },
      );

    if (error) {
      throw new Error(`DB upsert failed: ${error.message}`);
    }

    return new Response(
      JSON.stringify({ success: true }),
      { headers: { ...corsHeaders, 'Content-Type': 'application/json' } },
    );
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : String(err);
    console.error('[save-credentials] Error:', message);
    return new Response(
      JSON.stringify({ error: message }),
      { status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' } },
    );
  }
});
