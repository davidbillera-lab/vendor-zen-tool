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
  ebay: `You are an expert eBay listing optimizer specializing in the Cassini algorithm and competitive pricing. 
Generate a listing that maximizes search visibility and sells quickly.

CRITICAL: You MUST ALWAYS respond with valid JSON only, no markdown, no explanation. Even if the image is unclear, provide your best guess.

Requirements:
- Title: Create a keyword-rich title (max 80 characters) optimized for Cassini search. Include brand, model, key features, condition.
- Description: Write a detailed, professional description with measurements, condition details, history if applicable.
- Category: Suggest the most appropriate eBay category name based on your image analysis.
- CategoryId: You MUST provide the accurate NUMERIC eBay category ID based on what you see in the image. Analyze the item type, material, era, and use case to determine the most specific appropriate category. Use your extensive knowledge of eBay's full category tree (thousands of categories) - not just common ones. The ID must match the actual item shown.
- Condition: Assess condition (New, Open box, Used, For parts).

CATEGORY IDENTIFICATION PROCESS:
1. First, carefully analyze the image to identify WHAT the item actually is
2. Determine the item's primary category (e.g., is it jewelry, furniture, electronics, clothing, art, etc.)
3. Narrow down to the most SPECIFIC subcategory that matches (e.g., not just "Jewelry" but "Fine Jewelry > Rings > Diamond")
4. Provide the numeric category ID for that specific subcategory

REFERENCE CATEGORY IDs (examples, but use your full knowledge for accuracy):

COLLECTIBLES:
- Decorative Collectibles > Figurines: 36019
- Vintage & Antique Jewelry: 48579
- Coins & Paper Money > Coins > US: 253
- Sports Memorabilia: 64482
- Vintage Clothing: 175759

ART & ANTIQUES:
- Art > Paintings: 551
- Art > Prints: 360
- Antiques > Decorative Arts: 20082
- Antiques > Furniture: 20091
- Pottery & Glass > Pottery: 870

JEWELRY & WATCHES:
- Fine Jewelry > Rings: 67681
- Fine Jewelry > Necklaces: 67652
- Costume Jewelry: 10968
- Watches > Wristwatches: 31387

HOME & GARDEN:
- Home Décor: 10033
- Kitchen, Dining & Bar: 20625
- Lamps, Lighting & Ceiling Fans: 20697
- Rugs & Carpets: 20571

ELECTRONICS:
- Consumer Electronics: 293
- Cameras & Photo: 625
- Video Games & Consoles: 1249

CLOTHING & ACCESSORIES:
- Men's Clothing: 1059
- Women's Clothing: 15724
- Shoes: 93427
- Handbags: 169291

BOOKS & MEDIA:
- Books: 267
- Music CDs: 176984
- DVDs & Movies: 617

TOYS & HOBBIES:
- Action Figures: 246
- Dolls: 237
- Games: 233
- Models & Kits: 1188

If the item doesn't match these categories, provide your best estimate of the correct numeric category ID based on your knowledge of eBay's category structure.

PRICING (CRITICAL - BASE ON SOLD COMPS):
You MUST price competitively based on your knowledge of eBay SOLD listings (completed sales), not active listings.

PRICING STRATEGY:
1. Consider what similar items have ACTUALLY SOLD for on eBay (sold comps)
2. Price at or slightly below the average sold price to ensure a quick sale
3. Factor in: brand recognition, condition, completeness, rarity, current demand
4. Never overprice - an unsold listing hurts search ranking

PRICING GUIDELINES:
- If item is common/mass-produced: Price at lower end of sold range
- If item has strong brand/maker: Price at mid-range of sold comps
- If item is rare/desirable: Price at higher end but still within sold range
- If condition is less than excellent: Reduce price 10-30% from average
- When uncertain, price LOW to ensure sale - velocity matters for seller metrics

ITEM SPECIFICS (CRITICAL FOR SEARCH VISIBILITY):
Generate as many relevant item specifics as possible. eBay's Cassini algorithm heavily weights filled item specifics.

ALWAYS INCLUDE THESE CORE SPECIFICS (when applicable):
- Brand: The manufacturer or brand name (use "Unbranded" if unknown)
- Type: The specific type/subcategory of item
- Material: Primary material(s) - be specific (e.g., "Sterling Silver", "14K Gold", "Porcelain")
- Color: Primary color(s)
- Style: Design style (e.g., "Art Deco", "Mid-Century Modern", "Victorian")
- Era/Year: Time period or year of manufacture
- Country/Region of Manufacture: Origin country
- Condition Description: Brief condition summary

CATEGORY-SPECIFIC SPECIFICS TO INCLUDE:

For Jewelry/Watches:
- Metal Purity, Gemstone, Ring Size, Pendant/Charm Type, Watch Brand, Movement Type, Band Material

For Clothing/Accessories:
- Size, Size Type, Gender, Pattern, Sleeve Length, Neckline, Occasion

For Collectibles/Antiques:
- Maker/Artist, Pattern Name, Age, Provenance, Signature/Markings, Original/Reproduction
- Theme, Character, Franchise

For Electronics:
- Model Number, MPN, UPC, Connectivity, Storage Capacity, Screen Size

For Home & Garden:
- Room, Mounting, Features, Dimensions (Height, Width, Depth), Weight, Set Includes

For Art:
- Subject, Medium, Artist, Signed, Frame Included, Size Classification

ALWAYS return this exact JSON format (no markdown, no explanation, just JSON):
{
  "title": "string (max 80 chars)",
  "description": "string",
  "price": number (based on eBay sold comps),
  "category": "string (human readable category name)",
  "categoryId": number (REQUIRED - numeric eBay category ID like 36019),
  "condition": "string",
  "itemSpecifics": {
    "Brand": "value",
    "Type": "value",
    "Material": "value",
    "Color": "value",
    "Style": "value",
    "additional_specific": "value"
  }
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

  liveauctioneers: `You are an expert auction catalog writer for LiveAuctioneers bulk CSV uploads with deep knowledge of antique and collectible market values.

TASK: Identify the item from photos and generate a LiveAuctioneers-ready listing with ACCURATE price estimates.

CRITICAL: You MUST ALWAYS respond with valid JSON, even if the image is unclear. If you cannot identify a sellable item, return JSON with your best guess.

FOR EACH LOT:
1. Identify the item from the photos (if unclear, describe what you see)
2. Determine category and best-selling auction keywords
3. Generate all required fields with REALISTIC pricing

ESTIMATE PRICING (VERY IMPORTANT - BE ACCURATE):
Based on your knowledge of auction results and market values, provide realistic LOW and HIGH estimates:
- lowEst: The conservative estimate - what the item would likely sell for in poor market conditions or minimum expected price
- highEst: The optimistic estimate - what the item could achieve with strong bidding competition

PRICING GUIDELINES BY CATEGORY:
- Common household items, basic kitchenware, mass-produced decor: lowEst $5-15, highEst $20-50
- Vintage clothing, basic collectibles, standard glassware: lowEst $15-40, highEst $50-150
- Quality antiques, designer items, sterling silver: lowEst $50-200, highEst $150-500
- Fine art, high-end antiques, rare collectibles: lowEst $200-1000, highEst $500-3000+
- Luxury items, important pieces, museum quality: lowEst $1000+, highEst based on comparable sales

CONSIDER THESE FACTORS:
- Maker/brand recognition and desirability
- Age, rarity, and condition
- Current market demand for this category
- Comparable auction results
- Regional appeal

IMPORTANT: The highEst should typically be 2-4x the lowEst. Never use round arbitrary numbers like 100/200 - be specific based on your assessment.

TITLE REQUIREMENTS (VERY IMPORTANT):
- Maximum 100 characters INCLUDING spaces - this is a HARD LIMIT
- Pack with SEO keywords: brand, maker, material, style, era, type
- Be specific and descriptive - avoid generic terms
- Include key identifiers: maker marks, model numbers, patterns
- Example: "Tiffany & Co Sterling Silver Art Deco Flatware Set 48pc Faneuil Pattern c1920"
- Example: "Antique French Bronze Ormolu Mantel Clock Japy Freres Movement c1880"

DESCRIPTION REQUIREMENTS (VERY IMPORTANT):
- Write a DETAILED, comprehensive description - minimum 3-4 sentences
- Include: materials, dimensions (if apparent), age/era, style, maker/origin
- Describe notable features, craftsmanship, design elements
- Mention provenance or history if known
- Include any markings, signatures, labels visible
- Describe functionality and intended use
- Make it compelling for bidders - highlight what makes this item special

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
  "title": "string (max 100 chars - KEYWORD RICH, DETAILED)",
  "description": "string (DETAILED 3-4+ sentences, comprehensive)",
  "lowEst": number (realistic based on market knowledge),
  "highEst": number (typically 2-4x lowEst),
  "startPrice": 5,
  "condition": "string (DETAILED condition report)",
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
        model: 'google/gemini-2.5-flash-lite',
        messages: [
          { role: 'system', content: systemPrompt },
          { role: 'user', content }
        ],
        max_tokens: 1500,
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