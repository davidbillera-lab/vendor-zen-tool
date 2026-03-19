/**
 * trigger-doa-agent
 *
 * Called by the ResaleHub app when the user clicks "Push to DOA".
 *
 * 1. Saves the auction URL on the batch.
 * 2. Ensures 'denver' is in platforms.
 * 3. Resets all non-completed lots to pending.
 * 4. Dispatches a repository_dispatch event to GitHub Actions so the
 *    Playwright agent runs in the cloud — no local machine required.
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

const GITHUB_REPO = 'davidbillera-lab/vendor-zen-tool';
const GITHUB_DISPATCH_EVENT = 'run-doa-agent';

serve(async (req) => {
  if (req.method === 'OPTIONS') {
    return new Response('ok', { headers: corsHeaders });
  }

  try {
    const { batch_id, doa_url } = await req.json();

    if (!batch_id || !doa_url) {
      return new Response(JSON.stringify({ error: 'batch_id and doa_url are required' }), {
        status: 400,
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      });
    }

    const supabase = createClient(
      Deno.env.get('SUPABASE_URL') ?? '',
      Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') ?? '',
      { auth: { persistSession: false } }
    );

    // — 1. Fetch existing batch data ——————————————————————————————————————————
    const { data: batchData, error: batchError } = await supabase
      .from('la_batches')
      .select('platforms, name')
      .eq('id', batch_id)
      .single();

    if (batchError) throw batchError;

    // — 2. Ensure 'denver' is in platforms ————————————————————————————————————
    const currentPlatforms: string[] = batchData?.platforms || [];
    const updatedPlatforms = currentPlatforms.includes('denver')
      ? currentPlatforms
      : [...currentPlatforms, 'denver'];

    // — 3. Save DOA auction URL, updated platforms, and mark batch active ——————
    const { error: updateError } = await supabase
      .from('la_batches')
      .update({
        doa_auction_url: doa_url,
        platforms: updatedPlatforms,
        is_active: true,
      })
      .eq('id', batch_id);

    if (updateError) throw updateError;

    // — 4. Reset all non-completed lots to pending ————————————————————————————
    await supabase
      .from('denver_batch_rows')
      .update({ status: 'pending', error_message: null })
      .eq('batch_id', batch_id)
      .not('status', 'eq', 'completed');

    // — 5. Count pending lots —————————————————————————————————————————————————
    const { count: pendingCount } = await supabase
      .from('denver_batch_rows')
      .select('id', { count: 'exact', head: true })
      .eq('batch_id', batch_id)
      .eq('status', 'pending');

    // — 6. Trigger GitHub Actions via repository_dispatch —————————————————————
    const githubPat = Deno.env.get('GITHUB_PAT');
    if (!githubPat) {
      throw new Error(
        'GITHUB_PAT secret is not set on this edge function. ' +
        'Add it in Supabase → Project Settings → Edge Functions → Secrets.'
      );
    }

    const dispatchRes = await fetch(
      `https://api.github.com/repos/${GITHUB_REPO}/dispatches`,
      {
        method: 'POST',
        headers: {
          Accept: 'application/vnd.github.v3+json',
          Authorization: `token ${githubPat}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          event_type: GITHUB_DISPATCH_EVENT,
          client_payload: {
            batch_id,
            batch_name: batchData?.name ?? batch_id,
            pending_lots: pendingCount ?? 0,
          },
        }),
      }
    );

    if (!dispatchRes.ok) {
      const errText = await dispatchRes.text();
      throw new Error(
        `GitHub dispatch failed (HTTP ${dispatchRes.status}): ${errText}. ` +
        'Check that GITHUB_PAT has the "repo" scope and the repo name is correct.'
      );
    }

    // — 7. Return success —————————————————————————————————————————————————————
    return new Response(
      JSON.stringify({
        success: true,
        pending_lots: pendingCount ?? 0,
        batch_name: batchData?.name ?? batch_id,
        message: `${pendingCount ?? 0} lots queued. GitHub Actions is now running the DOA agent in the cloud.`,
      }),
      { headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
    );
  } catch (err) {
    console.error('[trigger-doa-agent] Error:', err.message);
    return new Response(JSON.stringify({ error: err.message }), {
      status: 500,
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    });
  }
});
