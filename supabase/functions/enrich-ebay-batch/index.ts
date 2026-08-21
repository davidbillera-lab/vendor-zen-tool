import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers":
    "authorization, x-client-info, apikey, content-type, x-supabase-client-platform, x-supabase-client-platform-version, x-supabase-client-runtime, x-supabase-client-runtime-version",
};

interface EnrichRow {
  id: string;
  title: string;
  description: string | null;
  category: string | null;
  condition: string | null;
  item_specifics: Record<string, string> | null;
  image_urls: string[] | null;
}

interface EnrichRequest {
  rows: EnrichRow[];
}

const SYSTEM_PROMPT = `You are an expert eBay item specifics analyst. Given a batch of eBay listings (title, description, category, existing item specifics), your job is to FILL IN all missing item specifics that eBay requires or recommends for each listing.

For EACH listing you must return enriched item specifics. Do NOT remove existing specifics — only ADD missing ones.

ALWAYS INCLUDE THESE WHEN APPLICABLE:
- Brand (use "Unbranded" if truly unknown)
- Type (specific subcategory of item)
- Material (be specific: "100% Cotton", "Sterling Silver", "Ceramic", "Wood")
- Color (primary color)
- Style (e.g., "Mid-Century Modern", "Art Deco", "Bohemian", "Traditional")
- Era/Year (e.g., "2010s", "1960s", "Antique pre-1900")
- Country/Region of Manufacture (e.g., "United States", "Japan", "Italy")
- Pattern (e.g., "Solid", "Floral", "Striped", "Geometric")

FOR CLOTHING CATEGORIES (REQUIRED BY EBAY — WILL REJECT WITHOUT):
- Department: "Men", "Women", "Boys", "Girls", or "Unisex"
- Size Type: "Regular", "Petite", "Plus", "Tall", "Big & Tall"
- Size: Actual size (M, L, XL, 32, 10, etc.)
- Gender: "Men's", "Women's", "Unisex"
- Sleeve Length: "Long Sleeve", "Short Sleeve", "3/4 Sleeve"
- Closure: "Button", "Zip", "Pull On"

FOR JEWELRY:
- Metal: "Sterling Silver", "Gold", "Gold Plated"
- Metal Purity: "925", "14k", "18k"
- Gemstone: specific stone name
- Ring Size (if ring)

FOR ELECTRONICS:
- Model, Connectivity, Storage Capacity, Compatible Brand

FOR ART:
- Subject, Medium, Artist (if identifiable), Signed/Unsigned
- Size: ONLY if dimensions are explicitly stated in the title/description — never estimate

FOR HOME DECOR:
- Room, Theme, Shape, Features

MEASUREMENT RULE (HARD): Never guess measurement-type specifics (Item Length/Width/Height/Depth, Weight, dimensions, capacity). Only fill them from values explicitly present in the listing's title, description, or existing specifics — those are operator-verified. If not present, leave them out. Clothing/shoe/ring sizes read from a garment tag or marking are labels and are fine.

ANALYZE the title and description to INFER specifics intelligently:
- "Vintage 1960s Danish Teak Credenza" → Era: "1960s", Material: "Teak", Style: "Danish Modern", Country: "Denmark"
- "Nike Men's Dri-FIT Running Shorts Large Black" → Brand: "Nike", Department: "Men", Size: "L", Color: "Black", Type: "Running Shorts"
- "Antique Sterling Silver Art Nouveau Brooch" → Material: "Sterling Silver", Metal Purity: "925", Style: "Art Nouveau", Era: "Antique (pre-1900)"

You MUST respond with valid JSON only. Return an array of objects, each with:
- "id": the listing ID
- "item_specifics": the COMPLETE merged item specifics (existing + new)
- "category_id": if you can determine a better/more specific leaf category ID, include it; otherwise null

Format:
[
  {
    "id": "uuid",
    "item_specifics": { "Brand": "...", "Material": "...", ... },
    "category_id": number_or_null
  }
]`;

serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response(null, { headers: corsHeaders });
  }

  try {
    const authHeader = req.headers.get("Authorization");
    if (!authHeader) {
      return new Response(
        JSON.stringify({ error: "Authorization required" }),
        { status: 401, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    const supabase = createClient(
      Deno.env.get("SUPABASE_URL")!,
      Deno.env.get("SUPABASE_ANON_KEY")!,
      { global: { headers: { Authorization: authHeader } } }
    );

    const { data: { user }, error: authError } = await supabase.auth.getUser();
    if (authError || !user) {
      return new Response(
        JSON.stringify({ error: "Invalid or expired token" }),
        { status: 401, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    const { rows } = (await req.json()) as EnrichRequest;

    if (!rows || rows.length === 0) {
      return new Response(
        JSON.stringify({ error: "No rows provided" }),
        { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    const ANTHROPIC_API_KEY = Deno.env.get("ANTHROPIC_API_KEY");
    if (!ANTHROPIC_API_KEY) {
      throw new Error("ANTHROPIC_API_KEY is not configured");
    }

    // Build the user prompt with all row data
    const rowSummaries = rows.map((r) => ({
      id: r.id,
      title: r.title,
      description: (r.description || "").substring(0, 300),
      category: r.category,
      condition: r.condition,
      existing_specifics: r.item_specifics || {},
    }));

    const userPrompt = `Analyze these ${rows.length} eBay listing(s) and fill in ALL missing item specifics for each one. Keep existing specifics and ADD what's missing.\n\n${JSON.stringify(rowSummaries, null, 2)}`;

    // Build content with images if available (first image per row, max 8 total)
    const content: any[] = [];
    let imageCount = 0;
    for (const row of rows) {
      if (imageCount >= 8) break;
      if (row.image_urls && row.image_urls.length > 0) {
        content.push({
          type: "image",
          source: { type: "url", url: row.image_urls[0] },
        });
        imageCount++;
      }
    }
    content.push({ type: "text", text: userPrompt });

    console.log(`[enrich-ebay-batch] Enriching ${rows.length} rows for user ${user.id}`);

    const response = await fetch("https://api.anthropic.com/v1/messages", {
      method: "POST",
      headers: {
        "x-api-key": ANTHROPIC_API_KEY,
        "anthropic-version": "2023-06-01",
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        model: "claude-haiku-4-5-20251001",
        max_tokens: 4000,
        temperature: 0.2,
        system: SYSTEM_PROMPT,
        messages: [{ role: "user", content }],
      }),
    });

    if (!response.ok) {
      const err = await response.text();
      console.error("Anthropic API error:", response.status, err);
      if (response.status === 429) {
        return new Response(
          JSON.stringify({ error: "Rate limit hit. Please wait a moment and try again." }),
          { status: 429, headers: { ...corsHeaders, "Content-Type": "application/json" } }
        );
      }
      throw new Error(`Anthropic API error: ${response.status}`);
    }

    const data = await response.json();
    const aiResponse = data.content?.[0]?.text ?? "";

    // Parse JSON
    let enrichedRows: any[];
    try {
      const jsonMatch = aiResponse.match(/```(?:json)?\s*([\s\S]*?)```/) || [null, aiResponse];
      enrichedRows = JSON.parse(jsonMatch[1].trim());
    } catch (parseError) {
      console.error("Failed to parse AI response:", aiResponse);
      throw new Error("Failed to parse AI enrichment response");
    }

    if (!Array.isArray(enrichedRows)) {
      throw new Error("AI response is not an array");
    }

    console.log(`[enrich-ebay-batch] AI returned enrichment for ${enrichedRows.length} rows`);

    return new Response(
      JSON.stringify({ enriched: enrichedRows }),
      { headers: { ...corsHeaders, "Content-Type": "application/json" } }
    );
  } catch (error) {
    console.error("enrich-ebay-batch error:", error);
    return new Response(
      JSON.stringify({ error: error instanceof Error ? error.message : "Unknown error" }),
      { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } }
    );
  }
});
