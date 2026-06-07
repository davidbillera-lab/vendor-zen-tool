import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type, x-supabase-client-platform, x-supabase-client-platform-version, x-supabase-client-runtime, x-supabase-client-runtime-version',
};

interface EnhanceRequest {
  imageUrl: string;
  prompt: string;
  mode: 'enhance' | 'generate' | 'edit';
  provider: 'gpt-image-2' | 'gemini';
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

    const supabase = createClient(
      Deno.env.get('SUPABASE_URL')!,
      Deno.env.get('SUPABASE_ANON_KEY')!
    );

    const { data: { user }, error: authError } = await supabase.auth.getUser(
      authHeader.replace('Bearer ', '')
    );

    if (authError || !user) {
      console.error('Authentication failed:', authError?.message);
      return new Response(
        JSON.stringify({ error: 'Invalid or expired token' }),
        { status: 401, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      );
    }

    console.log(`Authenticated user: ${user.id}`);

    const { imageUrl, prompt, mode, provider = 'gpt-image-2' } = await req.json() as EnhanceRequest;

    // Service client used for usage tracking and storage upload
    const serviceClient = createClient(
      Deno.env.get('SUPABASE_URL')!,
      Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!
    );

    // Check current billing-period usage (soft cap: 300 images/month)
    const billingPeriod = new Date().toISOString().substring(0, 7); // 'YYYY-MM'
    const SOFT_CAP = 300;

    const { data: usageRow } = await serviceClient
      .from('tenant_usage')
      .select('enhancement_count')
      .eq('user_id', user.id)
      .eq('billing_period', billingPeriod)
      .maybeSingle();

    const currentCount = usageRow?.enhancement_count ?? 0;
    if (currentCount >= SOFT_CAP) {
      console.warn(
        `[enhance-image] SOFT_CAP: user=${user.id} count=${currentCount} period=${billingPeriod} — proceeding (soft cap only)`
      );
    }

    console.log(`Image ${mode} request via ${provider}: ${prompt}`);

    let base64Image: string;

    if (provider === 'gemini') {
      base64Image = await callGemini(imageUrl, prompt, mode);
    } else {
      base64Image = await callGptImage2(imageUrl, prompt, mode);
    }

    // Increment usage atomically now that the image was generated successfully
    await serviceClient.rpc('increment_enhancement_count', {
      p_user_id: user.id,
      p_billing_period: billingPeriod,
    });

    // Upload to Supabase storage
    const imageBuffer = Uint8Array.from(atob(base64Image), c => c.charCodeAt(0));
    const fileName = `enhanced-${Date.now()}-${Math.random().toString(36).substring(7)}.png`;

    const { error: uploadError } = await serviceClient.storage
      .from('listing-images')
      .upload(`${user.id}/${fileName}`, imageBuffer, {
        contentType: 'image/png',
        upsert: false
      });

    if (uploadError) {
      console.error('Failed to upload enhanced image:', uploadError);
      return new Response(
        JSON.stringify({
          imageUrl: `data:image/png;base64,${base64Image}`,
          isBase64: true,
        }),
        { headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      );
    }

    const { data: publicUrl } = serviceClient.storage
      .from('listing-images')
      .getPublicUrl(`${user.id}/${fileName}`);

    return new Response(
      JSON.stringify({
        imageUrl: publicUrl.publicUrl,
        isBase64: false,
      }),
      { headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
    );

  } catch (error) {
    console.error('Error in enhance-image:', error);

    if (error instanceof Response) throw error;

    const message = error instanceof Error ? error.message : 'Unknown error';
    const status = message.includes('Rate limit') ? 429
      : message.includes('credits') ? 402
      : 500;

    return new Response(
      JSON.stringify({ error: message }),
      { status, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
    );
  }
});

// ── Provider: OpenAI gpt-image-2 ────────────────────────────────────────────

async function callGptImage2(imageUrl: string, prompt: string, mode: string): Promise<string> {
  const OPENAI_API_KEY = Deno.env.get('OPENAI_API_KEY');
  if (!OPENAI_API_KEY) throw new Error('OPENAI_API_KEY is not configured');

  const effectivePrompt = mode === 'enhance'
    ? `Enhance this product image for e-commerce listing. Make it look professional with good lighting, clear details, and appealing presentation. ${prompt || 'Improve overall quality and appeal.'}`
    : prompt;

  let response: Response;

  if (mode === 'generate') {
    // Text-to-image: generations endpoint
    response = await fetch('https://api.openai.com/v1/images/generations', {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${OPENAI_API_KEY}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        model: 'gpt-image-2',
        prompt: effectivePrompt,
        n: 1,
        size: '1024x1024',
      }),
    });
  } else {
    // Edit or enhance: edits endpoint (multipart)
    const imgBytes = await fetchImageBytes(imageUrl);
    const form = new FormData();
    form.append('model', 'gpt-image-2');
    form.append('prompt', effectivePrompt);
    form.append('n', '1');
    form.append('size', '1024x1024');
    form.append('image', new Blob([imgBytes], { type: 'image/png' }), 'image.png');

    response = await fetch('https://api.openai.com/v1/images/edits', {
      method: 'POST',
      headers: { 'Authorization': `Bearer ${OPENAI_API_KEY}` },
      body: form,
    });
  }

  return extractOpenAIBase64(response);
}

async function extractOpenAIBase64(response: Response): Promise<string> {
  if (!response.ok) {
    const errorText = await response.text();
    console.error('OpenAI API error:', response.status, errorText);
    if (response.status === 429) throw new Error('Rate limit exceeded. Please try again later.');
    if (response.status === 402) throw new Error('AI credits exhausted. Please add credits to continue.');
    throw new Error(`OpenAI API error: ${response.status}`);
  }

  const data = await response.json();
  const b64 = data?.data?.[0]?.b64_json;
  if (!b64) throw new Error('No image returned from OpenAI');
  return b64;
}

// ── Provider: Google Gemini image generation ─────────────────────────────────

async function callGemini(imageUrl: string, prompt: string, mode: string): Promise<string> {
  const GOOGLE_AI_API_KEY = Deno.env.get('GOOGLE_AI_API_KEY');
  if (!GOOGLE_AI_API_KEY) throw new Error('GOOGLE_AI_API_KEY is not configured');

  const effectivePrompt = mode === 'enhance'
    ? `Enhance this product image for e-commerce listing. Make it look professional with good lighting, clean background, clear details, and appealing presentation. ${prompt || 'Improve overall quality and appeal.'}`
    : prompt;

  const parts: unknown[] = [{ text: effectivePrompt }];

  if (mode !== 'generate' && imageUrl) {
    const imgBytes = await fetchImageBytes(imageUrl);
    const b64 = btoa(String.fromCharCode(...imgBytes));
    parts.push({ inlineData: { mimeType: 'image/png', data: b64 } });
  }

  const response = await fetch(
    `https://generativelanguage.googleapis.com/v1beta/models/gemini-2.0-flash-preview-image-generation:generateContent?key=${GOOGLE_AI_API_KEY}`,
    {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        contents: [{ parts }],
        generationConfig: { responseModalities: ['TEXT', 'IMAGE'] },
      }),
    }
  );

  if (!response.ok) {
    const errorText = await response.text();
    console.error('Gemini API error:', response.status, errorText);
    if (response.status === 429) throw new Error('Rate limit exceeded. Please try again later.');
    throw new Error(`Gemini API error: ${response.status}`);
  }

  const data = await response.json();
  const imagePart = data?.candidates?.[0]?.content?.parts?.find(
    (p: { inlineData?: { data: string } }) => p.inlineData?.data
  );
  if (!imagePart?.inlineData?.data) throw new Error('No image returned from Gemini');
  return imagePart.inlineData.data;
}

// ── Shared helpers ───────────────────────────────────────────────────────────

async function fetchImageBytes(imageUrl: string): Promise<Uint8Array> {
  if (imageUrl.startsWith('data:')) {
    const b64 = imageUrl.split(',')[1];
    return Uint8Array.from(atob(b64), c => c.charCodeAt(0));
  }
  const resp = await fetch(imageUrl);
  if (!resp.ok) throw new Error(`Failed to fetch image: ${resp.status}`);
  return new Uint8Array(await resp.arrayBuffer());
}
