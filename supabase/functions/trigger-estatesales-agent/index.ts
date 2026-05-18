/**
 * trigger-estatesales-agent
 *
 * Called by the EstateSales SaaS app when the user clicks "Start Upload".
 *
 * 1. Creates a job record in estatesales_jobs.
 * 2. Dispatches a repository_dispatch event to GitHub Actions so the
 *    Playwright agent runs in the cloud — no local machine required.
 * 3. Returns the job_id so the client can poll for status.
 *
 * Required Supabase Edge Function secrets:
 *   SUPABASE_URL              — your Supabase project URL
 *   SUPABASE_SERVICE_ROLE_KEY — service role key (bypasses RLS)
 *   GITHUB_PAT                — GitHub Personal Access Token with `repo` scope
 */
import { serve } from 'https://deno.land/std@0.168.0/http/server.ts';
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
};

const GITHUB_REPO           = 'davidbillera-lab/vendor-zen-tool';
const GITHUB_DISPATCH_EVENT = 'run-estatesales-agent';

serve(async (req) => {
  if (req.method === 'OPTIONS') {
    return new Response('ok', { headers: corsHeaders });
  }

  try {
    const { doa_url, estatesales_url } = await req.json();

    if (!doa_url || !estatesales_url) {
      return new Response(
        JSON.stringify({ error: 'doa_url and estatesales_url are required' }),
        { status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' } },
      );
    }

    // Identify the calling user from their JWT
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

    // Service role client to bypass RLS for inserts/reads
    const supabase = createClient(
      Deno.env.get('SUPABASE_URL') ?? '',
      Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') ?? '',
      { auth: { persistSession: false } },
    );

    // Verify the user has credentials on file before creating a job
    const { data: creds } = await supabase
      .from('user_estatesales_credentials')
      .select('id')
      .eq('user_id', user.id)
      .single();

    if (!creds) {
      return new Response(
        JSON.stringify({ error: 'No estatesales.net credentials on file. Add them in Settings first.' }),
        { status: 422, headers: { ...corsHeaders, 'Content-Type': 'application/json' } },
      );
    }

    // Create the job record
    const { data: job, error: jobErr } = await supabase
      .from('estatesales_jobs')
      .insert({
        user_id:         user.id,
        doa_url,
        estatesales_url,
        status:          'pending',
      })
      .select('id')
      .single();

    if (jobErr || !job) {
      throw new Error(`Failed to create job: ${jobErr?.message}`);
    }

    // Fire GitHub Actions via repository_dispatch
    const githubPat = Deno.env.get('GITHUB_PAT');
    if (!githubPat) {
      throw new Error(
        'GITHUB_PAT secret is not set. Add it in Supabase → Project Settings → Edge Functions → Secrets.',
      );
    }

    const dispatchRes = await fetch(
      `https://api.github.com/repos/${GITHUB_REPO}/dispatches`,
      {
        method: 'POST',
        headers: {
          Accept:        'application/vnd.github.v3+json',
          Authorization: `token ${githubPat}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          event_type:     GITHUB_DISPATCH_EVENT,
          client_payload: { job_id: job.id },
        }),
      },
    );

    if (!dispatchRes.ok) {
      const errText = await dispatchRes.text();
      // Roll back the job record so it doesn't sit as a phantom pending job
      await supabase.from('estatesales_jobs').delete().eq('id', job.id);
      throw new Error(`GitHub dispatch failed (HTTP ${dispatchRes.status}): ${errText}`);
    }

    return new Response(
      JSON.stringify({
        success: true,
        job_id:  job.id,
        message: 'Job queued — GitHub Actions is starting the upload agent.',
      }),
      { headers: { ...corsHeaders, 'Content-Type': 'application/json' } },
    );

  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : String(err);
    console.error('[trigger-estatesales-agent] Error:', message);
    return new Response(
      JSON.stringify({ error: message }),
      { status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' } },
    );
  }
});
