import { serve } from 'https://deno.land/std@0.168.0/http/server.ts';
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
};

// gemini-2.0-flash was shut down by Google on 2026-06-01. gemini-3.8-flash is the
// current stable Flash (ai.google.dev/gemini-api/docs/models, checked 2026-10-12).
// Tried in order: when Google answers 503/429 ("high demand") the next model is
// tried at once — separate capacity pools; same price (ai.google.dev/pricing).
// Third choice is the cheaper Flash-Lite ($0.30/M in, $2.50/M out) — lower quality, but
// a grouped batch beats a failed one.
const GEMINI_MODELS = ['gemini-3.8-flash', 'gemini-3.6-flash', 'gemini-3.5-flash-lite'];
const LITE_INPUT_COST_PER_TOKEN = 0.0000003;
const LITE_OUTPUT_COST_PER_TOKEN = 0.0000025;
// Stay under the 150s edge-function limit so a slow Gemini reply comes back as a
// retryable error the client can act on, not a gateway 504 with no body.
const GEMINI_TIMEOUT_MS = 140_000;
// Pricing per token (gemini-3.8-flash intro rate through 2026-12-31: $0.75/M input,
// $3.75/M output). Standard rate from 2027-01-01 is $1.50/M and $7.50/M — update then.
const INPUT_COST_PER_TOKEN = 0.00000075;
const OUTPUT_COST_PER_TOKEN = 0.00000375;

interface LotGroup {
  lot: number;
  imageIndices: number[];
}

// Gemini output is untrusted: clamp indices to range, drop duplicates, and make
// sure every image lands in exactly one lot (leftovers become single-image lots).
function normalizeLots(raw: unknown, imageCount: number): LotGroup[] {
  const seen = new Set<number>();
  const lots: LotGroup[] = [];
  if (Array.isArray(raw)) {
    for (const entry of raw) {
      const indices = Array.isArray(entry?.imageIndices)
        ? entry.imageIndices
            .map((i: unknown) => Number(i))
            .filter((i: number) => Number.isInteger(i) && i >= 0 && i < imageCount && !seen.has(i))
        : [];
      if (indices.length === 0) continue;
      indices.forEach((i: number) => seen.add(i));
      lots.push({ lot: lots.length + 1, imageIndices: indices });
    }
  }
  for (let i = 0; i < imageCount; i++) {
    if (!seen.has(i)) {
      lots.push({ lot: lots.length + 1, imageIndices: [i] });
    }
  }
  return lots;
}

serve(async (req) => {
  if (req.method === 'OPTIONS') {
    return new Response(null, { headers: corsHeaders });
  }

  try {
    const supabase = createClient(
      Deno.env.get('SUPABASE_URL') ?? '',
      Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') ?? '',
      { auth: { persistSession: false } }
    );

    const authHeader = req.headers.get('Authorization') ?? '';
    const jwt = authHeader.replace(/^Bearer\s+/i, '');
    const { data: { user }, error: authError } = await supabase.auth.getUser(jwt);
    if (authError || !user) {
      return new Response(JSON.stringify({ error: 'Unauthorized' }), {
        status: 401, headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      });
    }

    const { images }: { images: string[] } = await req.json();

    if (!images || !Array.isArray(images) || images.length === 0) {
      return new Response(JSON.stringify({ error: 'images array is required and must not be empty' }), {
        status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      });
    }

    const GEMINI_API_KEY = Deno.env.get('GOOGLE_AI_API_KEY') ?? Deno.env.get('GEMINI_API_KEY') ?? '';
    if (!GEMINI_API_KEY) {
      console.error('group-lots-vision: no Gemini API key configured');
      return new Response(JSON.stringify({ error: 'Gemini API key not configured (GOOGLE_AI_API_KEY)' }), {
        status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      });
    }

    const inlineDataParts = images.map((b64) => ({
      inlineData: { mimeType: 'image/jpeg', data: b64 },
    }));

    const started = Date.now();
    const geminiBody = {
      contents: [{
        parts: [
          {
            text: 'You are an estate sale lot grouper. Group these images into coherent lots where images of the same item or related set belong together. A lot is a group of images that should be listed together as one item for sale. The images are provided in the order they were photographed, and photos of the same item are almost always consecutive — use that ordering as a strong signal, and only group non-adjacent images together when they are clearly the same item. Return ONLY valid JSON with this exact structure: {"lots": [{"lot": 1, "imageIndices": [0, 2, 5]}, ...]}. Image indices are 0-based. Every image must appear in exactly one lot. Do not include any text outside the JSON.',
          },
          ...inlineDataParts,
        ],
      }],
      generationConfig: {
        // 3.8 docs: drop deprecated sampling params (temperature); cap raised since default thinking is "medium"
        maxOutputTokens: 16384,
        responseMimeType: 'application/json',
      },
    };

    let geminiRes!: Response;
    let usedModel = GEMINI_MODELS[0];
    // 2026-10-12: Google rejected both 3.8 (429) and 3.6 (503) in the same minute, so
    // after a full pass over the models, pause briefly and make one more pass.
    const ROUNDS = 2;
    attempts: for (let round = 0; round < ROUNDS; round++) {
      for (let i = 0; i < GEMINI_MODELS.length; i++) {
        usedModel = GEMINI_MODELS[i];
        geminiRes = await fetch(
          `https://generativelanguage.googleapis.com/v1beta/models/${usedModel}:generateContent?key=${GEMINI_API_KEY}`,
          {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(geminiBody),
            // Gemini's latency swings from ~10s to past 150s on same-size batches
            // (2026-09-29); without this the gateway kills the call silently. The
            // budget is shared across fallback attempts.
            signal: AbortSignal.timeout(Math.max(GEMINI_TIMEOUT_MS - (Date.now() - started), 5_000)),
          }
        );
        const overloaded = geminiRes.status === 503 || geminiRes.status === 429;
        const lastAttempt = round === ROUNDS - 1 && i === GEMINI_MODELS.length - 1;
        if (geminiRes.ok || !overloaded || lastAttempt) break attempts;
        // Log Google's reason (a 429 can be a quota, not an overload) before moving on.
        const reason = (await geminiRes.text()).replace(/\s+/g, ' ').slice(0, 300);
        console.warn(`[group-lots-vision] ${usedModel} returned ${geminiRes.status}: ${reason}`);
      }
      // Skip the pause when little of the time budget is left.
      if (Date.now() - started < GEMINI_TIMEOUT_MS - 45_000) await new Promise((r) => setTimeout(r, 4000));
    }

    if (!geminiRes.ok) {
      const errText = await geminiRes.text();
      console.error('Gemini API error:', geminiRes.status, errText);
      throw new Error(`Gemini API returned ${geminiRes.status}: ${errText}`);
    }

    const geminiData = await geminiRes.json();
    const rawText: string = geminiData?.candidates?.[0]?.content?.parts?.[0]?.text ?? '';

    // Strip markdown code fences if present
    const stripped = rawText.replace(/^```(?:json)?\s*/i, '').replace(/\s*```\s*$/, '').trim();

    // fallback=true means grouping failed and each image became its own lot —
    // the client surfaces this instead of silently proceeding.
    let lots: LotGroup[];
    let fallback = false;
    try {
      const parsed = JSON.parse(stripped);
      lots = normalizeLots(parsed.lots, images.length);
    } catch (parseErr) {
      console.warn('Failed to parse Gemini response, using fallback:', parseErr);
      lots = images.map((_, i) => ({ lot: i + 1, imageIndices: [i] }));
      fallback = true;
    }

    console.log(`[group-lots-vision] ${images.length} images -> ${lots.length} lots in ${Date.now() - started}ms via ${usedModel}${fallback ? ' (fallback)' : ''}`);

    // Fire-and-forget model_costs log (model column is NOT NULL — must be set)
    const inputTokens = geminiData?.usageMetadata?.promptTokenCount ?? images.length * 258;
    // Google bills thinking tokens as output; candidatesTokenCount excludes them.
    const outputTokens = (geminiData?.usageMetadata?.candidatesTokenCount ?? 200)
      + (geminiData?.usageMetadata?.thoughtsTokenCount ?? 0);
    const isLite = usedModel.includes('lite');
    const costUsd = (inputTokens * (isLite ? LITE_INPUT_COST_PER_TOKEN : INPUT_COST_PER_TOKEN))
      + (outputTokens * (isLite ? LITE_OUTPUT_COST_PER_TOKEN : OUTPUT_COST_PER_TOKEN));

    supabase
      .from('model_costs')
      .insert({
        user_id: user.id,
        source: 'group-lots-vision',
        operation: 'group-lots',
        model: usedModel,
        input_tokens: inputTokens,
        output_tokens: outputTokens,
        cost_usd: costUsd,
      })
      .then(({ error }) => {
        if (error) console.warn('model_costs log skipped:', error.message);
      });

    return new Response(JSON.stringify({ lots, fallback }), {
      status: 200,
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    });

  } catch (err) {
    if (err instanceof DOMException && err.name === 'TimeoutError') {
      console.error(`[group-lots-vision] Gemini did not answer within ${GEMINI_TIMEOUT_MS / 1000}s`);
      return new Response(
        JSON.stringify({ error: `Gemini took longer than ${GEMINI_TIMEOUT_MS / 1000}s to group these photos. Try again.`, retryable: true }),
        { status: 504, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      );
    }
    console.error('group-lots-vision error:', err);
    return new Response(
      JSON.stringify({ error: err instanceof Error ? err.message : String(err) }),
      { status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
    );
  }
});
