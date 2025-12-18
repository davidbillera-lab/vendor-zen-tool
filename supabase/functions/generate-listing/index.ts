import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
};

interface GenerateRequest {
  platform: 'ebay' | 'facebook' | 'liveauctioneers' | 'denver';
  imageUrls: string[];
  additionalContext?: string;
}

const PLATFORM_PROMPTS = {
  ebay: `You are an expert eBay listing optimizer specializing in the Cassini algorithm. 
Generate a listing that maximizes search visibility and sales.

CRITICAL: You MUST ALWAYS respond with valid JSON only, no markdown, no explanation. Even if the image is unclear, provide your best guess.

Requirements:
- Title: Create a keyword-rich title (max 80 characters) optimized for Cassini search. Include brand, model, key features, condition.
- Description: Write a detailed, professional description with measurements, condition details, history if applicable.
- Price: Suggest a competitive price based on typical sold prices for similar items.
- Category: Suggest the most appropriate eBay category.
- Condition: Assess condition (New, Like New, Very Good, Good, Acceptable).
- Item Specifics: List relevant item specifics as key-value pairs.

ALWAYS return this exact JSON format (no markdown, no explanation, just JSON):
{
  "title": "string (max 80 chars)",
  "description": "string",
  "price": number,
  "category": "string",
  "condition": "string",
  "itemSpecifics": { "key": "value" }
}`,

  facebook: `You are an expert Facebook Marketplace listing creator.
Generate a listing optimized for Facebook's marketplace and groups.

CRITICAL: You MUST ALWAYS respond with valid JSON only, no markdown, no explanation. Even if the image is unclear, provide your best guess.

Requirements:
- Title: Create a clear, engaging title (max 100 characters) that catches attention.
- Description: Write a friendly, conversational description with key details. Include condition, features, and why someone should buy.
- Price: Suggest a competitive local market price.
- Category: Suggest the most appropriate Facebook Marketplace category.
- Condition: Assess condition (New, Like New, Good, Fair).

ALWAYS return this exact JSON format (no markdown, no explanation, just JSON):
{
  "title": "string (max 100 chars)",
  "description": "string",
  "price": number,
  "category": "string",
  "condition": "string"
}`,

  liveauctioneers: `You are an expert auction catalog writer for LiveAuctioneers bulk CSV uploads.

TASK: Identify the item from photos and generate a LiveAuctioneers-ready listing.

CRITICAL: You MUST ALWAYS respond with valid JSON, even if the image is unclear or shows a logo/graphic instead of a product. If you cannot identify a sellable item, return JSON with your best guess or a placeholder.

FOR EACH LOT:
1. Identify the item from the photos (if unclear, describe what you see)
2. Determine category and best-selling auction keywords
3. Generate:
   - Title: SEO-rich, concise, auction-grade (MAX 100 characters including spaces)
   - Description: Short, appealing, factual
   - Condition: DETAILED condition report - this is CRITICAL for auction items
   - LowEst: Conservative low estimate in dollars
   - HighEst: Optimistic high estimate (must be > LowEst)
   - StartPrice: ALWAYS $5 unless the user specifically requests a different starting price

CONDITION ANALYSIS (VERY IMPORTANT):
Examine photos carefully and provide a DETAILED condition report including:
- Overall condition grade (Excellent, Very Good, Good, Fair, Poor)
- Visible wear, scratches, chips, cracks, stains, fading, discoloration
- Missing parts or damage
- Signs of age, patina, or restoration
- Functionality issues if apparent
- Any notable flaws or imperfections
Example: "Good condition with light wear consistent with age. Minor scratches to base, small chip to rim (1/4 inch), original patina intact. No cracks or repairs noted."

DEFAULTS:
- Consigner: "JSG"
- Location Nickname: "Highlands Ranch"
- StartPrice: 5 (ALWAYS use 5 unless user specifies otherwise)

ALWAYS return this exact JSON format (no markdown, no explanation, just JSON):
{
  "title": "string (max 100 chars)",
  "description": "string (short, appealing, factual)",
  "lowEst": number,
  "highEst": number,
  "startPrice": 5,
  "condition": "string (DETAILED condition report as described above)",
  "consigner": "JSG",
  "buyNowPrice": null,
  "excludeFromBuyNow": null,
  "reservePrice": null,
  "height": null,
  "width": null,
  "depth": null,
  "dimensionUnit": null,
  "weight": null,
  "weightUnit": null,
  "domesticFlatShippingPrice": null,
  "quantity": 1,
  "category": "string",
  "origin": null,
  "stylePeriod": null,
  "creator": null,
  "materials": null,
  "lotReferenceNumber": null,
  "locationNickname": "Highlands Ranch"
}`,

  denver: `You are an expert auction catalog writer for Denver Online Auctions.
Generate a professional lot description optimized for copy-paste into their system.

CRITICAL: You MUST ALWAYS respond with valid JSON only, no markdown, no explanation. Even if the image is unclear, provide your best guess.

Requirements:
- Title: Create a clear, descriptive title (max 100 characters). Should start with the item type.
- Description: Write a detailed description with measurements, condition, and key features. Format for easy reading.
- Starting Bid: Suggest a conservative starting bid in dollars (integer, no decimals). Consider item type, condition, and typical auction values.

ALWAYS return this exact JSON format (no markdown, no explanation, just JSON):
{
  "title": "string (max 100 chars)",
  "description": "string",
  "startingBid": number
}`
};

serve(async (req) => {
  if (req.method === 'OPTIONS') {
    return new Response(null, { headers: corsHeaders });
  }

  try {
    // Authenticate the request
    const authHeader = req.headers.get('Authorization');
    if (!authHeader) {
      console.error('No authorization header provided');
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

    const { platform, imageUrls, additionalContext } = await req.json() as GenerateRequest;
    
    console.log(`Generating listing for platform: ${platform}`);
    console.log(`Image URLs: ${imageUrls.length}`);

    const LOVABLE_API_KEY = Deno.env.get('LOVABLE_API_KEY');
    if (!LOVABLE_API_KEY) {
      throw new Error('LOVABLE_API_KEY is not configured');
    }

    const systemPrompt = PLATFORM_PROMPTS[platform];
    if (!systemPrompt) {
      throw new Error(`Unknown platform: ${platform}`);
    }

    // Build content array with images
    const content: any[] = [];
    
    // Add images first for visual analysis
    for (const url of imageUrls) {
      content.push({
        type: "image_url",
        image_url: { url }
      });
    }

    // Add text prompt
    let textPrompt = "Analyze the item(s) in the image(s) and generate a listing.";
    if (additionalContext) {
      textPrompt += ` Additional context from seller: ${additionalContext}`;
    }
    content.push({ type: "text", text: textPrompt });

    console.log('Calling Lovable AI...');
    
    const response = await fetch('https://ai.gateway.lovable.dev/v1/chat/completions', {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${LOVABLE_API_KEY}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        model: 'google/gemini-2.5-flash',
        messages: [
          { role: 'system', content: systemPrompt },
          { role: 'user', content }
        ],
        max_tokens: 2000,
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
    
    console.log('AI Response received');

    // Parse the JSON from the response
    let parsedListing;
    try {
      // Extract JSON from potential markdown code blocks
      const jsonMatch = aiResponse.match(/```(?:json)?\s*([\s\S]*?)```/) || [null, aiResponse];
      const jsonStr = jsonMatch[1].trim();
      parsedListing = JSON.parse(jsonStr);
    } catch (parseError) {
      console.error('Failed to parse AI response:', aiResponse);
      throw new Error('Failed to parse AI response as JSON');
    }

    return new Response(
      JSON.stringify({ listing: parsedListing, rawResponse: aiResponse }),
      { headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
    );

  } catch (error) {
    console.error('Error in generate-listing:', error);
    return new Response(
      JSON.stringify({ error: error instanceof Error ? error.message : 'Unknown error' }),
      { status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
    );
  }
});