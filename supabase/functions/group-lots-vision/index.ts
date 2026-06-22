import { serve } from 'https://deno.land/std@0.168.0/http/server.ts';
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
};

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

    const inlineDataParts = images.map((b64) => ({
      inlineData: { mimeType: 'image/jpeg', data: b64 },
    }));

    const geminiBody = {
      contents: [{
        parts: [
          {
            text: 'You are an estate sale lot grouper. Group these images into coherent lots where images of the same item or related set belong together. A lot is a group of images that should be listed together as one item for sale. Return ONLY valid JSON with this exact structure: {"lots": [{"lot": 1, "imageIndices": [0, 2, 5]}, ...]}. Image indices are 0-based. Every image must appear in exactly one lot. Do not include any text outside the JSON.',
          },
          ...inlineDataParts,
        ],
      }],
      generationConfig: { temperature: 0.1, maxOutputTokens: 2048 },
    };

    const geminiRes = await fetch(
      `https://generativelanguage.googleapis.com/v1beta/models/gemini-2.0-flash:generateContent?key=${GEMINI_API_KEY}`,
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

    let lots: { lot: number; imageIndices: number[] }[];
    try {
      const parsed = JSON.parse(stripped);
      lots = parsed.lots;
    } catch (parseErr) {
      console.warn('Failed to parse Gemini response, using fallback:', parseErr);
      lots = images.map((_, i) => ({ lot: i + 1, imageIndices: [i] }));
    }

    // Fire-and-forget model_costs log
    const inputTokensEst = images.length * 500;
    const outputTokensEst = 200;
    const costUsd = (inputTokensEst * 0.000000075) + (outputTokensEst * 0.0000003);

    supabase
      .from('model_costs')
      .insert({
        user_id: user.id,
        source: 'group-lots-vision',
        operation: 'group-lots',
        output_tokens: outputTokensEst,
        cost_usd: costUsd,
      })
      .then(({ error }) => {
        if (error) console.warn('model_costs log skipped:', error.message);
      });

    return new Response(JSON.stringify({ lots }), {
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
