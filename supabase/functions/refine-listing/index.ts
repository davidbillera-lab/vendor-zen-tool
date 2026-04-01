import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
};

interface RefineRequest {
  currentListing: Record<string, any>;
  correctionPrompt: string;
  imageUrls: string[];
  platform?: string;
  mode?: 'refine' | 'verify'; // verify = cross-check with second LLM
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
      return new Response(
        JSON.stringify({ error: 'Invalid or expired token' }),
        { status: 401, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      );
    }

    const { currentListing, correctionPrompt, imageUrls, platform, mode } = await req.json() as RefineRequest;
    
    console.log(`Refine mode=${mode || 'refine'}, platform=${platform || 'liveauctioneers'}, prompt=${correctionPrompt || '(verify)'}`);

    const LOVABLE_API_KEY = Deno.env.get('LOVABLE_API_KEY');
    if (!LOVABLE_API_KEY) {
      throw new Error('LOVABLE_API_KEY is not configured');
    }

    // Build content with images
    const content: any[] = [];
    for (const url of (imageUrls || []).slice(0, 4)) {
      content.push({ type: "image_url", image_url: { url } });
    }

    let systemPrompt: string;
    let model: string;

    if (mode === 'verify' && platform === 'ebay') {
      // ═══ VERIFICATION MODE: Cross-check with a different model ═══
      model = 'openai/gpt-5-mini';
      systemPrompt = `You are a specialist item authenticator and identifier for eBay listings. A first-pass AI generated the listing below. Your job is to VERIFY and CORRECT any misidentifications.`;

      content.push({
        type: "text",
        text: `CAREFULLY study the image(s) and compare against the generated listing. Focus especially on:
1. Is the ITEM IDENTIFICATION correct? (e.g., is it really a model train vs a toy car? The right brand/maker? The right era?)
2. Is the CATEGORY correct for what's shown?
3. Is the TITLE accurate and keyword-rich for what the item ACTUALLY is?
4. Are the ITEM SPECIFICS accurate (brand, material, era, model)?
5. Is the PRICE realistic for this specific item?

${correctionPrompt ? `Seller notes: ${correctionPrompt}` : ''}

FIRST-PASS LISTING TO VERIFY:
Title: ${currentListing.title}
Category: ${currentListing.category} (ID: ${currentListing.categoryId || currentListing.category_id || ''})
Price: $${currentListing.price}
Condition: ${currentListing.condition}
Item Specifics: ${JSON.stringify(currentListing.itemSpecifics || currentListing.item_specifics || {})}
Description (first 300 chars): ${(currentListing.description || '').substring(0, 300)}...

RESPOND WITH VALID JSON ONLY:
{
  "verified": true/false,
  "title": "corrected or original title (max 80 chars)",
  "description": "corrected or original description (150+ words)",
  "price": number,
  "categoryId": number,
  "category": "string",
  "condition": "string",
  "itemSpecifics": { ... },
  "confidence": "high/medium/low",
  "notes": "brief explanation of what was confirmed or corrected"
}`
      });
    } else if (platform === 'ebay') {
      // ═══ EBAY REFINEMENT MODE ═══
      model = 'google/gemini-2.5-flash';
      systemPrompt = `You are an expert eBay listing editor. Refine the listing based on the seller's feedback. 
Keep all fields the user didn't mention EXACTLY as they are. Title MUST stay under 80 characters.
ALWAYS return valid JSON with the same structure, no markdown.`;

      content.push({
        type: "text",
        text: `Current eBay listing:
${JSON.stringify(currentListing, null, 2)}

Seller's request: "${correctionPrompt}"

Return the COMPLETE updated listing as JSON with these fields:
{ "title", "description", "price", "categoryId", "category", "condition", "itemSpecifics" }`
      });
    } else {
      // ═══ LIVEAUCTIONEERS / OTHER REFINEMENT ═══
      model = 'google/gemini-2.5-flash-lite';
      systemPrompt = `You are an expert auction catalog editor for LiveAuctioneers. 
Your task is to refine an existing listing based on user feedback.

IMPORTANT RULES:
1. ONLY modify the fields that the user's correction prompt relates to
2. Keep all other fields EXACTLY as they are
3. Maintain the same JSON structure
4. If the user asks about pricing (lowEst, highEst, startPrice), adjust those fields appropriately
5. If the user asks about the title, keep it under 100 characters
6. If the user asks about description, make it detailed and compelling
7. For condition updates, be specific about flaws and wear

ALWAYS return valid JSON with the same structure as the input, no markdown, no explanation.`;

      content.push({
        type: "text",
        text: `Current listing JSON:
${JSON.stringify(currentListing, null, 2)}

User's correction request: "${correctionPrompt}"

Please update the listing based on the user's request and return the complete updated JSON.`
      });
    }

    console.log(`Calling Lovable AI (${model})...`);

    const response = await fetch('https://ai.gateway.lovable.dev/v1/chat/completions', {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${LOVABLE_API_KEY}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        model,
        messages: [
          { role: 'system', content: systemPrompt },
          { role: 'user', content }
        ],
        ...(model.startsWith('openai/') ? { max_completion_tokens: 2500 } : { max_tokens: 2500 }),
        temperature: 0.2,
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
          JSON.stringify({ error: 'AI credits exhausted. Please add credits to continue.' }),
          { status: 402, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
        );
      }
      
      throw new Error(`AI gateway error: ${response.status}`);
    }

    const data = await response.json();
    const aiResponse = data.choices?.[0]?.message?.content;
    
    console.log('AI refinement response received');

    let refinedListing;
    try {
      const jsonMatch = aiResponse.match(/```(?:json)?\s*([\s\S]*?)```/) || [null, aiResponse];
      refinedListing = JSON.parse(jsonMatch[1].trim());
    } catch (parseError) {
      console.error('Failed to parse AI response:', aiResponse);
      throw new Error('Failed to parse AI response as JSON');
    }

    // For verify mode, include verification metadata
    if (mode === 'verify') {
      return new Response(
        JSON.stringify({ 
          listing: refinedListing,
          verified: refinedListing.verified ?? true,
          confidence: refinedListing.confidence || 'unknown',
          notes: refinedListing.notes || ''
        }),
        { headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      );
    }

    return new Response(
      JSON.stringify({ listing: refinedListing }),
      { headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
    );

  } catch (error) {
    console.error('Error in refine-listing:', error);
    return new Response(
      JSON.stringify({ error: error instanceof Error ? error.message : 'Unknown error' }),
      { status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
    );
  }
});
