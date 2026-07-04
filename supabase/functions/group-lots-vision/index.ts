import { serve } from 'https://deno.land/std@0.168.0/http/server.ts';
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
};

// gemini-2.0-flash was shut down by Google on 2026-06-01. gemini-3.5-flash is GA
// with no announced shutdown (the 2.5 family has an October 2026 cutover).
const GEMINI_MODEL = 'gemini-3.5-flash';
// Pricing per token (gemini-3.5-flash: $1.50/M input, $9.00/M output).
const INPUT_COST_PER_TOKEN = 0.0000015;
const OUTPUT_COST_PER_TOKEN = 0.000009;

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
        temperature: 0.1,
        maxOutputTokens: 8192,
        responseMimeType: 'application/json',
      },
    };

    const geminiRes = await fetch(
      `https://generativelanguage.googleapis.com/v1beta/models/${GEMINI_MODEL}:generateContent?key=${GEMINI_API_KEY}`,
      {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(geminiBody),
      }
    );

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

    // Fire-and-forget model_costs log (model column is NOT NULL — must be set)
    const inputTokens = geminiData?.usageMetadata?.promptTokenCount ?? images.length * 258;
    const outputTokens = geminiData?.usageMetadata?.candidatesTokenCount ?? 200;
    const costUsd = (inputTokens * INPUT_COST_PER_TOKEN) + (outputTokens * OUTPUT_COST_PER_TOKEN);

    supabase
      .from('model_costs')
      .insert({
        user_id: user.id,
        source: 'group-lots-vision',
        operation: 'group-lots',
        model: GEMINI_MODEL,
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
    console.error('group-lots-vision error:', err);
    return new Response(
      JSON.stringify({ error: err instanceof Error ? err.message : String(err) }),
      { status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
    );
  }
});
