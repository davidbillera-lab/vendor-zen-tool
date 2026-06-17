import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type, x-supabase-client-platform, x-supabase-client-platform-version, x-supabase-client-runtime, x-supabase-client-runtime-version',
};

const EMBED_MODEL = 'text-embedding-3-small'; // 1536 dims, Tier-1 cheap
const EMBED_COST_PER_1M = 0.02;               // USD per 1M input tokens

// Build the text we embed for a correction. Anchor on the human's *corrected*
// identification (the truth) plus category + note, so it lands in the same
// semantic space as the photo caption used at query time.
function signatureFor(row: {
  corrected_title: string | null;
  category: string | null;
  correction_note: string | null;
  wrong_title: string | null;
}): string {
  return [
    row.corrected_title,
    row.category ? `category ${row.category}` : null,
    row.correction_note,
  ]
    .filter((p) => p && String(p).trim().length > 0)
    .join(' | ')
    .slice(0, 2000) || (row.wrong_title ?? 'item');
}

serve(async (req) => {
  if (req.method === 'OPTIONS') {
    return new Response(null, { headers: corsHeaders });
  }

  try {
    const authHeader = req.headers.get('Authorization');
    if (!authHeader) {
      return new Response(
        JSON.stringify({ error: 'Authorization required' }),
        { status: 401, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      );
    }

    const anonClient = createClient(
      Deno.env.get('SUPABASE_URL')!,
      Deno.env.get('SUPABASE_ANON_KEY')!
    );
    const { data: { user }, error: authError } = await anonClient.auth.getUser(
      authHeader.replace('Bearer ', '')
    );
    if (authError || !user) {
      return new Response(
        JSON.stringify({ error: 'Invalid or expired token' }),
        { status: 401, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      );
    }

    const OPENAI_API_KEY = Deno.env.get('OPENAI_API_KEY');
    if (!OPENAI_API_KEY) {
      throw new Error('OPENAI_API_KEY is not configured');
    }

    // Service client to read+update the caller's rows. Service role bypasses
    // RLS, so every query is explicitly scoped to user_id = user.id to keep
    // per-tenant isolation (v1 has no UPDATE policy to lean on).
    const service = createClient(
      Deno.env.get('SUPABASE_URL')!,
      Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!
    );

    const { limit } = (await req.json().catch(() => ({}))) as { limit?: number };
    const batchSize = Math.min(Math.max(limit ?? 100, 1), 200);

    const { data: rows, error: selErr } = await service
      .from('listing_corrections')
      .select('id, corrected_title, category, correction_note, wrong_title')
      .eq('user_id', user.id)
      .is('embedding', null)
      .order('created_at', { ascending: false })
      .limit(batchSize);

    if (selErr) throw selErr;
    if (!rows || rows.length === 0) {
      return new Response(
        JSON.stringify({ embedded: 0, remaining: 0 }),
        { headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      );
    }

    const inputs = rows.map(signatureFor);

    const embedRes = await fetch('https://api.openai.com/v1/embeddings', {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${OPENAI_API_KEY}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({ model: EMBED_MODEL, input: inputs }),
    });

    if (!embedRes.ok) {
      const errText = await embedRes.text();
      throw new Error(`OpenAI embeddings failed (${embedRes.status}): ${errText}`);
    }

    const embedJson = await embedRes.json();
    const vectors: number[][] = embedJson.data
      .sort((a: any, b: any) => a.index - b.index)
      .map((d: any) => d.embedding);

    // Update each row with its embedding (pgvector accepts the JSON-array text).
    let embedded = 0;
    for (let i = 0; i < rows.length; i++) {
      const { error: updErr } = await service
        .from('listing_corrections')
        .update({ embedding: JSON.stringify(vectors[i]) })
        .eq('id', rows[i].id)
        .eq('user_id', user.id);
      if (updErr) {
        console.warn(`embed update failed for ${rows[i].id} (non-fatal):`, updErr.message);
        continue;
      }
      embedded++;
    }

    // Cost-log the embedding call (operator rule). Non-blocking.
    try {
      const inputTokens = embedJson.usage?.prompt_tokens ?? null;
      const costUsd = inputTokens != null
        ? Number(((inputTokens / 1_000_000) * EMBED_COST_PER_1M).toFixed(6))
        : null;
      await service.from('model_costs').insert({
        user_id: user.id,
        source: 'embed-corrections',
        operation: 'embedding',
        model: EMBED_MODEL,
        input_tokens: inputTokens,
        output_tokens: null,
        cost_usd: costUsd,
      });
    } catch (e) {
      console.warn('model_costs log skipped (non-blocking):', e);
    }

    return new Response(
      JSON.stringify({ embedded, requested: rows.length }),
      { headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
    );
  } catch (e) {
    console.error('embed-corrections error:', e);
    return new Response(
      JSON.stringify({ error: String(e?.message ?? e) }),
      { status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
    );
  }
});
