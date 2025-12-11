import { serve } from "https://deno.land/std@0.168.0/http/server.ts";

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

Requirements:
- Title: Create a keyword-rich title (max 80 characters) optimized for Cassini search. Include brand, model, key features, condition.
- Description: Write a detailed, professional description with measurements, condition details, history if applicable.
- Price: Suggest a competitive price based on typical sold prices for similar items.
- Category: Suggest the most appropriate eBay category.
- Condition: Assess condition (New, Like New, Very Good, Good, Acceptable).
- Item Specifics: List relevant item specifics as key-value pairs.

Return JSON format:
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

Requirements:
- Title: Create a clear, engaging title (max 100 characters) that catches attention.
- Description: Write a friendly, conversational description with key details. Include condition, features, and why someone should buy.
- Price: Suggest a competitive local market price.
- Category: Suggest the most appropriate Facebook Marketplace category.
- Condition: Assess condition (New, Like New, Good, Fair).

Return JSON format:
{
  "title": "string (max 100 chars)",
  "description": "string",
  "price": number,
  "category": "string",
  "condition": "string"
}`,

  liveauctioneers: `You are an expert auction catalog writer for LiveAuctioneers bulk CSV uploads.
Generate a professional auction lot with SEO optimization following EXACT LiveAuctioneers format.

REQUIRED FIELDS:
- LotNum: Will be provided by user
- Title: SEO keyword-rich title (MUST be EXACTLY 100 characters or less INCLUDING spaces). Include era, style, material, maker if known. Front-load important keywords.
- Description: Detailed auction catalog description. Include: provenance, measurements (height x width x depth), condition report with ALL damages noted, notable features, materials. Be thorough - this reduces buyer inquiries.
- LowEst: Conservative low estimate in dollars (integer)
- HighEst: Optimistic high estimate in dollars (must be higher than LowEst)
- StartPrice: Starting bid price (must be ≤ LowEst, typically 40-50% of LowEst)

OPTIONAL FIELDS TO INCLUDE:
- Condition: Detailed condition report
- Height, Width, Depth: Numeric dimensions
- DimensionUnit: "in", "ft", or "cm"
- Weight: Numeric weight
- WeightUnit: "oz", "lb", "g", or "kg"
- Category: LiveAuctioneers category name
- Origin: Geographic origin
- StylePeriod: Style and period (e.g., "Art Deco", "Victorian", "Mid-Century Modern")
- Creator: Artist/maker name if known
- Materials: Materials and techniques

Return JSON format:
{
  "title": "string (EXACTLY max 100 chars including spaces)",
  "description": "string (detailed with measurements and condition)",
  "lowEst": number,
  "highEst": number,
  "startPrice": number,
  "condition": "string",
  "height": number or null,
  "width": number or null,
  "depth": number or null,
  "dimensionUnit": "in" | "ft" | "cm" | null,
  "weight": number or null,
  "weightUnit": "oz" | "lb" | "g" | "kg" | null,
  "category": "string",
  "origin": "string",
  "stylePeriod": "string",
  "creator": "string or null",
  "materials": "string"
}`,

  denver: `You are an expert auction catalog writer for Denver Online Auctions.
Generate a professional lot description optimized for copy-paste into their system.

Requirements:
- Title: Create a clear, descriptive title (max 100 characters).
- Description: Write a detailed description with measurements, condition, and key features. Format for easy reading.

Return JSON format:
{
  "title": "string (max 100 chars)",
  "description": "string"
}`
};

serve(async (req) => {
  if (req.method === 'OPTIONS') {
    return new Response(null, { headers: corsHeaders });
  }

  try {
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