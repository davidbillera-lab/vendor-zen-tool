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
  masterPrompt?: string;
}

const PLATFORM_PROMPTS = {
  ebay: `You are an expert eBay seller and listing optimizer with deep knowledge of sold comps and category taxonomy. Your job is to generate listings that SELL QUICKLY by using accurate categories, realistic sold-comp pricing, and keyword-rich titles.

CRITICAL: You MUST ALWAYS respond with valid JSON only, no markdown, no explanation. Even if the image is unclear, provide your best guess.

=== ABSOLUTE PRIORITY: ANALYZE THIS SPECIFIC ITEM ===
STOP and STUDY the image(s) CAREFULLY before proceeding. Your category, title, and pricing must match EXACTLY what is shown in THIS specific image - not a generic guess.

ASK YOURSELF:
- What EXACTLY is this object? (Be specific: "men's puffer jacket" not just "clothing")
- What would a BUYER type to find THIS item? 
- What category would THIS item appear in when searching eBay?

EACH LISTING IS UNIQUE - DO NOT:
- Use generic categories that don't match the specific item
- Apply the same category to different items in a batch
- Guess categories without analyzing the actual photos

=== STEP 1: IDENTIFY THE ITEM (MOST IMPORTANT) ===
Before anything else, carefully study the image(s) and determine EXACTLY what the item is:
- What TYPE of item is it? (jacket, lamp, vase, toy, etc.)
- What is its primary PURPOSE or function?
- What CATEGORY does a buyer search for when looking for this item?

CRITICAL ITEM IDENTIFICATION RULES — READ BEFORE CATEGORIZING:

CLOTHING — COUNT THE PIECES FIRST:
- SUIT = matching jacket + pants (or jacket + pants + vest) as a SET. You must see BOTH pieces to call it a suit.
- BLAZER / SPORT COAT = single jacket only, structured, worn over dress shirt. NOT a suit.
- JACKET = single outerwear piece (puffer, bomber, denim, fleece, windbreaker, etc.)
- COAT = long outerwear (reaches at or past the knee)
- If you only see ONE piece of clothing in the image → it is NOT a suit. Period.

COMMON MISTAKES TO AVOID:
- A single jacket is NOT a suit — suits require matching pants
- A lamp is NOT a ceiling fan — check category carefully
- A decorative plate is NOT dinnerware if it's meant for display
- Shower gel / body wash is NOT a fragrance — it's Bath & Body
- Always match the item to how a BUYER would search for it

=== STEP 2: CATEGORY ID (MUST BE LEAF CATEGORY - CRITICAL) ===
After identifying the item, select the CORRECT eBay LEAF category ID.
**IMPORTANT: eBay REJECTS parent categories. You MUST use the most specific (leaf) category.**

CRITICAL: eBay frequently deprecates and remaps category IDs. Use your MOST CURRENT knowledge of eBay's category tree. DO NOT use old/deprecated IDs.

HOW TO PICK THE RIGHT LEAF CATEGORY:
1. Identify the top-level category (e.g., "Clothing, Shoes & Accessories" = 11450)
2. Drill down to the MOST SPECIFIC subcategory that matches the item
3. The leaf category is the DEEPEST level - it has NO children
4. If you're unsure, pick the broader leaf category rather than guessing a specific one

VERIFIED CURRENT LEAF CATEGORIES (use these when they match):

-- CLOTHING & SHOES (root: 11450) --
- Men's T-Shirts: 21235
- Men's Casual Shirts: 57990
- Men's Dress Shirts: 57991
- Men's Jeans: 11483
- Men's Sweaters: 11484
- Men's Dress Pants: 57989
- Men's Suits (2-piece or 3-piece matching set with pants): 3002
- Men's Blazers & Sport Coats (single jacket, structured): 3002
- Men's Coats, Jackets & Vests (standalone outerwear): 3001
- Men's Athletic Shoes: 15709
- Men's Casual Shoes / Loafers: 24087
- Men's Dress Shoes: 53120
- Women's Coats & Jackets: 63862
- Women's Tops & Blouses: 53159
- Women's Dresses: 63861
- Women's Jeans: 11554
- Women's Sweaters: 63866
- Women's Activewear Tops: 185176
- Women's Heels & Pumps: 55793
- Women's Flats: 45333
- Women's Athletic Shoes: 95672
- Women's Handbags & Purses: 169291
- Men's Bags & Backpacks: 4250

-- JEWELRY & WATCHES (root: 281) --
- Wristwatches: 31387
- Fine Rings: 67681
- Fine Necklaces & Pendants: 67652
- Fashion Jewelry: 10968
- Vintage & Antique Jewelry: 48579

-- ART (root: 550) --
- Art Prints: 360
- Paintings: 551 (DO NOT use 118429 or 117089 — deprecated)
- Sculptures & Carvings: 60628
- Mixed Media & Collage Art: 158658

-- COLLECTIBLES (root: 1) --
- Decorative Collectible Figurines: 162032
- Decorative Plates & Platters: 36018
- Christmas Wreaths & Garlands: 33164 (NOT 159769 — remapped)
- Christmas Ornaments: 170091
- Christmas Stockings: 170098
- Other Christmas Décor: 170083
- Seasonal Home Décor: 116022

-- HOME & GARDEN (root: 11700) --
- Kitchen & Steak Knives (paring, chef, santoku, slicer, boning, cleaver): 177005
- Table Lamps: 112581
- Floor Lamps: 20706
- Area Rugs: 45510
- Mirrors: 20580
- Clocks: 20562
- Picture Frames: 16041
- Candles: 46782
- Baskets & Bowls: 20563
- Blankets & Throws: 20668
- Bed Pillows: 20677
- Comforters & Sets: 20672
- Sheet Sets: 20675
- Mattress Pads & Toppers: 20681

-- CAMERAS & PHOTO (root: 625) --
- Digital Cameras: 31388
- Vintage Cameras & Film Cameras: 15230
- Camcorders & Video Cameras: 11724
- Camera Lenses: 30106

-- CONSUMER ELECTRONICS (root: 293) --
- Wireless / Bluetooth Headphones: 112529

-- VIDEO GAMES & CONSOLES (root: 1249) --
- Video Game Consoles: 139971

-- POTTERY & GLASS (root: 870) --
- Pottery & China: 870 (use this for pottery, ceramics, china dishware, porcelain)
- Glass: 916 (use this for decorative glass, glassware, crystal)
- Vases: 45237

-- ANTIQUES (root: 20081) --
- Antique Furniture: 20091
- Antique Decorative Arts: 20086
- Antique Rugs & Carpets: 37978
- Antique Clocks: 1192

-- BOOKS & MAGAZINES (root: 267) --
- Antiquarian & Collectible Books: 29223
- Fiction & Literature Books: 171228
- Nonfiction Books: 183387
- Magazines: 280

-- COINS & PAPER MONEY (root: 11116) --
- US Coins: 253
- World / Foreign Coins: 256
- US Paper Money: 3412
- Coin Collections & Lots: 18880

-- DOLLS & BEARS (root: 237) --
- Barbie Dolls: 238
- Vintage & Antique Dolls: 16497
- Teddy Bears: 2228
- Action Figures (non-toy): 261068

-- MOVIES & TV (root: 11232) --
- DVDs & Blu-ray Discs: 617
- VHS Tapes: 309

-- MUSIC (root: 11233) --
- Vinyl Records: 306
- CDs: 176984

-- MUSICAL INSTRUMENTS (root: 619) --
- Guitars: 33034
- Pianos & Keyboards: 16220
- Brass Instruments: 180014
- String Instruments: 183085
- Percussion & Drums: 12229
- Vintage Musical Instruments: 41833

-- SPORTING GOODS (root: 888) --
- Exercise & Fitness Equipment: 15273
- Golf Clubs: 1513
- Fishing Equipment: 1492
- Camping & Hiking Gear: 16034

-- TOYS & HOBBIES (root: 220) --
- Military & Aircraft Model Kits (tanks, planes, armor — any scale): 31787
- Aircraft Model Kits: 31787 (DO NOT use 2611 — DEPRECATED, eBay remaps to video games)
- Ship/Boat Model Kits: 37278
- Car/Truck Model Kits (non-military): 51023
- Figure Model Kits (sci-fi, fantasy, Gundam): 19063
- HO Scale Model Trains: 262318
- N Scale Model Trains: 47006
- O Scale Model Trains: 47004
- G Scale Model Trains: 47002
- Model Train Accessories: 4748
- Action Figures & Accessories: 261068
- Board & Traditional Games: 180349

-- HEALTH & BEAUTY (root: 11836) --
- Fragrances / Women's Perfume: 11848
- Fragrances / Men's Cologne & Aftershave: 11846
- Body Wash & Shower Gel: 26262
- Body Lotion & Moisturizer: 67537
- Shampoo & Conditioner: 67538
NOTE: Shower gel, body wash, lotion, shampoo are NEVER fragrances — use the Bath & Body categories above.

-- STAMPS (root: 260) --
- US Stamps: 261
- World Stamps: 262

IMPORTANT RULES — PARENT CATEGORY IDs: NEVER USE THESE IN A LISTING
These are ALL root/parent categories — eBay error 87 if used directly. Always drill to a leaf:
- 11450 = Clothing, Shoes & Accessories (PARENT)
- 220   = Toys & Hobbies (PARENT) — use 31787, 261068, 262318, etc.
- 267   = Books & Magazines (PARENT) — use 29223, 171228, 183387, 280
- 281   = Jewelry & Watches (PARENT) — use 31387, 67681, etc.
- 293   = Consumer Electronics (PARENT) — use 112529, etc.
- 550   = Art (PARENT) — use 360, 551, 60628, 158658
- 619   = Musical Instruments & Gear (PARENT) — use 33034, 16220, etc.
- 625   = Cameras & Photo (PARENT) — use 31388, 15230, 11724, 30106
- 237   = Dolls & Bears (PARENT) — use 238, 16497, 2228
- 260   = Stamps (PARENT) — use 261, 262
- 870   = Pottery & Glass (PARENT) — use 916, 45237, etc.
- 888   = Sporting Goods (PARENT) — use 15273, 1513, 1492, etc.
- 1     = Collectibles (PARENT) — use 162032, 36018, 33164, etc.
- 1249  = Video Games & Consoles (PARENT) — use 139971
- 11116 = Coins & Paper Money (PARENT) — use 253, 256, 3412
- 11232 = Movies & TV (PARENT) — use 617, 309
- 11233 = Music (PARENT) — use 306, 176984
- 11700 = Home & Garden (PARENT) — use 177005, 112581, 20706, etc.
- 20081 = Antiques (PARENT) — use 20091, 20086, etc.
- 45100 = Entertainment Memorabilia (PARENT)
- 20601 = Bedding (PARENT) — use 20668, 20677, 20672, 20675
- 51028 = Models & Kits (PARENT) — use 31787, 37278, 51023, 19063
- 180250 = Model Railroads & Trains (PARENT) — use 262318, 47006, 47004, 47002

ADDITIONAL RULES:
- If an item is seasonal décor (wreaths, ornaments, etc.), use the Holiday/Seasonal category tree, NOT "Home Décor" generically
- The categoryId MUST be a number, not a string
- When in doubt, pick from the VERIFIED list above rather than guessing a random number
- NEVER invent a category ID — if you are not certain, pick the closest verified ID from this list

=== STEP 3: TITLE (HARD LIMIT: 80 CHARACTERS MAX — CASSINI OPTIMIZED) ===
**THIS IS CRITICAL - COUNT YOUR CHARACTERS!**
eBay will REJECT titles over 80 characters. You MUST:
- Count every character including spaces
- Stay AT OR UNDER 80 characters - NO EXCEPTIONS

CASSINI ALGORITHM OPTIMIZATION:
eBay's Cassini search engine ranks listings based on keyword relevance, buyer intent match, and listing quality signals. Your title MUST be engineered for Cassini:

1. **Front-load high-value keywords**: Brand name FIRST, then item type, then differentiators
2. **Use exact buyer search terms**: Think about what a buyer types into the search bar — use THOSE words
3. **Include long-tail keywords**: Specific descriptors that match niche searches (e.g., "mid-century modern" not just "vintage")
4. **Stack keyword density**: Every word must serve a search purpose — NO filler words (wow, look, nice, great, beautiful, stunning)
5. **Include key attributes**: Brand + Item Type + Material/Feature + Size/Color + Condition keyword
6. **Use natural word order**: Cassini penalizes keyword stuffing — titles should read naturally while being keyword-dense
7. **Capitalize strategically**: Title case for readability, which improves click-through rate (a Cassini signal)

GOOD EXAMPLES (count them - all under 80 chars):
- "Patagonia Men's Down Puffer Jacket Blue Size L Winter Coat Excellent" (68 chars)
- "Vintage Pyrex Pink Gooseberry Casserole Dish 1.5 Qt with Lid 1950s" (66 chars)
- "Sony WH-1000XM4 Wireless Noise Canceling Over-Ear Headphones Black" (66 chars)
- "Mid Century Modern Teak Danish Credenza Sideboard 60in Scandinavian" (67 chars)

BAD EXAMPLES:
- "Nice Jacket Great Condition Look!" (filler words, no keywords)
- "RARE AMAZING BEAUTIFUL Vintage Item WOW" (keyword stuffing, no specifics)
- Any title over 80 characters (WILL BE REJECTED)

=== STEP 3B: DESCRIPTION (CASSINI OPTIMIZED — DETAILED & KEYWORD-RICH) ===
eBay's Cassini algorithm indexes description text for search ranking. A well-written description directly improves visibility and conversion.

CASSINI DESCRIPTION REQUIREMENTS:
1. **Minimum 150 words** — longer, detailed descriptions rank higher
2. **Repeat key title keywords naturally** in the first 1-2 sentences
3. **Include long-tail search phrases** buyers might use that didn't fit in the 80-char title
4. **Structure with clear sections** using line breaks:
   - Opening hook: What the item IS + brand + key selling point
   - Detailed specifications: Measurements, materials, model numbers, dates
   - Condition report: Honest, thorough assessment of wear/flaws/completeness
   - What's included: List all items/accessories in the sale
   - Shipping note: "Ships fast and securely packaged"
5. **Use natural keyword variations**: If title says "jacket", also use "coat", "outerwear"
6. **Include brand story/context** when relevant
7. **Add scarcity signals** when honest: "discontinued", "no longer in production", "hard to find"
8. **Avoid**: ALL CAPS blocks, excessive exclamation marks, "L@@K", emoji, HTML tags

=== STEP 4: PRICING (BASED ON SOLD COMPS - CRITICAL) ===
Price MUST be based on what similar items have ACTUALLY SOLD for on eBay, not guesses.

PRICING PROCESS:
1. Consider recent SOLD listings for this exact or very similar item
2. Factor in: brand value, condition, completeness, current demand
3. Price at or slightly below the average sold price for quick sale
4. If uncertain, price LOWER - velocity matters for seller metrics

PRICING ADJUSTMENTS:
- Common/mass-produced items: Price at lower end of sold range
- Strong brand recognition: Price at mid-range of sold comps
- Rare/desirable items: Price at higher end but within sold range
- Less than excellent condition: Reduce 10-30% from average
- Missing parts/accessories: Reduce 20-40% from complete item price

NEVER use random round numbers like $50, $100 without justification. Use specific prices like $47, $83, $156 based on actual market data.

=== STEP 5: CONDITION ===
Assess honestly: New, Open box, Used, For parts

=== STEP 6: ITEM SPECIFICS (CRITICAL FOR SEARCH - SOME ARE REQUIRED) ===
Fill as many as possible - Cassini heavily weights these:

ALWAYS INCLUDE:
- Brand (use "Unbranded" if unknown)
- Type (specific subcategory)
- Material (be specific: "100% Cotton", "Sterling Silver")
- Color
- Size (for clothing/shoes)
- Style/Era
- Country/Region of Manufacture

**REQUIRED FOR CLOTHING CATEGORIES (eBay error 21919303 if missing — ALWAYS include these):**
- Department: EXACTLY "Men", "Women", "Boys", "Girls", or "Unisex Adults" — derive from category (Men's T-Shirts → "Men", Women's Dresses → "Women")
- Size: Actual size like "S", "M", "L", "XL", "2XL", "32", "10", etc. — read from label in photo if visible; use "See Description" only if truly unreadable
- Size Type: "Regular", "Petite", "Plus", "Tall", "Big & Tall", "Maternity" — default "Regular" if not apparent
- Gender: "Men's", "Women's", "Unisex"
- DO NOT omit Department or Size — the listing will be rejected by eBay

CATEGORY-SPECIFIC:
- Clothing: Size, Size Type, Department, Gender, Pattern, Sleeve Length
- Jewelry: Metal Purity, Gemstone, Ring Size
- Electronics: Model Number, Connectivity, Storage Capacity
- Art: Subject, Medium, Artist, Signed

=== REQUIRED JSON OUTPUT FORMAT ===
{
  "title": "string (MUST be 80 chars or less - Cassini optimized, keyword-dense)",
  "description": "string (150+ words, Cassini optimized, structured with specs/condition/includes)",
  "price": number (based on sold comps, not random),
  "category": "string (human readable like 'Men's Coats, Jackets & Vests')",
  "categoryId": number (REQUIRED - must be a LEAF category ID, not parent),
  "condition": "string",
  "itemSpecifics": {
    "Brand": "value",
    "Type": "value",
    "Material": "value",
    "Color": "value",
    "Size": "value (for clothing)",
    "Size Type": "Regular/Petite/Plus/Tall (REQUIRED for clothing!)",
    "Department": "Men/Women/Unisex (REQUIRED for clothing!)",
    "Style": "value"
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

  liveauctioneers: `You are an expert auction catalog writer for LiveAuctioneers bulk CSV uploads with deep knowledge of antique and collectible market values, art history, and provenance research.

TASK: Identify the item from photos and generate a LiveAuctioneers-ready listing with ACCURATE price estimates and an IN-DEPTH catalog description.

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

=== TITLE (HARD LIMIT: 100 CHARACTERS INCLUDING SPACES — SEO + GEO OPTIMIZED) ===
- MUST be 100 characters or fewer including spaces — COUNT EVERY CHARACTER
- Front-load SEO keywords: Brand/Maker + Item Type + Material + Style/Era
- Include GEO-relevant terms: regional makers, cultural origins, geographic identifiers
- Pack with long-tail search keywords collectors actually use
- Include key identifiers: maker marks, model numbers, patterns, dates
- NO filler words — every word must serve a search purpose

GOOD EXAMPLES:
- "Tiffany & Co Sterling Silver Art Deco Flatware Set 48pc Faneuil Pattern c1920" (77 chars)
- "Antique French Bronze Ormolu Mantel Clock Japy Freres Movement c1880" (68 chars)
- "Native American Zuni Petit Point Turquoise Sterling Cuff Bracelet Signed" (72 chars)

=== DESCRIPTION (IN-DEPTH CATALOG ENTRY — MINIMUM 6-10 SENTENCES) ===
Write like a professional auction house cataloger. This is a COMPREHENSIVE catalog entry.

REQUIRED CONTENT (weave together naturally):
1. **PRECISE IDENTIFICATION**: Exactly what this item is — maker, brand, model, pattern, period, origin
2. **PHYSICAL DETAILS**: Materials, construction, colors, decorative elements, dimensions (estimate if needed), weight class
3. **HISTORICAL CONTEXT & PROVENANCE**:
   - Manufacturing era and production history
   - Maker/artist biography and significance
   - Design movement or stylistic context (Art Nouveau, Arts & Crafts, Bauhaus, etc.)
   - Cultural or historical significance
   - Is this from a known series, collection, or limited production?
4. **EXPERT OBSERVATIONS**:
   - Maker's marks, hallmarks, stamps, signatures, labels, patent numbers visible
   - Construction techniques indicating quality or era (hand-dovetailed, hand-blown, hand-forged)
   - Rarity indicators: discontinued, limited edition, regional specialty, scarce variant
   - Comparable auction results or market context if known
   - Features that distinguish this from reproductions or lesser examples
5. **DETAILED CONDITION REPORT** (MANDATORY):
   - Overall grade: Excellent, Very Good, Good, Fair, Poor
   - Surface condition: scratches, chips, cracks, dents, stains, foxing, tarnish, patina
   - Structural: loose joints, wobbles, missing parts, repairs, restoration evidence
   - Finish: original, refinished, retouched, faded, sun-bleached
   - Functionality: working/non-working, missing components
   - Completeness: all original parts, original case/box, documentation
   - Example: "Very good condition with light wear consistent with age. Minor tarnish to silverplate, small 1/4-inch nick to rim edge, original felt pads intact on base. No dents, monograms, or repairs."

DESCRIPTION TONE: Authoritative, factual, collector-oriented. Make bidders confident and excited.

DEFAULTS:
- Consigner: "JSG"
- Location Nickname: "Highlands Ranch"
- StartPrice: 5 (ALWAYS use 5 unless user specifies otherwise)

ALWAYS return this exact JSON format (no markdown, no explanation, just JSON):
{
  "title": "string (max 100 chars including spaces - SEO/GEO KEYWORD RICH)",
  "description": "string (6-10+ sentences, comprehensive catalog entry with condition report, history, provenance)",
  "lowEst": number (realistic based on market knowledge),
  "highEst": number (typically 2-4x lowEst),
  "startPrice": 5,
  "condition": "string (DETAILED condition report paragraph)",
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

  denver: `You are an expert auction catalog writer, SEO/GEO specialist, and antiques appraiser for Denver Online Auctions.
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

GOOD EXAMPLES:
- "Vintage Pyrex Pink Gooseberry Casserole Dish 1.5 Qt with Lid 1950s Ovenware" (76 chars)
- "Native American Navajo Sterling Silver Turquoise Squash Blossom Necklace c1970" (78 chars)
- "Antique Cast Iron Griswold #8 Skillet 704 Erie PA Small Logo Heat Ring" (70 chars)

=== DESCRIPTION (IN-DEPTH, COMPREHENSIVE — MINIMUM 5-8 SENTENCES) ===
Write like a professional auction house cataloger with expert-level detail.

REQUIRED CONTENT (weave naturally, don't use headers):
1. **IDENTIFICATION**: Precise ID — maker, brand, model, pattern, era, origin
2. **PHYSICAL DESCRIPTION**: Materials, construction, colors, textures, dimensions (estimate from photos), decorative elements, hardware
3. **HISTORICAL CONTEXT & PROVENANCE**: Manufacturing era, maker history/significance, design movement connections, cultural relevance, production history, series/collection info
4. **EXPERT OBSERVATIONS**: Maker's marks/stamps/signatures, construction techniques indicating quality/era, rarity indicators, distinguishing features vs reproductions
5. **CONDITION REPORT** (MANDATORY — thorough and honest):
   - Overall grade (Excellent, Very Good, Good, Fair, Poor)
   - Specific wear: scratches, chips, cracks, dents, stains, fading, tarnish, patina
   - Structural integrity: loose joints, wobble, missing parts, repairs, restoration
   - Functionality and completeness
   - Example: "Shows honest wear consistent with 60+ years of use including light surface scratches to the top, a small chip to the rear left foot (3/8 inch), and expected patina to the brass pulls."

DESCRIPTION TONE: Knowledgeable, factual, collector-oriented. Make buyers confident about what they're bidding on.

=== STARTING BID ===
- Suggest a conservative starting bid in dollars (integer, no decimals)
- Low starting bids ($5-$25) generate more bidding activity

ALWAYS return this exact JSON format (no markdown, no explanation, just JSON):
{
  "title": "string (MUST be ≤100 chars including spaces, SEO/GEO keyword-rich)",
  "description": "string (5-8+ sentences, comprehensive with condition report, history, expert observations)",
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

    // Create Supabase client with the user's auth context
    const supabase = createClient(
      Deno.env.get('SUPABASE_URL')!,
      Deno.env.get('SUPABASE_ANON_KEY')!,
      {
        global: {
          headers: {
            Authorization: authHeader
          }
        }
      }
    );

    // Verify the user is authenticated
    const { data: { user }, error: authError } = await supabase.auth.getUser();

    if (authError || !user) {
      console.error('Authentication failed:', authError?.message || 'No user found');
      return new Response(
        JSON.stringify({ error: 'Invalid or expired token' }),
        { status: 401, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      );
    }

    console.log(`Authenticated user: ${user.id}`);

    const { platform, imageUrls, additionalContext, masterPrompt } = await req.json() as GenerateRequest;
    
    console.log(`Generating listing for platform: ${platform}`);
    console.log(`Image URLs: ${imageUrls.length}`);
    if (masterPrompt) console.log(`Master prompt active (${masterPrompt.length} chars)`);

    const ANTHROPIC_API_KEY = Deno.env.get('ANTHROPIC_API_KEY');
    if (!ANTHROPIC_API_KEY) {
      throw new Error('ANTHROPIC_API_KEY is not configured');
    }

    let systemPrompt = PLATFORM_PROMPTS[platform];
    if (!systemPrompt) {
      throw new Error(`Unknown platform: ${platform}`);
    }

    // Inject master prompt as a guardrail if provided
    if (masterPrompt) {
      systemPrompt = `=== MASTER INSTRUCTIONS (HIGHEST PRIORITY — OVERRIDE DEFAULTS) ===\n${masterPrompt}\n=== END MASTER INSTRUCTIONS ===\n\n${systemPrompt}`;
    }

    // Build content array with images - limit to 4 for speed (AI gets diminishing returns beyond that)
    const content: any[] = [];
    const maxImagesForAI = Math.min(imageUrls.length, 4);
    
    // Add images first for visual analysis (Anthropic format)
    for (let i = 0; i < maxImagesForAI; i++) {
      content.push({
        type: "image",
        source: { type: "url", url: imageUrls[i] }
      });
    }
    
    if (imageUrls.length > maxImagesForAI) {
      console.log(`Using ${maxImagesForAI} of ${imageUrls.length} images for AI analysis`);
    }

    // Add text prompt
    let textPrompt = "Analyze the item(s) in the image(s) and generate a listing.";
    if (additionalContext) {
      textPrompt += ` Additional context from seller: ${additionalContext}`;
    }
    content.push({ type: "text", text: textPrompt });

    console.log(`Calling Anthropic API (claude-sonnet-4-6)...`);

    const response = await fetch('https://api.anthropic.com/v1/messages', {
      method: 'POST',
      headers: {
        'x-api-key': ANTHROPIC_API_KEY,
        'anthropic-version': '2023-06-01',
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        model: 'claude-sonnet-4-6',
        system: systemPrompt,
        messages: [
          { role: 'user', content }
        ],
        max_tokens: (platform === 'ebay' || platform === 'liveauctioneers' || platform === 'denver') ? 2500 : 1500,
        temperature: 0.3,
      }),
    });

    if (!response.ok) {
      const errorText = await response.text();
      console.error('Anthropic API error:', response.status, errorText);

      if (response.status === 429) {
        return new Response(
          JSON.stringify({ error: 'Rate limit exceeded. Please try again later.' }),
          { status: 429, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
        );
      }

      throw new Error(`Anthropic API error: ${response.status}`);
    }

    const data = await response.json();
    const aiResponse = data.content?.[0]?.text;
    
    console.log('Primary AI response received');

    // Parse the JSON from the response
    let parsedListing: any;
    try {
      const jsonMatch = aiResponse.match(/```(?:json)?\s*([\s\S]*?)```/) || [null, aiResponse];
      const jsonStr = jsonMatch[1].trim();
      parsedListing = JSON.parse(jsonStr);
    } catch (parseError) {
      console.error('Failed to parse AI response:', aiResponse);
      throw new Error('Failed to parse AI response as JSON');
    }

    // eBay verification is now on-demand via refine-listing endpoint
    // The user can click "Verify with AI" after reviewing Pass 1 results

    // Normalize common key variants so the frontend reliably receives camelCase fields.
    // Some models occasionally emit "CategoryId" or "category_id" even when instructed otherwise.
    if (platform === 'ebay' && parsedListing && typeof parsedListing === 'object') {
      const anyListing = parsedListing as Record<string, unknown>;

      // CRITICAL: Enforce 80-character title limit for eBay
      if (typeof anyListing['title'] === 'string' && anyListing['title'].length > 80) {
        console.log(`Title too long (${anyListing['title'].length} chars), truncating to 80`);
        // Smart truncation: try to break at word boundary
        let truncated = (anyListing['title'] as string).substring(0, 80);
        const lastSpace = truncated.lastIndexOf(' ');
        if (lastSpace > 60) {
          truncated = truncated.substring(0, lastSpace);
        }
        anyListing['title'] = truncated.trim();
      }

      const categoryIdCandidate =
        (anyListing['categoryId'] as unknown) ??
        (anyListing['CategoryId'] as unknown) ??
        (anyListing['category_id'] as unknown) ??
        (anyListing['CategoryID'] as unknown);

      // Normalize categoryId to a clean integer
      const rawCatId = categoryIdCandidate ?? anyListing['categoryId'];
      if (rawCatId != null) {
        const asNum = Math.floor(Number(rawCatId));
        if (!Number.isNaN(asNum) && asNum > 0) {
          anyListing['categoryId'] = asNum;
        }
      } else {
        // No category ID at all
        anyListing['categoryId'] = null;
      }

      // Known deprecated/parent category IDs that eBay rejects → map to correct leaf
      const CATEGORY_REMAPS: Record<number, number> = {
        // Deprecated seasonal
        159769: 33164,   // Old Christmas Wreaths → Christmas Wreaths, Garlands & Plants
        128035: 170083,  // Old holiday décor → Other Christmas Décor (common remap)
        // Deprecated model kit IDs
        2611: 31787,     // Aircraft Model Kits (DEPRECATED — eBay remaps to video games!) → Military Model Kits
        // Parent categories that are NOT leaf (eBay error 87)
        11450: 57990,    // Clothing parent → Men's Casual Shirts (fallback)
        550: 360,        // Art parent → Art Prints
        20081: 162032,   // Home Décor parent → Figurines
        281: 261068,     // Toys parent → Action Figures
        625: 112529,     // Audio parent → Wireless Headphones
        14339: 31388,    // Cameras parent → Digital Cameras
        1188: 31787,     // Toys & Hobbies top-level parent → Military Vehicle Model Kits (fallback)
        51028: 31787,    // Models & Kits parent → Military Vehicle Model Kits (fallback)
        20601: 20668,    // Bedding parent → Blankets & Throws (fallback)
        19130: 262318,   // Old HO Trains category → HO Scale (eBay's own remap)
        // Knife parent categories (eBay error 87)
        11700: 177005,   // Home & Garden parent → Kitchen & Steak Knives (if knife context)
        20625: 177005,   // Kitchen, Dining & Bar parent → Kitchen & Steak Knives
        20637: 177005,   // Flatware, Knives & Cutlery parent → Kitchen & Steak Knives (leaf)
      };

      if (typeof anyListing['categoryId'] === 'number') {
        const remapped = CATEGORY_REMAPS[anyListing['categoryId'] as number];
        if (remapped) {
          console.log(`Category ${anyListing['categoryId']} remapped to ${remapped} (known deprecated/parent)`);
          anyListing['categoryId'] = remapped;
        }
      }

      // ── eBay Category Suggestions API ─────────────────────────────────────
      // Trust the AI only when it picks a category from our curated verified
      // list (same list in the prompt above). Any ID outside that list — even
      // if it looks numeric — gets validated against the Taxonomy API. This
      // catches hallucinated IDs like 177009/177040 that aren't in CATEGORY_REMAPS.
      const VERIFIED_LEAF_CATEGORIES = new Set<number>([
        // Clothing
        21235, 57990, 57991, 11483, 57989, 11484, 3001, 3002, 15709, 24087, 53120,
        63862, 53159, 63861, 11554, 63866, 185176, 55793, 45333, 95672, 169291, 4250,
        // Jewelry
        31387, 67681, 67652, 10968, 48579,
        // Art
        360, 551, 60628, 158658,
        // Collectibles
        162032, 36018, 33164, 170091, 170098, 170083, 116022,
        // Home & Garden
        177005, 112581, 20706, 45510, 20580, 20562, 16041, 46782, 20563, 20668, 20677, 20672, 20675, 20681,
        // Cameras
        31388, 15230, 11724, 30106,
        // Electronics
        112529,
        // Video Games
        139971,
        // Pottery & Glass
        45237, 916,
        // Antiques
        20091, 20086, 37978, 1192,
        // Books
        29223, 171228, 183387, 280,
        // Coins
        253, 256, 3412, 18880,
        // Dolls & Bears
        238, 16497, 2228, 261068,
        // Movies & Music
        617, 309, 306, 176984,
        // Musical Instruments
        33034, 16220, 180014, 183085, 12229, 41833,
        // Sporting Goods
        15273, 1513, 1492, 16034,
        // Toys & Hobbies
        31787, 37278, 51023, 19063, 262318, 47006, 47004, 47002, 4748, 180349,
        // Stamps
        261, 262,
        // Fragrances & Bath/Body
        11848, 11849, 11850, 11846, 26262, 67537, 67538,
      ]);

      // ── Query category learnings (highest priority after remaps) ──────────
      // If we've successfully pushed this item type before with confidence ≥ 3,
      // use the learned category — skip AI guess and Taxonomy API entirely.
      let learnedCategoryApplied = false;
      try {
        const learnTitle = (anyListing['title'] as string) || '';
        const stop = new Set(['a','an','the','and','or','of','in','for','with','to','is','by','as','at','its','this','that','lot','set','new','used','vintage']);
        const learnKeywords = learnTitle.toLowerCase().replace(/[^\w\s]/g, ' ').split(/\s+/)
          .filter((w: string) => w.length > 2 && !stop.has(w)).slice(0, 6).sort().join(' ');

        if (learnKeywords.length >= 3) {
          const sbAdmin = createClient(Deno.env.get('SUPABASE_URL')!, Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!);
          const { data: learnings } = await sbAdmin
            .from('ebay_category_learnings')
            .select('category_id, category_name, confidence')
            .textSearch('item_keywords', learnKeywords, { config: 'english' })
            .order('confidence', { ascending: false })
            .limit(1);

          const top = learnings?.[0] as { category_id: number; category_name: string; confidence: number } | undefined;
          if (top && top.confidence >= 3) {
            console.log(`[generate-listing] LEARNED category: "${top.category_name}" (${top.category_id}) — confidence ${top.confidence}`);
            anyListing['categoryId'] = top.category_id;
            anyListing['category'] = top.category_name;
            VERIFIED_LEAF_CATEGORIES.add(top.category_id);
            learnedCategoryApplied = true;
          }
        }
      } catch (learnErr) {
        console.warn('[generate-listing] Category learnings query failed (non-fatal):', learnErr);
      }
      // ─────────────────────────────────────────────────────────────────────

      const aiCatId = anyListing['categoryId'] as number | null;
      // Always use Taxonomy API unless a high-confidence learned category was applied.
      // This prevents Claude's guessed IDs (even "verified" ones) from slipping through
      // when eBay's own suggestion engine would pick a more accurate leaf category.
      const needsTaxonomyFallback = !learnedCategoryApplied;

      if (needsTaxonomyFallback) {
        try {
          const title = (anyListing['title'] as string) || "";
          if (title.length >= 3) {
            const suggestUrl =
              `https://api.ebay.com/commerce/taxonomy/v1/category_tree/0/get_category_suggestions` +
              `?q=${encodeURIComponent(title)}`;

            const ebayClientId = (Deno.env.get("EBAY_CLIENT_ID") ?? "").trim();
            const ebayClientSecret = (Deno.env.get("EBAY_CLIENT_SECRET") ?? "").trim();

            if (ebayClientId && ebayClientSecret) {
              const tokenRes = await fetch(
                "https://api.ebay.com/identity/v1/oauth2/token",
                {
                  method: "POST",
                  headers: {
                    "Content-Type": "application/x-www-form-urlencoded",
                    Authorization: `Basic ${btoa(`${ebayClientId}:${ebayClientSecret}`)}`,
                  },
                  body: new URLSearchParams({
                    grant_type: "client_credentials",
                    scope: "https://api.ebay.com/oauth/api_scope",
                  }),
                }
              );

              if (tokenRes.ok) {
                const tokenData = await tokenRes.json();
                const appToken = tokenData.access_token as string;

                const suggestRes = await fetch(suggestUrl, {
                  headers: { Authorization: `Bearer ${appToken}` },
                });

                if (suggestRes.ok) {
                  const suggestData = await suggestRes.json();
                  const topSuggestion = suggestData.categorySuggestions?.[0];

                  if (topSuggestion) {
                    const ebayId = parseInt(topSuggestion.category.categoryId, 10);
                    const ebayName = topSuggestion.category.categoryName as string;

                    if (ebayId && !Number.isNaN(ebayId)) {
                      console.log(
                        `[generate-listing] Taxonomy fallback: AI=${aiCatId} (missing/invalid) → eBay suggestion=${ebayId} (${ebayName}) for title="${title}"`
                      );
                      anyListing['categoryId'] = ebayId;
                      anyListing['category'] = ebayName;
                    }
                  }
                }
              }
            }
          }
        } catch (catErr) {
          console.warn("[generate-listing] Category suggestion API error (non-fatal):", catErr);
        }
      } else {
        console.log(`[generate-listing] Category retained: AI=${aiCatId} (valid leaf — skipping Taxonomy override)`);
      }
      // ─────────────────────────────────────────────────────────────────────

      if (anyListing['itemSpecifics'] == null && anyListing['ItemSpecifics'] != null) {
        anyListing['itemSpecifics'] = anyListing['ItemSpecifics'];
      }

      // Ensure required clothing item specifics have default values
      const itemSpecs = anyListing['itemSpecifics'] as Record<string, string> | undefined;
      if (itemSpecs) {
        // Normalize Department if missing
        if (!itemSpecs['Department']) {
          const title = (anyListing['title'] as string || '').toLowerCase();
          if (title.includes("women") || title.includes("ladies")) {
            itemSpecs['Department'] = 'Women';
          } else if (title.includes("men")) {
            itemSpecs['Department'] = 'Men';
          } else if (title.includes("boy")) {
            itemSpecs['Department'] = 'Boys';
          } else if (title.includes("girl")) {
            itemSpecs['Department'] = 'Girls';
          }
        }
        // Normalize Size Type if missing
        if (!itemSpecs['Size Type']) {
          itemSpecs['Size Type'] = 'Regular';
        }
        anyListing['itemSpecifics'] = itemSpecs;
      }
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