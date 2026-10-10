import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type, x-supabase-client-platform, x-supabase-client-platform-version, x-supabase-client-runtime, x-supabase-client-runtime-version',
};

// Tier-2 batch pass — never runs in the hot listing path. Self-gates on the
// undistilled threshold so the fire-and-forget frontend trigger is nearly free
// until there's real signal.
const DISTILL_MODEL = 'claude-sonnet-4-6';
const INPUT_COST_PER_1M = 3.0;   // USD per 1M input tokens
const OUTPUT_COST_PER_1M = 15.0; // USD per 1M output tokens
const MIN_UNDISTILLED = 5;       // skip below this unless { force: true }
const MAX_CORRECTIONS = 100;     // per pass
const MAX_LESSONS = 15;          // hard cap on active lessons per user

interface CorrectionRow {
  id: string;
  category: string | null;
  wrong_title: string | null;
  corrected_title: string | null;
  wrong_specifics: Record<string, string> | null;
  corrected_specifics: Record<string, string> | null;
  correction_note: string | null;
  source: string | null;
}

function correctionLine(c: CorrectionRow): string {
  // A guardrail has no before/after pair — it is a standing instruction the
  // operator set by hand. Label it so the model treats it as a rule to keep,
  // not as a one-off fix to generalise from.
  if (c.source === 'guardrail') {
    return `- STANDING INSTRUCTION from the seller${c.category ? ` [${c.category}]` : ''}: ${c.correction_note ?? ''}`.slice(0, 1000);
  }
  const parts: string[] = [];
  if (c.category) parts.push(`[${c.category}]`);
  if (c.wrong_title || c.corrected_title) {
    parts.push(`title: "${c.wrong_title ?? '?'}" -> "${c.corrected_title ?? '?'}"`);
  }
  if (c.wrong_specifics || c.corrected_specifics) {
    parts.push(`specifics: ${JSON.stringify(c.wrong_specifics ?? {})} -> ${JSON.stringify(c.corrected_specifics ?? {})}`);
  }
  if (c.correction_note) parts.push(`note: ${c.correction_note}`);
  return `- ${parts.join(' | ')}`.slice(0, 1000);
}

// The model is asked for strict JSON, but strip code fences defensively.
function parseLessons(text: string): { lesson: string; category: string | null }[] {
  const cleaned = text.trim().replace(/^```(?:json)?\s*/i, '').replace(/\s*```$/, '');
  const parsed = JSON.parse(cleaned);
  if (!Array.isArray(parsed)) throw new Error('Model output is not a JSON array');
  return parsed
    .filter((l) => l && typeof l.lesson === 'string' && l.lesson.trim().length > 0)
    .slice(0, MAX_LESSONS)
    .map((l) => ({
      lesson: String(l.lesson).trim().slice(0, 500),
      category: typeof l.category === 'string' && l.category.trim() ? l.category.trim().slice(0, 100) : null,
    }));
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

    const ANTHROPIC_API_KEY = Deno.env.get('ANTHROPIC_API_KEY');
    if (!ANTHROPIC_API_KEY) {
      throw new Error('ANTHROPIC_API_KEY is not configured');
    }

    // Service client to read+write the caller's rows. Service role bypasses
    // RLS, so every query is explicitly scoped to user_id = user.id to keep
    // per-tenant isolation.
    const service = createClient(
      Deno.env.get('SUPABASE_URL')!,
      Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!
    );

    const { force } = (await req.json().catch(() => ({}))) as { force?: boolean };

    const { count: undistilled, error: countErr } = await service
      .from('listing_corrections')
      .select('id', { count: 'exact', head: true })
      .eq('user_id', user.id)
      .is('distilled_at', null)
      .eq('retired', false);

    if (countErr) throw countErr;
    if ((undistilled ?? 0) < MIN_UNDISTILLED && !force) {
      return new Response(
        JSON.stringify({ skipped: true, undistilled: undistilled ?? 0 }),
        { headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      );
    }

    const { data: corrections, error: corrErr } = await service
      .from('listing_corrections')
      .select('id, category, wrong_title, corrected_title, wrong_specifics, corrected_specifics, correction_note, source')
      .eq('user_id', user.id)
      .is('distilled_at', null)
      .eq('retired', false)
      .order('created_at', { ascending: false })
      .limit(MAX_CORRECTIONS);

    if (corrErr) throw corrErr;
    if (!corrections || corrections.length === 0) {
      return new Response(
        JSON.stringify({ skipped: true, undistilled: 0 }),
        { headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      );
    }

    const { data: activeLessons, error: lessonErr } = await service
      .from('listing_correction_lessons')
      .select('id, lesson_text, category')
      .eq('user_id', user.id)
      .eq('retired', false)
      .order('created_at', { ascending: false })
      .limit(20);

    if (lessonErr) throw lessonErr;

    // Consolidating pass: existing lessons + new corrections -> one fresh set.
    const correctionBlock = corrections.map(correctionLine).join('\n');
    const lessonBlock = (activeLessons ?? []).length > 0
      ? (activeLessons ?? []).map((l) => `- ${l.category ? `[${l.category}] ` : ''}${l.lesson_text}`).join('\n')
      : '(none yet)';

    const prompt = `You maintain a small set of general rules ("lessons") that help an AI correctly identify and title items for an online reseller. The lessons are distilled from the seller's history of correcting the AI's mistakes.

CURRENT ACTIVE LESSONS:
${lessonBlock}

NEW CORRECTIONS (each shows what the AI said -> what the human fixed it to).
Lines marked "STANDING INSTRUCTION from the seller" are not mistakes to generalise
from — they are rules the seller set deliberately. Preserve their intent as a
lesson, reworded into a general rule, and prefer them when they conflict with an
inference drawn from ordinary corrections:
${correctionBlock}

Merge the current lessons and the new corrections into a single fresh set of AT MOST ${MAX_LESSONS} lessons. Rules:
- Each lesson must be a GENERAL rule that would prevent a class of future mistakes, not a restatement of one specific fix.
- Keep still-valid existing lessons (reworded if it improves them); drop ones the new corrections contradict.
- No duplicates or near-duplicates. Fewer, stronger lessons beat many weak ones.
- Each lesson is one sentence, concrete and actionable for item identification/titling.
- "category" is the item category the lesson applies to, or null if general.

Respond with ONLY a JSON array, no prose, no code fences:
[{ "lesson": "...", "category": "..." }]`;

    const aiRes = await fetch('https://api.anthropic.com/v1/messages', {
      method: 'POST',
      headers: {
        'x-api-key': ANTHROPIC_API_KEY,
        'anthropic-version': '2023-06-01',
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        model: DISTILL_MODEL,
        max_tokens: 2000,
        messages: [{ role: 'user', content: prompt }],
      }),
    });

    if (!aiRes.ok) {
      const errText = await aiRes.text();
      throw new Error(`Anthropic distillation failed (${aiRes.status}): ${errText}`);
    }

    const aiJson = await aiRes.json();
    const text = aiJson.content?.[0]?.text;
    if (!text) throw new Error('No text content in Anthropic response');
    const lessons = parseLessons(text);

    const consumedIds = corrections.map((c) => c.id);
    let distilled = 0;
    let insertedIds: string[] = [];

    if (lessons.length > 0) {
      const { data: inserted, error: insErr } = await service
        .from('listing_correction_lessons')
        .insert(lessons.map((l) => ({
          user_id: user.id,
          lesson_text: l.lesson,
          category: l.category,
          source_correction_ids: consumedIds,
        })))
        .select('id');

      if (insErr) throw insErr;
      insertedIds = (inserted ?? []).map((r) => r.id);
      distilled = insertedIds.length;
    }

    // Retire the prior active set — the new set replaces it wholesale.
    let retiredCount = 0;
    const oldIds = (activeLessons ?? []).map((l) => l.id).filter((id) => !insertedIds.includes(id));
    if (lessons.length > 0 && oldIds.length > 0) {
      const { error: retireErr } = await service
        .from('listing_correction_lessons')
        .update({ retired: true })
        .eq('user_id', user.id)
        .in('id', oldIds);
      if (retireErr) throw retireErr;
      retiredCount = oldIds.length;
    }

    // Stamp consumed corrections so the next pass only reads new signal.
    if (lessons.length > 0) {
      const { error: stampErr } = await service
        .from('listing_corrections')
        .update({ distilled_at: new Date().toISOString() })
        .eq('user_id', user.id)
        .in('id', consumedIds);
      if (stampErr) throw stampErr;
    }

    // Cost-log the distillation call (operator rule). Non-blocking.
    try {
      const inputTokens = aiJson.usage?.input_tokens ?? null;
      const outputTokens = aiJson.usage?.output_tokens ?? null;
      const costUsd = inputTokens != null && outputTokens != null
        ? Number((
            (inputTokens / 1_000_000) * INPUT_COST_PER_1M +
            (outputTokens / 1_000_000) * OUTPUT_COST_PER_1M
          ).toFixed(6))
        : null;
      await service.from('model_costs').insert({
        user_id: user.id,
        source: 'distill-lessons',
        operation: 'distill',
        model: DISTILL_MODEL,
        input_tokens: inputTokens,
        output_tokens: outputTokens,
        cost_usd: costUsd,
      });
    } catch (e) {
      console.warn('model_costs log skipped (non-blocking):', e);
    }

    return new Response(
      JSON.stringify({ distilled, retired: retiredCount, corrections_consumed: consumedIds.length }),
      { headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
    );
  } catch (e) {
    console.error('distill-lessons error:', e);
    return new Response(
      JSON.stringify({ error: String(e?.message ?? e) }),
      { status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
    );
  }
});
