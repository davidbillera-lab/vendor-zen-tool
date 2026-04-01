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

const DENVER_PROMPT = `You are an expert auction catalog writer, SEO/GEO specialist, and antiques appraiser for Denver Online Auctions.
Generate a professional lot listing optimized for BOTH search engine optimization (SEO) AND geographic/local search optimization (GEO) for the Colorado auction market.

CRITICAL: You MUST ALWAYS respond with valid JSON only, no markdown, no explanation. Even if the image is unclear, provide your best guess.

=== TITLE (HARD LIMIT: 100 CHARACTERS INCLUDING SPACES — SEO + GEO OPTIMIZED) ===
- MUST be 100 characters or fewer including spaces — COUNT EVERY CHARACTER CAREFULLY
- Front-load the most searchable keywords: Brand/Maker + Item Type + Material + Style/Era
- Use exact terms buyers search for (e.g., "Mid Century Modern Teak Credenza" not "Nice Wood Cabinet")
- Include GEO-relevant terms when applicable: regional makers, Colorado-relevant items, Western/Southwestern styles
- Include differentiators: color, size, pattern name, model, origin, era dates
- NO filler words (beautiful, nice, great, amazing, wow, look, stunning, gorgeous)
- Every single word must serve a search purpose — maximize keyword density naturally
- Use long-tail keywords that match niche collector searches

SEO/GEO TITLE STRATEGY:
1. Brand/Maker FIRST (most valuable search signal)
2. Item type using exact buyer search vocabulary
3. Material (sterling silver, solid oak, 14k gold, hand-blown glass)
4. Style/Period (Art Deco, Mid Century Modern, Victorian, Craftsman)
5. Key differentiator (size, color, pattern, set count, c.1920)

GOOD EXAMPLES:
- "Vintage Pyrex Pink Gooseberry Casserole Dish 1.5 Qt with Lid 1950s Ovenware" (76 chars)
- "Henredon Campaign Style Mahogany Nightstand Brass Hardware Mid Century" (70 chars)
- "Native American Navajo Sterling Silver Turquoise Squash Blossom Necklace c1970" (78 chars)
- "Antique Cast Iron Griswold #8 Skillet 704 Erie PA Small Logo Heat Ring" (70 chars)

=== DESCRIPTION (IN-DEPTH, COMPREHENSIVE — MINIMUM 5-8 SENTENCES) ===
Your description must be a THOROUGH, expert-level write-up. Think like an auction house cataloger at Christie's or Sotheby's.

REQUIRED DESCRIPTION SECTIONS (weave naturally, don't use headers):
1. **IDENTIFICATION & OVERVIEW**: What exactly is this item? Be precise. Include maker, brand, model, pattern name, era, and origin.
2. **DETAILED PHYSICAL DESCRIPTION**: Materials, construction methods, colors, textures, dimensions (estimate from photos if needed), weight class, decorative elements, hardware, mechanisms.
3. **HISTORICAL CONTEXT & PROVENANCE**: Research and include any backstory:
   - When was this made? What era/period does it represent?
   - Who made it? Is the maker significant? What is their history?
   - What was this item's original purpose? How was it used?
   - Is this part of a known pattern, series, or collection?
   - Any cultural significance, design movement connections, or historical relevance?
4. **INTERESTING DETAILS & OBSERVATIONS**: Things an expert would notice:
   - Maker's marks, stamps, signatures, labels, patent numbers
   - Construction techniques that indicate quality or era (dovetail joints, hand-forged, hand-painted)
   - Design influences or stylistic connections
   - Rarity indicators — was this a limited production? Discontinued? Regional specialty?
   - Notable features that distinguish this from similar items
5. **CONDITION REPORT** (MANDATORY — be thorough and honest):
   - Overall condition grade (Excellent, Very Good, Good, Fair, Poor)
   - Specific wear: scratches, chips, cracks, dents, stains, fading, discoloration, foxing, tarnish
   - Structural integrity: loose joints, wobble, missing parts, repairs, restoration
   - Patina: original finish, refinished, natural aging, oxidation
   - Functionality: does it work? Missing components? Battery operated?
   - Completeness: all original parts present? Original box/packaging?
   - Example: "Shows honest wear consistent with 60+ years of use including light surface scratches to the top, a small chip to the rear left foot (3/8 inch), and expected patina to the brass pulls. No structural damage, cracks, or repairs. All four original casters present and functional."

DESCRIPTION TONE:
- Write like a knowledgeable dealer speaking to a collector
- Be factual and specific, not flowery
- Include keywords naturally for search visibility
- Make buyers feel confident about what they're bidding on

=== STARTING BID ===
- Suggest a conservative starting bid in dollars (integer, no decimals)
- Consider item type, condition, brand value, rarity, and typical Denver auction values
- Low starting bids ($5-$25) generate more bidding activity

ALWAYS return this exact JSON format (no markdown, no explanation, just JSON):
{
  "title": "string (MUST be ≤100 chars including spaces, SEO/GEO keyword-rich title)",
  "description": "string (5-8+ sentences, comprehensive with condition report, history, and expert observations)",
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
