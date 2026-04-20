// supabase/functions/reformat-listing/index.ts
import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
};

serve(async (req) => {
  if (req.method === 'OPTIONS') {
    return new Response(null, { headers: corsHeaders });
  }

  try {
    // Auth check
    const authHeader = req.headers.get('Authorization');
    if (!authHeader) {
      return new Response(JSON.stringify({ error: 'Authorization required' }), {
        status: 401, headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      });
    }

    const supabase = createClient(
      Deno.env.get('SUPABASE_URL')!,
      Deno.env.get('SUPABASE_ANON_KEY')!,
      { global: { headers: { Authorization: authHeader } } }
    );

    const { data: { user }, error: authError } = await supabase.auth.getUser();
    if (authError || !user) {
      return new Response(JSON.stringify({ error: 'Invalid or expired token' }), {
        status: 401, headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      });
    }

    const { platform, listing, imageUrls, formatPrompt } = await req.json();

    if (!platform || !listing || !formatPrompt) {
      return new Response(JSON.stringify({ error: 'Missing required fields: platform, listing, formatPrompt' }), {
        status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      });
    }

    const LOVABLE_API_KEY = Deno.env.get('LOVABLE_API_KEY');
    if (!LOVABLE_API_KEY) throw new Error('LOVABLE_API_KEY not configured');

    // Build content array — pass up to 2 images for context (reformatting doesn't need all 4)
    const content: any[] = [];
    const previewImages = (imageUrls || []).slice(0, 2);
    for (const url of previewImages) {
      content.push({ type: "image_url", image_url: { url } });
    }

    const listingSummary = [
      `Title: ${listing.title || ''}`,
      `Description: ${(listing.description || '').substring(0, 400)}`,
      `Price: $${listing.price || 0}`,
      `Category: ${listing.category || ''}`,
      `Condition: ${listing.condition || ''}`,
      listing.itemSpecifics ? `Item Specifics: ${JSON.stringify(listing.itemSpecifics)}` : '',
      listing.lowEst ? `Estimates: $${listing.lowEst} – $${listing.highEst}` : '',
    ].filter(Boolean).join('\n');

    content.push({
      type: "text",
      text: `Reformat this listing for the target platform.\n\nSOURCE LISTING:\n${listingSummary}`,
    });

    const response = await fetch('https://ai.gateway.lovable.dev/v1/chat/completions', {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${LOVABLE_API_KEY}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        model: 'google/gemini-2.5-flash',
        messages: [
          { role: 'system', content: formatPrompt },
          { role: 'user', content },
        ],
        max_tokens: 1500,
        temperature: 0.2,
      }),
    });

    if (!response.ok) {
      const errorText = await response.text();
      throw new Error(`AI gateway error ${response.status}: ${errorText}`);
    }

    const aiData = await response.json();
    const aiText = aiData.choices?.[0]?.message?.content || '';

    let formatted: Record<string, any>;
    try {
      const match = aiText.match(/```(?:json)?\s*([\s\S]*?)```/) || [null, aiText];
      formatted = JSON.parse(match[1].trim());
    } catch {
      throw new Error('AI did not return valid JSON');
    }

    return new Response(JSON.stringify({ formatted }), {
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    });

  } catch (err) {
    console.error('reformat-listing error:', err);
    return new Response(JSON.stringify({ error: err instanceof Error ? err.message : 'Unknown error' }), {
      status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    });
  }
});
