import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers":
    "authorization, x-client-info, apikey, content-type, x-supabase-client-platform, x-supabase-client-platform-version, x-supabase-client-runtime, x-supabase-client-runtime-version",
};

/* ───────────────────── eBay OAuth helpers ───────────────────── */

type EbayEnvironment = "production" | "sandbox";

const EBAY_ENV_CONFIG: Record<EbayEnvironment, { tradingApiUrl: string; oauthTokenUrl: string }> = {
  production: {
    tradingApiUrl: "https://api.ebay.com/ws/api.dll",
    oauthTokenUrl: "https://api.ebay.com/identity/v1/oauth2/token",
  },
  sandbox: {
    tradingApiUrl: "https://api.sandbox.ebay.com/ws/api.dll",
    oauthTokenUrl: "https://api.sandbox.ebay.com/identity/v1/oauth2/token",
  },
};

function sanitizeSecret(secretName: string): string {
  const raw = Deno.env.get(secretName) ?? "";
  const cleaned = raw.trim().replace(/^['"]|['"]$/g, "");
  if (!cleaned) throw new Error(`Missing or empty required secret: ${secretName}`);
  return cleaned;
}

function getEnvironment(): EbayEnvironment {
  const configured = (Deno.env.get("EBAY_ENV") || Deno.env.get("EBAY_ENVIRONMENT") || "")
    .trim()
    .toLowerCase();
  return configured === "sandbox" ? "sandbox" : "production";
}

// Look up per-user eBay credentials from DB. Returns null if not found (fall back to shared secrets).
async function getUserEbayCreds(authHeader: string | null): Promise<{ clientId: string; clientSecret: string; refreshToken: string } | null> {
  if (!authHeader?.startsWith("Bearer ")) return null;
  const supabaseUrl = Deno.env.get("SUPABASE_URL");
  const serviceRoleKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");
  if (!supabaseUrl || !serviceRoleKey) return null;

  try {
    const jwt = authHeader.slice(7);
    // Decode user_id from JWT payload (base64 middle segment)
    const payload = JSON.parse(atob(jwt.split(".")[1]));
    const userId = payload.sub as string;
    if (!userId) return null;

    const supabase = createClient(supabaseUrl, serviceRoleKey);
    const { data } = await supabase
      .from("user_ebay_credentials")
      .select("client_id, client_secret, refresh_token")
      .eq("user_id", userId)
      .single();

    if (!data?.client_id || !data?.client_secret || !data?.refresh_token) return null;
    return { clientId: data.client_id, clientSecret: data.client_secret, refreshToken: data.refresh_token };
  } catch {
    return null;
  }
}

async function getAccessToken(userCreds?: { clientId: string; clientSecret: string; refreshToken: string } | null): Promise<{ accessToken: string; environment: EbayEnvironment; tradingApiUrl: string }> {
  const environment = getEnvironment();
  const clientId = userCreds?.clientId ?? sanitizeSecret("EBAY_CLIENT_ID");
  const clientSecret = userCreds?.clientSecret ?? sanitizeSecret("EBAY_CLIENT_SECRET");
  const refreshToken = userCreds?.refreshToken ?? sanitizeSecret("EBAY_REFRESH_TOKEN");

  const b64Auth = btoa(`${clientId}:${clientSecret}`);

  const res = await fetch(EBAY_ENV_CONFIG[environment].oauthTokenUrl, {
    method: "POST",
    headers: {
      "Content-Type": "application/x-www-form-urlencoded",
      Authorization: `Basic ${b64Auth}`,
    },
    body: new URLSearchParams({
      grant_type: "refresh_token",
      refresh_token: refreshToken,
      scope: "https://api.ebay.com/oauth/api_scope",
    }),
  });

  if (!res.ok) {
    const text = await res.text();
    throw new Error(`OAuth token refresh failed (${res.status}): ${text}`);
  }

  const data = await res.json();
  return {
    accessToken: data.access_token,
    environment,
    tradingApiUrl: EBAY_ENV_CONFIG[environment].tradingApiUrl,
  };
}

/* ──────────── Condition ID mapping (Trading API) ──────────── */

function mapConditionId(condition: string | null): number {
  const map: Record<string, number> = {
    "New": 1000,
    "New with tags": 1000,
    "New other": 1500,
    "New without tags": 1500,
    "Open box": 1500,
    "Used": 3000,
    "Pre-owned": 3000,
    "Pre-owned - Excellent": 3000,
    "Pre-owned - Good": 3000,
    "Pre-owned - Fair": 3000,
    "Certified refurbished": 2000,
    "Seller refurbished": 2500,
    "For parts": 7000,
    "For parts or not working": 7000,
  };
  return map[condition || ""] ?? 3000;
}

/* ──────────────────────────────────────────────────────────────────────────
   KEYWORD → CATEGORY MAP
   First match wins. Applied to every listing to catch AI-hallucinated IDs.
   When a title matches, that category is used regardless of what the AI chose.
   Order: specific patterns first (e.g. "ship model kit") before broad ones
   (e.g. generic "model kit") so narrower categories win.
─────────────────────────────────────────────────────────────────────────── */

const KEYWORD_CATEGORY_MAP: Array<{ pattern: RegExp; categoryId: string; name: string }> = [
  // Kitchen knives & cutlery → Kitchen & Steak Knives (leaf under 20637)
  { pattern: /knife|knives|cleaver|slicer|santoku|boning|paring|cutlery/i,                               categoryId: "177005", name: "Kitchen & Steak Knives" },
  // Model trains — scale-specific (must come before generic "model kit")
  { pattern: /ho[ -]?scale|ho[ -]?gauge/i,                                                               categoryId: "262318", name: "HO Scale Model Trains" },
  { pattern: /\bn[ -]?scale\b.*train|\bn[ -]?gauge\b.*train/i,                                           categoryId: "47006",  name: "N Scale Model Trains" },
  { pattern: /\bo[ -]?scale\b.*train|\bo[ -]?gauge\b.*train|lionel.*train/i,                             categoryId: "47004",  name: "O Scale Model Trains" },
  { pattern: /\bg[ -]?scale\b.*train|\bg[ -]?gauge\b.*train/i,                                           categoryId: "47002",  name: "G Scale Model Trains" },
  // Model kits — specific subcategories before the broad fallback
  { pattern: /ship.*model.*kit|boat.*model.*kit|submarine.*kit|warship.*kit|destroyer.*kit/i,            categoryId: "37278",  name: "Ship/Boat Model Kits" },
  { pattern: /car.*model.*kit|truck.*model.*kit|dragster.*kit|stock.*car.*kit/i,                         categoryId: "51023",  name: "Car/Truck Model Kits" },
  { pattern: /figure.*kit|figurine.*kit|gundam/i,                                                        categoryId: "19063",  name: "Figure Model Kits" },
  // Broad model kit fallback (military/aircraft) — revell, tamiya, monogram, airfix brand matches
  { pattern: /model[ -]?kit|scale[ -]?model|plastic[ -]?kit|tank.*kit|aircraft.*kit|tamiya|revell|monogram|airfix/i, categoryId: "31787", name: "Military & Aircraft Model Kits" },
  // Blankets & throws
  { pattern: /\bblanket\b|fleece.*throw|throw.*blanket|sherpa.*blanket/i,                                categoryId: "20668",  name: "Blankets & Throws" },
  // Cameras
  { pattern: /film.*camera|35mm.*camera|vintage.*camera|slr.*film|rangefinder.*camera/i,                categoryId: "15230",  name: "Vintage Cameras" },
  { pattern: /camcorder|handycam/i,                                                                      categoryId: "11724",  name: "Camcorders & Video Cameras" },
];

/* ──────────── Category learning helpers ──────────── */

function extractKeywords(title: string): string {
  const stop = new Set(['a','an','the','and','or','of','in','for','with','to','is','by','as','at','its','this','that','lot','set','new','used','vintage']);
  return title
    .toLowerCase()
    .replace(/[^\w\s]/g, ' ')
    .split(/\s+/)
    .filter(w => w.length > 2 && !stop.has(w))
    .slice(0, 6)
    .sort()
    .join(' ');
}

async function saveCategoryLearning(title: string, categoryId: string, categoryName: string) {
  const supabaseUrl = Deno.env.get("SUPABASE_URL");
  const serviceRoleKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");
  if (!supabaseUrl || !serviceRoleKey) return;
  const keywords = extractKeywords(title);
  if (!keywords) return;
  try {
    const sb = createClient(supabaseUrl, serviceRoleKey);
    await sb.rpc('record_category_learning', {
      p_keywords: keywords,
      p_category_id: parseInt(categoryId),
      p_category_name: categoryName,
    });
    console.log(`[ebay-publish] Learned: "${keywords}" → ${categoryId} (${categoryName})`);
  } catch (e) {
    console.warn('[ebay-publish] Failed to save learning (non-fatal):', e);
  }
}

/* ──────────── Build Trading API XML ──────────── */

interface EbayRow {
  id: string;
  lot_number: number;
  title: string;
  description: string | null;
  price: number | null;
  category: string | null;
  condition: string | null;
  item_specifics: Record<string, string> | null;
  image_urls: string[] | null;
  shipping_type: string | null;
  shipping_cost: number | null;
  handling_time: number | null;
  returns_accepted: boolean | null;
  return_period: number | null;
  return_shipping: string | null;
  best_offer_enabled: boolean | null;
  best_offer_auto_accept: number | null;
  minimum_best_offer: number | null;
  brand: string | null;
  upc: string | null;
  mpn: string | null;
  subtitle: string | null;
}

function buildAddFixedPriceItemXml(row: EbayRow): string {
  const title = (row.title || "").substring(0, 80).replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
  const description = row.description || "";
  const categoryId = row.category?.match(/\d{3,}/)?.[0] || "0";
  const conditionId = mapConditionId(row.condition);
  const price = (row.price || 0).toFixed(2);
  const shippingCost = row.shipping_type === "free" ? "0.00"
    : row.shipping_cost ? row.shipping_cost.toFixed(2)
    : "9.98"; // JSG default

  // Pictures — Trading API accepts up to 12 external URLs directly
  const imageUrls = (row.image_urls || []).slice(0, 12);
  const pictureXml = imageUrls.length > 0
    ? `<PictureDetails>${imageUrls.map(u => `<PictureURL>${u}</PictureURL>`).join("")}</PictureDetails>`
    : "";

  // Item specifics
  const specifics: Record<string, string> = { ...(row.item_specifics || {}) };
  if (row.brand && !specifics["Brand"]) specifics["Brand"] = row.brand;
  if (row.mpn && !specifics["MPN"]) specifics["MPN"] = row.mpn;
  if (row.upc && !specifics["UPC"]) specifics["UPC"] = row.upc;

  // Universal fallback — eBay requires Compatible Brand for many categories
  if (!specifics["Compatible Brand"]) specifics["Compatible Brand"] = "Does Not Apply";

  // Category-required defaults (mirrors EbayBatchPanel CATEGORY_REQUIRED_SPECIFICS)
  const MODEL_KIT_CATEGORIES = new Set(["31787", "37278", "51023", "19063"]);
  if (MODEL_KIT_CATEGORIES.has(categoryId)) {
    if (!specifics["Shade"]) specifics["Shade"] = "Multicolor";
    if (!specifics["Type"]) specifics["Type"] = "Scale Model Kit";
    if (!specifics["Brand"]) specifics["Brand"] = "Unbranded";
  }

  // Fragrances — eBay requires "Fragrance Name" (error 21919303 if missing)
  const FRAGRANCE_CATEGORIES = new Set(["11848", "11849", "11850", "11846", "31786", "177989", "177990"]);
  if (FRAGRANCE_CATEGORIES.has(categoryId)) {
    if (!specifics["Fragrance Name"]) {
      // Extract fragrance name: strip qty/type suffixes, take first 65 chars
      const cleaned = (row.title || "")
        .replace(/\d+(\.\d+)?\s*(oz|fl oz|ml|ounce)s?/gi, "")
        .replace(/\b(eau de (parfum|toilette|cologne)|edp|edt|edc|parfum|perfume|cologne|fragrance|spray|set|gift set|for\s+(men|women|him|her|man|woman))\b/gi, "")
        .replace(/\s{2,}/g, " ")
        .trim();
      specifics["Fragrance Name"] = cleaned.substring(0, 65) || (row.brand ?? "See Title");
    }
    if (!specifics["Type"]) specifics["Type"] = "Eau de Parfum";
  }

  // Clothing — eBay requires Department and Size (error 21919303 if missing)
  // Department is deterministic from category; Size falls back to "See Description" if AI didn't provide it.
  const MENS_CLOTHING_CATEGORIES = new Set([
    "21235",  // Men's T-Shirts
    "57990",  // Men's Casual Shirts
    "57991",  // Men's Dress Shirts
    "11483",  // Men's Jeans
    "57989",  // Men's Dress Pants
    "11484",  // Men's Sweaters
    "3001",   // Men's Suits & Blazers
    "15709",  // Men's Athletic Shoes
    "24087",  // Men's Casual Shoes / Loafers
    "53120",  // Men's Dress Shoes
    "4250",   // Men's Bags
  ]);
  const WOMENS_CLOTHING_CATEGORIES = new Set([
    "63862",  // Women's Coats & Jackets
    "53159",  // Women's Tops & Blouses
    "63861",  // Women's Dresses
    "11554",  // Women's Jeans
    "63866",  // Women's Sweaters
    "185176", // Women's Activewear Tops
    "55793",  // Women's Pumps & Heels
    "45333",  // Women's Flats
    "95672",  // Women's Athletic Shoes
    "169291", // Women's Shoulder Bags & Totes
  ]);
  if (MENS_CLOTHING_CATEGORIES.has(categoryId)) {
    if (!specifics["Department"]) specifics["Department"] = "Men";
    if (!specifics["Size"]) specifics["Size"] = "See Description";
  }
  if (WOMENS_CLOTHING_CATEGORIES.has(categoryId)) {
    if (!specifics["Department"]) specifics["Department"] = "Women";
    if (!specifics["Size"]) specifics["Size"] = "See Description";
  }

  const specificsXml = Object.entries(specifics).length > 0
    ? `<ItemSpecifics>${Object.entries(specifics).map(([k, v]) =>
        `<NameValueList><Name>${k.replace(/&/g, "&amp;")}</Name><Value>${String(v).replace(/&/g, "&amp;")}</Value></NameValueList>`
      ).join("")}</ItemSpecifics>`
    : "";

  // Best offer
  const bestOfferXml = row.best_offer_enabled
    ? `<BestOfferDetails><BestOfferEnabled>true</BestOfferEnabled></BestOfferDetails>` : "";

  // Subtitle
  const subtitleXml = row.subtitle
    ? `<SubTitle>${row.subtitle.substring(0, 55).replace(/&/g, "&amp;")}</SubTitle>` : "";

  return `<?xml version="1.0" encoding="utf-8"?>
<AddFixedPriceItemRequest xmlns="urn:ebay:apis:eBLBaseComponents">
  <ErrorLanguage>en_US</ErrorLanguage>
  <WarningLevel>High</WarningLevel>
  <Item>
    <Title>${title}</Title>
    ${subtitleXml}
    <Description><![CDATA[${description}]]></Description>
    <PrimaryCategory><CategoryID>${categoryId}</CategoryID></PrimaryCategory>
    <StartPrice>${price}</StartPrice>
    <CategoryMappingAllowed>true</CategoryMappingAllowed>
    <ConditionID>${conditionId}</ConditionID>
    <Country>US</Country>
    <Currency>USD</Currency>
    <DispatchTimeMax>1</DispatchTimeMax>
    <ListingDuration>GTC</ListingDuration>
    <ListingType>FixedPriceItem</ListingType>
    <Location>Highlands Ranch, CO</Location>
    <PostalCode>80129</PostalCode>
    <Quantity>1</Quantity>
    <ReturnPolicy>
      <ReturnsAcceptedOption>ReturnsAccepted</ReturnsAcceptedOption>
      <RefundOption>MoneyBack</RefundOption>
      <ReturnsWithinOption>Days_30</ReturnsWithinOption>
      <ShippingCostPaidByOption>Seller</ShippingCostPaidByOption>
    </ReturnPolicy>
    <ShippingDetails>
      <ShippingType>Flat</ShippingType>
      <ShippingServiceOptions>
        <ShippingServicePriority>1</ShippingServicePriority>
        <ShippingService>USPSFirstClass</ShippingService>
        <ShippingServiceCost>${shippingCost}</ShippingServiceCost>
      </ShippingServiceOptions>
    </ShippingDetails>
    <Site>US</Site>
    ${pictureXml}
    ${specificsXml}
    ${bestOfferXml}
  </Item>
</AddFixedPriceItemRequest>`;
}

/* ──────────── Call Trading API ──────────── */

async function publishRow(
  row: EbayRow,
  accessToken: string,
  tradingApiUrl: string,
  environment: EbayEnvironment
): Promise<{ success: boolean; error?: string; details?: string[]; listingId?: string; usedCategoryId?: string; categoryName?: string }> {
  try {
    // Guard: reject rows with no valid eBay category ID before hitting the API
    let categoryId = row.category?.match(/\d{3,}/)?.[0];
    if (!categoryId) {
      return {
        success: false,
        error: `Lot ${row.lot_number}: No eBay category ID found. Category field is: "${row.category || "empty"}". Set a numeric eBay category ID in the app before pushing.`,
      };
    }

    // Apply keyword-based category fix — catches AI-hallucinated IDs, first match wins
    for (const entry of KEYWORD_CATEGORY_MAP) {
      if (entry.pattern.test(row.title || "")) {
        if (categoryId !== entry.categoryId) {
          console.log(`[ebay-publish] LOT-${row.lot_number}: keyword match "${entry.name}", overriding category ${categoryId} -> ${entry.categoryId}`);
        }
        categoryId = entry.categoryId;
        break;
      }
    }

    const xml = buildAddFixedPriceItemXml({ ...row, category: categoryId });

    const res = await fetch(tradingApiUrl, {
      method: "POST",
      headers: {
        "Content-Type": "text/xml",
        "X-EBAY-API-CALL-NAME": "AddFixedPriceItem",
        "X-EBAY-API-SITEID": "0",
        "X-EBAY-API-COMPATIBILITY-LEVEL": "1193",
        "X-EBAY-API-IAF-TOKEN": accessToken,
      },
      body: xml,
    });

    const responseText = await res.text();

    // Parse item ID from XML response
    const itemIdMatch = responseText.match(/<ItemID>(\d+)<\/ItemID>/);
    const itemId = itemIdMatch?.[1];

    // Check for ack
    const ackMatch = responseText.match(/<Ack>(.*?)<\/Ack>/);
    const ack = ackMatch?.[1] || "";

    if (ack === "Success" || ack === "Warning") {
      return { success: true, listingId: itemId, usedCategoryId: categoryId, categoryName: row.category || categoryId };
    }

    // Extract all error blocks — filter to SeverityCode=Error only (ignore warnings)
    const errorBlocks = [...responseText.matchAll(
      /<Errors>([\s\S]*?)<\/Errors>/g
    )].map(m => m[1]);

    const realErrors = errorBlocks.filter(b => /<SeverityCode>Error<\/SeverityCode>/.test(b));
    const allForLog  = errorBlocks; // log everything

    const extract = (block: string, tag: string) =>
      block.match(new RegExp(`<${tag}>(.*?)<\/${tag}>`, "s"))?.[1]?.replace(/<[^>]+>/g, "").trim() || "";

    const logLines = allForLog.map(b => `[${extract(b,"ErrorCode")}] ${extract(b,"ShortMessage")}`);
    console.error(`[ebay-publish] LOT-${row.lot_number} (category="${row.category}") FAILED — ${logLines.join(" | ")}`);

    const errorSummary = realErrors.length > 0
      ? realErrors.map(b => `[${extract(b,"ErrorCode")}] ${extract(b,"ShortMessage")}: ${extract(b,"LongMessage")}`).join(" | ")
      : logLines.join(" | ");

    return { success: false, error: `Lot ${row.lot_number} (cat:${categoryId}): ${errorSummary}` };

  } catch (e) {
    return { success: false, error: e instanceof Error ? e.message : String(e) };
  }
}

/* ──────────────────── Main handler ──────────────────── */

Deno.serve(async (req: Request) => {
  if (req.method === "OPTIONS") {
    return new Response(null, { headers: corsHeaders });
  }

  try {
    const body = await req.json();
    const authHeader = req.headers.get("authorization");

    // Resolve credentials: per-user DB row first, fall back to shared secrets
    const userCreds = await getUserEbayCreds(authHeader);
    console.log(userCreds ? "[ebay-publish] Using per-user eBay credentials" : "[ebay-publish] Using shared eBay credentials (fallback)");

    // Quick auth test mode
    if (body.test_auth_only) {
      const auth = await getAccessToken(userCreds);
      return new Response(
        JSON.stringify({ success: true, environment: auth.environment }),
        { status: 200, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    const { rows } = body;
    if (!rows || !Array.isArray(rows) || rows.length === 0) {
      return new Response(
        JSON.stringify({ error: "rows array required" }),
        { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    // Get eBay access token (per-user if available, shared secrets otherwise)
    const { accessToken, environment, tradingApiUrl } = await getAccessToken(userCreds);
    console.log(`Publishing via Trading API — ${environment}`);

    // Process each row
    const results = [];
    for (const row of rows) {
      const result = await publishRow(row as unknown as EbayRow, accessToken, tradingApiUrl, environment);
      results.push({ id: row.id, lot_number: row.lot_number, ...result });
      // Save category learning for every successful push
      if (result.success && result.usedCategoryId) {
        await saveCategoryLearning((row as any).title || '', result.usedCategoryId, result.categoryName || result.usedCategoryId);
      }
    }

    const succeeded = results.filter((r) => r.success).length;
    const failed = results.filter((r) => !r.success).length;

    return new Response(
      JSON.stringify({ succeeded, failed, results }),
      { status: 200, headers: { ...corsHeaders, "Content-Type": "application/json" } }
    );
  } catch (e) {
    console.error("ebay-publish error:", e);
    return new Response(
      JSON.stringify({ error: e instanceof Error ? e.message : String(e) }),
      { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } }
    );
  }
});
