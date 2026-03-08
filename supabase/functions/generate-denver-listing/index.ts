import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
};

interface GenerateRequest {
  imageUrls: string[];
  additionalContext?: string;
}

const DENVER_PROMPT = `You are an expert auction catalog writer and SEO specialist for Denver Online Auctions.
Generate a professional lot listing optimized for search visibility and buyer discovery.

CRITICAL: You MUST ALWAYS respond with valid JSON only, no markdown, no explanation. Even if the image is unclear, provide your best guess.

=== TITLE (HARD LIMIT: 100 CHARACTERS — SEO KEYWORD RICH) ===
- MUST be 100 characters or fewer including spaces — COUNT CAREFULLY
- Front-load the most searchable keywords: Brand/Maker + Item Type + Material + Style/Era
- Use exact terms buyers search for (e.g., "Mid Century Modern Teak Credenza" not "Nice Wood Cabinet")
- Include differentiators: color, size, pattern name, model, origin
- NO filler words (beautiful, nice, great, amazing, wow, look)
- Every word must serve a search purpose

GOOD EXAMPLES:
- "Vintage Pyrex Pink Gooseberry Casserole Dish 1.5 Qt with Lid 1950s Ovenware" (76 chars)
- "Henredon Campaign Style Mahogany Nightstand Brass Hardware Mid Century" (70 chars)
- "Waterford Crystal Lismore Wine Glasses Set of 6 Cut Glass Stemware" (66 chars)

=== DESCRIPTION (FULL, COMPLETE TEXT — NO TRUNCATION) ===
- Write a complete description in natural language (2-4 sentences)
- Include condition, notable features, materials, dimensions (if known), and any defects
- Do NOT cut off words or sentences
- Keep it buyer-friendly and keyword-rich without sounding robotic

=== STARTING BID ===
- Suggest a conservative starting bid in dollars (integer, no decimals)
- Consider item type, condition, brand value, and typical Denver auction values

ALWAYS return this exact JSON format (no markdown, no explanation, just JSON):
{
  "title": "string (MUST be ≤100 chars, keyword-rich SEO title)",
  "description": "string (full complete description, no truncation)",
  "startingBid": number
}`;

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
      Deno.env.get('SUPABASE_ANON_KEY')!,
      { global: { headers: { Authorization: authHeader } } }
    );

    const { data: { user }, error: authError } = await supabase.auth.getUser();
    if (authError || !user) {
      return new Response(
        JSON.stringify({ error: 'Invalid or expired token' }),
        { status: 401, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      );
    }

    console.log(`Authenticated user: ${user.id}`);

    const { imageUrls, additionalContext } = await req.json() as GenerateRequest;
    console.log(`Generating Denver listing, images: ${imageUrls.length}`);

    const LOVABLE_API_KEY = Deno.env.get('LOVABLE_API_KEY');
    if (!LOVABLE_API_KEY) {
      throw new Error('LOVABLE_API_KEY is not configured');
    }

    const content: any[] = [];
    const maxImages = Math.min(imageUrls.length, 4);
    for (let i = 0; i < maxImages; i++) {
      content.push({ type: "image_url", image_url: { url: imageUrls[i] } });
    }

    let textPrompt = "Analyze the item(s) in the image(s) and generate a Denver Online Auctions listing.";
    if (additionalContext) {
      textPrompt += ` Additional context from seller: ${additionalContext}`;
    }
    content.push({ type: "text", text: textPrompt });

    const response = await fetch('https://ai.gateway.lovable.dev/v1/chat/completions', {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${LOVABLE_API_KEY}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        model: 'google/gemini-2.5-flash-lite',
        messages: [
          { role: 'system', content: DENVER_PROMPT },
          { role: 'user', content }
        ],
        max_tokens: 1000,
        temperature: 0.3,
      }),
    });

    if (!response.ok) {
      const errorText = await response.text();
      console.error('AI gateway error:', response.status, errorText);
      if (response.status === 429) {
        return new Response(
          JSON.stringify({ error: 'Rate limit exceeded. Please try again later.' }),
          { status: 429, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
        );
      }
      if (response.status === 402) {
        return new Response(
          JSON.stringify({ error: 'AI credits exhausted.' }),
          { status: 402, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
        );
      }
      throw new Error(`AI gateway error: ${response.status}`);
    }

    const data = await response.json();
    const aiResponse = data.choices?.[0]?.message?.content;
    console.log('AI Response received');

    let parsedListing: any;
    try {
      const jsonMatch = aiResponse.match(/```(?:json)?\s*([\s\S]*?)```/) || [null, aiResponse];
      parsedListing = JSON.parse(jsonMatch[1].trim());
    } catch (parseError) {
      console.error('Failed to parse AI response:', aiResponse);
      throw new Error('Failed to parse AI response as JSON');
    }

    return new Response(
      JSON.stringify({ listing: parsedListing, rawResponse: aiResponse }),
      { headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
    );

  } catch (error) {
    console.error('Error in generate-denver-listing:', error);
    return new Response(
      JSON.stringify({ error: error instanceof Error ? error.message : 'Unknown error' }),
      { status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
    );
  }
});
