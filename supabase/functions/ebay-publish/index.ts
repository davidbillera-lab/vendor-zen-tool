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

async function getAccessToken(): Promise<{ accessToken: string; environment: EbayEnvironment; tradingApiUrl: string }> {
  const environment = getEnvironment();
  const clientId = sanitizeSecret("EBAY_CLIENT_ID");
  const clientSecret = sanitizeSecret("EBAY_CLIENT_SECRET");
  const refreshToken = sanitizeSecret("EBAY_REFRESH_TOKEN");

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
): Promise<{ success: boolean; error?: string; details?: string[]; listingId?: string }> {
  try {
    // Guard: reject rows with no valid eBay category ID before hitting the API
    let categoryId = row.category?.match(/\d{3,}/)?.[0];
    if (!categoryId) {
      return {
        success: false,
        error: `Lot ${row.lot_number}: No eBay category ID found. Category field is: "${row.category || "empty"}". Set a numeric eBay category ID in the app before pushing.`,
      };
    }

    // Known-good eBay leaf category IDs for JSG
    const KNOWN_GOOD_CATEGORIES = new Set([
      "31787", "37278", "51023", "19063",  // model kits
      "262318", "47006", "47004",           // model trains
      "20668", "133704",                    // blankets/throws
      "11724", "15230",                     // cameras
      "20625",                              // kitchen knives
    ]);

    // Known bad AI-generated IDs → correct leaf ID
    const BAD_CATEGORY_REMAPS: Record<string, string> = {
      "178224": "20625",  // AI hallucination → Kitchen Knives & Cutlery Sets
    };

    // Apply known bad ID remap first
    if (BAD_CATEGORY_REMAPS[categoryId]) {
      console.log(`[ebay-publish] LOT-${row.lot_number}: remapping bad category ${categoryId} → ${BAD_CATEGORY_REMAPS[categoryId]}`);
      categoryId = BAD_CATEGORY_REMAPS[categoryId];
    }

    // Title-based category override for items with bad/unknown categories
    if (!KNOWN_GOOD_CATEGORIES.has(categoryId)) {
      const titleLower = (row.title || "").toLowerCase();
      if (/\b(knife|knives|cleaver|slicer|santoku|boning|paring|cutlery|chef knife)\b/.test(titleLower)) {
        console.log(`[ebay-publish] LOT-${row.lot_number}: knife keyword in title, overriding category ${categoryId} → 20625`);
        categoryId = "20625";
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
      return { success: true, listingId: itemId };
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

    // Quick auth test mode
    if (body.test_auth_only) {
      const auth = await getAccessToken();
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

    // Get eBay access token
    const { accessToken, environment, tradingApiUrl } = await getAccessToken();
    console.log(`Publishing via Trading API — ${environment}`);

    // Process each row
    const results = [];
    for (const row of rows) {
      const result = await publishRow(row as unknown as EbayRow, accessToken, tradingApiUrl, environment);
      results.push({ id: row.id, lot_number: row.lot_number, ...result });
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
