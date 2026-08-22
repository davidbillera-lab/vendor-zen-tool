import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers":
    "authorization, x-client-info, apikey, content-type, x-supabase-client-platform, x-supabase-client-platform-version, x-supabase-client-runtime, x-supabase-client-runtime-version",
};

/* ───────────────────── eBay OAuth helpers ───────────────────── */

type EbayEnvironment = "production" | "sandbox";

const EBAY_ENV_CONFIG: Record<EbayEnvironment, { tradingApiUrl: string; oauthTokenUrl: string; inventoryApiBase: string }> = {
  production: {
    tradingApiUrl: "https://api.ebay.com/ws/api.dll",
    oauthTokenUrl: "https://api.ebay.com/identity/v1/oauth2/token",
    inventoryApiBase: "https://api.ebay.com/sell/inventory/v1",
  },
  sandbox: {
    tradingApiUrl: "https://api.sandbox.ebay.com/ws/api.dll",
    oauthTokenUrl: "https://api.sandbox.ebay.com/identity/v1/oauth2/token",
    inventoryApiBase: "https://api.sandbox.ebay.com/sell/inventory/v1",
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

// Look up per-user eBay credentials from DB. Returns null if user has not connected eBay.
// SaaS model: EBAY_CLIENT_ID/SECRET are shared app creds (env vars); only refresh_token is per-user.
async function getUserEbayCreds(authHeader: string | null): Promise<{ clientId: string; clientSecret: string; refreshToken: string } | null> {
  if (!authHeader?.startsWith("Bearer ")) return null;
  const supabaseUrl = Deno.env.get("SUPABASE_URL");
  const serviceRoleKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");
  if (!supabaseUrl || !serviceRoleKey) return null;

  try {
    const jwt = authHeader.slice(7);
    const payload = JSON.parse(atob(jwt.split(".")[1]));
    const userId = payload.sub as string;
    if (!userId) return null;

    const supabase = createClient(supabaseUrl, serviceRoleKey);
    const { data } = await supabase
      .from("user_ebay_credentials")
      .select("refresh_token")
      .eq("user_id", userId)
      .maybeSingle();

    if (!data?.refresh_token) return null;
    const clientId = sanitizeSecret("EBAY_CLIENT_ID");
    const clientSecret = sanitizeSecret("EBAY_CLIENT_SECRET");
    if (!clientId || !clientSecret) return null;
    return { clientId, clientSecret, refreshToken: data.refresh_token };
  } catch {
    return null;
  }
}

async function getAccessToken(userCreds?: { clientId: string; clientSecret: string; refreshToken: string } | null): Promise<{ accessToken: string; environment: EbayEnvironment; tradingApiUrl: string }> {
  const environment = getEnvironment();
  const clientId = userCreds?.clientId ?? sanitizeSecret("EBAY_CLIENT_ID");
  const clientSecret = userCreds?.clientSecret ?? sanitizeSecret("EBAY_CLIENT_SECRET");
  const refreshToken = userCreds?.refreshToken ?? "";

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

async function getInventoryAccessToken(userCreds?: { clientId: string; clientSecret: string; refreshToken: string } | null): Promise<{ accessToken: string; environment: EbayEnvironment; inventoryApiBase: string }> {
  const environment = getEnvironment();
  const clientId = userCreds?.clientId ?? sanitizeSecret("EBAY_CLIENT_ID");
  const clientSecret = userCreds?.clientSecret ?? sanitizeSecret("EBAY_CLIENT_SECRET");
  const refreshToken = userCreds?.refreshToken ?? "";

  const b64Auth = btoa(`${clientId}:${clientSecret}`);
  const oauthUrl = EBAY_ENV_CONFIG[environment].oauthTokenUrl;

  // Try sell.inventory scope first; fall back to basic api_scope for tokens
  // connected before sell.inventory was added to REQUIRED_SCOPES.
  for (const scope of [
    "https://api.ebay.com/oauth/api_scope/sell.inventory",
    "https://api.ebay.com/oauth/api_scope",
  ]) {
    const res = await fetch(oauthUrl, {
      method: "POST",
      headers: {
        "Content-Type": "application/x-www-form-urlencoded",
        Authorization: `Basic ${b64Auth}`,
      },
      body: new URLSearchParams({ grant_type: "refresh_token", refresh_token: refreshToken, scope }),
    });

    if (res.ok) {
      const data = await res.json();
      console.log(`[ebay-publish] Inventory token obtained with scope: ${scope}`);
      return { accessToken: data.access_token, environment, inventoryApiBase: EBAY_ENV_CONFIG[environment].inventoryApiBase };
    }

    const text = await res.text();
    console.warn(`[ebay-publish] Token refresh failed for scope ${scope} (${res.status}): ${text}`);
  }

  throw new Error("Inventory API OAuth token refresh failed for all scopes. Re-authorize eBay in Settings → Platforms.");
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

/* ──────────── Category-aware condition resolution ────────────
 * eBay validates ConditionID PER CATEGORY — the same id is legal in one
 * category and rejected in another (error 21916883 "Invalid condition id").
 * There is no condition field in the UI, so a rejected id is unfixable by
 * the operator. We ask eBay which conditions the category actually allows
 * and remap to the closest legal one instead of failing the push.
 */

// Preference chain per condition: first entry is the ideal, rest are
// progressively-more-conservative legal substitutes.
const CONDITION_FALLBACKS: Record<number, number[]> = {
  1000: [1000, 1500, 2750, 3000],
  1500: [1500, 1000, 2750, 3000],
  1750: [1750, 1500, 3000, 6000],
  2000: [2000, 2010, 2020, 2030, 2500, 3000],
  2500: [2500, 2000, 3000],
  2750: [2750, 3000, 4000, 1500],
  3000: [3000, 4000, 5000, 2750, 6000],
  4000: [4000, 3000, 5000, 6000],
  5000: [5000, 4000, 3000, 6000],
  6000: [6000, 5000, 4000, 3000],
  7000: [7000, 6000, 5000, 4000, 3000],
};

const conditionPolicyCache = new Map<string, number[] | null>();

/**
 * Returns the condition IDs eBay allows for a category, or null when the
 * policy can't be determined (API down / no creds) so callers keep current
 * behaviour rather than guessing.
 */
async function getAllowedConditionIds(
  categoryId: string,
  userCreds?: { clientId: string; clientSecret: string; refreshToken: string } | null,
): Promise<number[] | null> {
  if (conditionPolicyCache.has(categoryId)) return conditionPolicyCache.get(categoryId)!;
  try {
    const clientId = userCreds?.clientId ?? (Deno.env.get("EBAY_CLIENT_ID") ?? "").trim();
    const clientSecret = userCreds?.clientSecret ?? (Deno.env.get("EBAY_CLIENT_SECRET") ?? "").trim();
    if (!clientId || !clientSecret) return null;

    const tokenRes = await fetch("https://api.ebay.com/identity/v1/oauth2/token", {
      method: "POST",
      headers: {
        "Content-Type": "application/x-www-form-urlencoded",
        Authorization: `Basic ${btoa(`${clientId}:${clientSecret}`)}`,
      },
      body: new URLSearchParams({ grant_type: "client_credentials", scope: "https://api.ebay.com/oauth/api_scope" }),
    });
    if (!tokenRes.ok) return null;
    const { access_token } = await tokenRes.json();

    const res = await fetch(
      `https://api.ebay.com/sell/metadata/v1/marketplace/EBAY_US/get_item_condition_policies?filter=categoryIds:{${categoryId}}`,
      { headers: { Authorization: `Bearer ${access_token}`, "Accept-Language": "en-US" } },
    );
    if (!res.ok) { conditionPolicyCache.set(categoryId, null); return null; }
    const data = await res.json();
    const policy = (data.itemConditionPolicies ?? [])[0];
    const ids = (policy?.itemConditions ?? [])
      .map((c: any) => parseInt(String(c.conditionId), 10))
      .filter((n: number) => Number.isFinite(n));
    // An empty list means "eBay imposes no condition restriction here" — treat
    // as unknown so we don't remap against a phantom constraint.
    const result = ids.length > 0 ? ids : null;
    conditionPolicyCache.set(categoryId, result);
    return result;
  } catch {
    conditionPolicyCache.set(categoryId, null);
    return null;
  }
}

/**
 * Picks a ConditionID that is legal for this category.
 * Returns the original id unchanged when the policy is unknown.
 */
function resolveConditionId(desiredId: number, allowed: number[] | null): { id: number; remapped: boolean } {
  if (!allowed || allowed.length === 0) return { id: desiredId, remapped: false };
  if (allowed.includes(desiredId)) return { id: desiredId, remapped: false };
  for (const candidate of CONDITION_FALLBACKS[desiredId] ?? []) {
    if (allowed.includes(candidate)) return { id: candidate, remapped: true };
  }
  // No chain match — fall back to whatever the category does allow, preferring
  // a used-family id over "New" so we never overstate an item's condition.
  const usedFirst = [...allowed].sort((a, b) => b - a);
  return { id: usedFirst[0], remapped: true };
}

/* ──────────── Condition enum mapping (Inventory API) ──────────── */

function mapConditionEnum(condition: string | null): string {
  const map: Record<string, string> = {
    "New": "NEW",
    "New with tags": "NEW",
    "New without tags": "NEW_OTHER",
    "New other": "NEW_OTHER",
    "Open box": "LIKE_NEW",
    "Used": "USED_GOOD",
    "Pre-owned": "USED_GOOD",
    "Pre-owned - Excellent": "USED_EXCELLENT",
    "Pre-owned - Good": "USED_GOOD",
    "Pre-owned - Fair": "USED_ACCEPTABLE",
    "Certified refurbished": "CERTIFIED_REFURBISHED",
    "Seller refurbished": "SELLER_REFURBISHED",
    "For parts": "FOR_PARTS_OR_NOT_WORKING",
    "For parts or not working": "FOR_PARTS_OR_NOT_WORKING",
  };
  return map[condition || ""] ?? "USED_GOOD";
}

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
  promotion_rate: number | null;
  custom_sku: string | null;
}

function buildEffectiveSpecifics(categoryId: string, row: EbayRow): Record<string, string> {
  const specifics: Record<string, string> = { ...(row.item_specifics || {}) };
  if (row.brand && !specifics["Brand"]) specifics["Brand"] = row.brand;
  if (row.mpn && !specifics["MPN"]) specifics["MPN"] = row.mpn;
  if (row.upc && !specifics["UPC"]) specifics["UPC"] = row.upc;
  if (row.custom_sku?.trim()) specifics["Custom Label"] = row.custom_sku.trim();

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
      const cleaned = (row.title || "")
        .replace(/\d+(\.\d+)?\s*(oz|fl oz|ml|ounce)s?/gi, "")
        .replace(/\b(eau de (parfum|toilette|cologne)|edp|edt|edc|parfum|perfume|cologne|fragrance|spray|set|gift set|for\s+(men|women|him|her|man|woman))\b/gi, "")
        .replace(/\s{2,}/g, " ")
        .trim();
      specifics["Fragrance Name"] = cleaned.substring(0, 65) || (row.brand ?? "See Title");
    }
    if (!specifics["Type"]) specifics["Type"] = "Eau de Parfum";
    if (!specifics["Volume"]) {
      const volMatch = (row.title || "").match(/(\d+(?:\.\d+)?)\s*(oz|fl\.?\s*oz|ml|ounce)s?/i);
      specifics["Volume"] = volMatch ? `${volMatch[1]} ${volMatch[2].toLowerCase().replace(/\s/g, "")}` : "See Description";
    }
  }

  // Clothing — eBay requires Department and Size (error 21919303 if missing)
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

  return specifics;
}

function buildAddFixedPriceItemXml(
  row: EbayRow,
  conditionIdOverride?: number,
  specificsOverride?: Record<string, string>,
): string {
  const title = (row.title || "").substring(0, 80).replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
  const description = row.description || "";
  const categoryId = row.category?.match(/\d{3,}/)?.[0] || "0";
  const conditionId = conditionIdOverride ?? mapConditionId(row.condition);
  const price = (row.price || 0).toFixed(2);
  const shippingCost = row.shipping_type === "free" ? "0.00"
    : row.shipping_cost ? row.shipping_cost.toFixed(2)
    : "9.98"; // JSG default

  // Pictures — Trading API accepts up to 12 external URLs directly
  const imageUrls = (row.image_urls || []).slice(0, 12);
  const pictureXml = imageUrls.length > 0
    ? `<PictureDetails>${imageUrls.map(u => `<PictureURL>${u}</PictureURL>`).join("")}</PictureDetails>`
    : "";

  // Item specifics — computed by shared helper (also used by guardrail in publishRow).
  // publishRow passes an override that has been length-clamped to eBay's per-aspect
  // limits; without it we would send the unclamped values and fail the push.
  const specifics = specificsOverride ?? buildEffectiveSpecifics(categoryId, row);

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
    <SKU>${(row.custom_sku?.trim() || row.lot_number?.toString() || "").replace(/&/g, "&amp;")}</SKU>
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

/* ──────────── Taxonomy API — fallback category lookup ──────────── */

async function getCategoryFromTaxonomy(title: string, userCreds?: { clientId: string; clientSecret: string; refreshToken: string } | null, excludeId?: string): Promise<{ id: string; name: string } | null> {
  try {
    const clientId = userCreds?.clientId ?? (Deno.env.get("EBAY_CLIENT_ID") ?? "").trim();
    const clientSecret = userCreds?.clientSecret ?? (Deno.env.get("EBAY_CLIENT_SECRET") ?? "").trim();
    if (!clientId || !clientSecret) return null;

    const tokenRes = await fetch("https://api.ebay.com/identity/v1/oauth2/token", {
      method: "POST",
      headers: {
        "Content-Type": "application/x-www-form-urlencoded",
        Authorization: `Basic ${btoa(`${clientId}:${clientSecret}`)}`,
      },
      body: new URLSearchParams({ grant_type: "client_credentials", scope: "https://api.ebay.com/oauth/api_scope" }),
    });
    if (!tokenRes.ok) return null;
    const { access_token } = await tokenRes.json();

    const suggestRes = await fetch(
      `https://api.ebay.com/commerce/taxonomy/v1/category_tree/0/get_category_suggestions?q=${encodeURIComponent(title)}`,
      { headers: { Authorization: `Bearer ${access_token}` } }
    );
    if (!suggestRes.ok) return null;
    const data = await suggestRes.json();
    // Exclude the known-bad category so we don't get the same parent back.
    // eBay marks leaf categories as BEST_MATCH and parent categories as PARENTS_ALSO_SUGGESTED.
    // Prefer BEST_MATCH; if none, fall back to the deepest category by tree level.
    const suggestions: any[] = (data.categorySuggestions || [])
      .filter((s: any) => !excludeId || String(s.category?.categoryId) !== excludeId);
    const bestMatch = suggestions.find(s => s.relevancy === "BEST_MATCH");
    let top = bestMatch?.category;
    if (!top?.categoryId) {
      const byDepth = [...suggestions].sort(
        (a, b) => (b.categoryTreeNodeLevel || 0) - (a.categoryTreeNodeLevel || 0)
      );
      top = byDepth[0]?.category;
    }
    if (!top?.categoryId) return null;
    return { id: String(top.categoryId), name: String(top.categoryName || top.categoryId) };
  } catch {
    return null;
  }
}

/* ──────────── Taxonomy API — required aspects for a category ──────────── */

async function getRequiredAspectsForCategory(categoryId: string, userCreds?: { clientId: string; clientSecret: string; refreshToken: string } | null): Promise<string[]> {
  try {
    const clientId = userCreds?.clientId ?? (Deno.env.get("EBAY_CLIENT_ID") ?? "").trim();
    const clientSecret = userCreds?.clientSecret ?? (Deno.env.get("EBAY_CLIENT_SECRET") ?? "").trim();
    if (!clientId || !clientSecret) return [];

    const tokenRes = await fetch("https://api.ebay.com/identity/v1/oauth2/token", {
      method: "POST",
      headers: {
        "Content-Type": "application/x-www-form-urlencoded",
        Authorization: `Basic ${btoa(`${clientId}:${clientSecret}`)}`,
      },
      body: new URLSearchParams({ grant_type: "client_credentials", scope: "https://api.ebay.com/oauth/api_scope" }),
    });
    if (!tokenRes.ok) return [];
    const { access_token } = await tokenRes.json();

    const res = await fetch(
      `https://api.ebay.com/commerce/taxonomy/v1/category_tree/0/get_aspects_for_category?category_id=${categoryId}`,
      { headers: { Authorization: `Bearer ${access_token}` } }
    );
    if (!res.ok) return [];
    const data = await res.json();

    return (data.aspects ?? [])
      .filter((a: any) => a.aspectConstraint?.aspectRequired === true || a.aspectConstraint?.aspectUsage === "REQUIRED")
      .map((a: any) => String(a.localizedAspectName));
  } catch {
    return [];
  }
}

/* ──────────── Aspect value length limits ────────────
 * eBay rejects any item-specific value longer than the aspect's max length
 * (commonly 65 chars — the "Features" line is the usual casualty). The
 * operator has no way to know the limit, so we clamp to it instead of
 * letting the push fail.
 */

const ASPECT_VALUE_FALLBACK_MAX = 65;
const aspectLimitCache = new Map<string, Record<string, number>>();

async function getAspectMaxLengths(
  categoryId: string,
  userCreds?: { clientId: string; clientSecret: string; refreshToken: string } | null,
): Promise<Record<string, number>> {
  if (aspectLimitCache.has(categoryId)) return aspectLimitCache.get(categoryId)!;
  try {
    const clientId = userCreds?.clientId ?? (Deno.env.get("EBAY_CLIENT_ID") ?? "").trim();
    const clientSecret = userCreds?.clientSecret ?? (Deno.env.get("EBAY_CLIENT_SECRET") ?? "").trim();
    if (!clientId || !clientSecret) return {};

    const tokenRes = await fetch("https://api.ebay.com/identity/v1/oauth2/token", {
      method: "POST",
      headers: {
        "Content-Type": "application/x-www-form-urlencoded",
        Authorization: `Basic ${btoa(`${clientId}:${clientSecret}`)}`,
      },
      body: new URLSearchParams({ grant_type: "client_credentials", scope: "https://api.ebay.com/oauth/api_scope" }),
    });
    if (!tokenRes.ok) return {};
    const { access_token } = await tokenRes.json();

    const res = await fetch(
      `https://api.ebay.com/commerce/taxonomy/v1/category_tree/0/get_aspects_for_category?category_id=${categoryId}`,
      { headers: { Authorization: `Bearer ${access_token}` } },
    );
    if (!res.ok) return {};
    const data = await res.json();

    const limits: Record<string, number> = {};
    for (const a of data.aspects ?? []) {
      const name = String(a.localizedAspectName ?? "");
      const max = Number(a.aspectConstraint?.aspectMaxLength);
      if (name && Number.isFinite(max) && max > 0) limits[name] = max;
    }
    aspectLimitCache.set(categoryId, limits);
    return limits;
  } catch {
    return {};
  }
}

/** Trims to `limit`, preferring a comma/word boundary so the value stays readable. */
function clampAspectValue(value: string, limit: number): string {
  if (value.length <= limit) return value;
  const cut = value.substring(0, limit);
  const boundary = Math.max(cut.lastIndexOf(", "), cut.lastIndexOf(" "));
  // Only honour the boundary if it keeps most of the allowance.
  return (boundary > limit * 0.6 ? cut.substring(0, boundary) : cut).replace(/[,\s]+$/, "");
}

function clampSpecifics(
  specifics: Record<string, string>,
  maxLengths: Record<string, number>,
): { specifics: Record<string, string>; clamped: string[] } {
  const out: Record<string, string> = {};
  const clamped: string[] = [];
  for (const [name, raw] of Object.entries(specifics)) {
    const value = String(raw ?? "");
    const limit = maxLengths[name] ?? ASPECT_VALUE_FALLBACK_MAX;
    if (value.length > limit) {
      out[name] = clampAspectValue(value, limit);
      clamped.push(`${name} (${value.length}→${limit})`);
    } else {
      out[name] = value;
    }
  }
  return { specifics: out, clamped };
}

/* ──────────── Pre-publish QA agent ──────────── */

// Deterministic backstop matching enrich-ebay-batch's rule: a measurement-type
// specific is only kept if it was already on the row or its value literally
// appears in the title/description. Prompt-only controls can be ignored by the
// model, so this is the last line of defense right before publish.
const MEASUREMENT_KEY_PATTERN = /^(item\s*)?(length|width|height|depth|weight|capacity|dimensions?)$/i;

function sanitizeMeasurementSpecifics(
  specifics: Record<string, string>,
  row: EbayRow
): Record<string, string> {
  const haystack = `${row.title || ""} ${row.description || ""}`.toLowerCase();
  const existing = row.item_specifics ?? {};
  const cleaned: Record<string, string> = {};
  for (const [key, value] of Object.entries(specifics)) {
    if (MEASUREMENT_KEY_PATTERN.test(key.trim())) {
      const existingValue = existing[key];
      const valueInText = !!value && haystack.includes(String(value).toLowerCase());
      if (!existingValue && !valueInText) {
        continue; // unverified measurement guess — drop it
      }
    }
    cleaned[key] = value;
  }
  return cleaned;
}

async function runPrePublishQA(
  row: EbayRow,
  categoryId: string,
  categoryName: string,
  requiredAspects: string[],
  userCreds?: { clientId: string; clientSecret: string; refreshToken: string } | null
): Promise<{ correctedCategoryId?: string; correctedCategoryName?: string; filledSpecifics: Record<string, string>; qaLog: string }> {
  const apiKey = Deno.env.get("ANTHROPIC_API_KEY");
  if (!apiKey) {
    return { filledSpecifics: {}, qaLog: "QA skipped: ANTHROPIC_API_KEY not configured" };
  }

  const images = (row.image_urls || []).slice(0, 4);
  const content: any[] = [];

  for (const url of images) {
    content.push({ type: "image", source: { type: "url", url } });
  }

  const currentSpecifics = row.item_specifics ?? {};
  const missingAspects = requiredAspects.filter(a => !currentSpecifics[a]);

  content.push({
    type: "text",
    text: `You are a pre-publish QA agent for an eBay seller. Review this listing and return corrections.

Title: ${row.title}
Description: ${(row.description || "").substring(0, 400)}
Assigned eBay Category: "${categoryName}" (ID: ${categoryId})
Current Item Specifics: ${JSON.stringify(currentSpecifics)}
Required Specifics Missing Values: ${missingAspects.length > 0 ? missingAspects.join(", ") : "none"}

RULES:
1. CATEGORY: eBay requires a LEAF (terminal) category — broad parent names like "Coins: US", "Stamps", "Electronics", "Clothing", "Jewelry" are NOT valid leaf categories and will cause a publish failure. If the category name sounds like a broad group (a grouping of types) rather than a specific item type, set categoryOk=false and describe the specific item in 4-6 words so the system can resolve the correct leaf category. Only set categoryOk=false if you are confident the category is wrong — a specific type name like "Half Dollars" or "Lamps & Shades" is fine.
2. ITEM SPECIFICS: For missing required specifics, fill only values you can confidently determine from the title, description, or images. Omit anything uncertain.
3. MEASUREMENT RULE (HARD): Never guess or estimate measurement-type specifics (Item Length/Width/Height/Depth, Weight, Capacity, Dimensions) from photos. Only fill them if an explicit value is already present in the title or description — otherwise omit them entirely. A garment/shoe/ring size read from a label is not a measurement and is fine.

Return ONLY valid JSON, no markdown:
{
  "categoryOk": true,
  "itemDescription": null,
  "filledSpecifics": {},
  "reasoning": "one sentence summary"
}`,
  });

  try {
    const res = await fetch("https://api.anthropic.com/v1/messages", {
      method: "POST",
      headers: {
        "x-api-key": apiKey,
        "anthropic-version": "2023-06-01",
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        model: "claude-haiku-4-5-20251001",
        max_tokens: 350,
        messages: [{ role: "user", content }],
      }),
    });

    if (!res.ok) {
      console.warn(`[ebay-publish] QA agent API error ${res.status} (non-fatal)`);
      return { filledSpecifics: {}, qaLog: `QA skipped: API ${res.status}` };
    }

    const data = await res.json();
    const text = (data.content?.[0]?.text ?? "").trim();
    // The model often wraps JSON in a ```json fence despite being told not to.
    // Unwrapped, JSON.parse throws and the whole QA pass is silently skipped —
    // which is what let missing required specifics reach eBay one at a time.
    const jsonText = text
      .replace(/^```(?:json)?\s*/i, "")
      .replace(/\s*```$/, "")
      .trim();
    const qa = JSON.parse(jsonText);

    if (qa.categoryOk === false && qa.itemDescription) {
      // Resolve correct category ID via Taxonomy API using Claude's item description
      const corrected = await getCategoryFromTaxonomy(qa.itemDescription, userCreds, categoryId);
      return {
        correctedCategoryId: corrected?.id,
        correctedCategoryName: corrected?.name,
        filledSpecifics: sanitizeMeasurementSpecifics(qa.filledSpecifics ?? {}, row),
        qaLog: qa.reasoning ?? "Category overridden by QA agent",
      };
    }

    return {
      filledSpecifics: sanitizeMeasurementSpecifics(qa.filledSpecifics ?? {}, row),
      qaLog: qa.reasoning ?? "QA passed",
    };
  } catch (e) {
    console.warn("[ebay-publish] QA agent error (non-fatal):", e);
    return { filledSpecifics: {}, qaLog: "QA error — continuing with original data" };
  }
}

/* ──────────── Call Trading API ──────────── */

async function publishRow(
  row: EbayRow,
  accessToken: string,
  tradingApiUrl: string,
  environment: EbayEnvironment,
  userCreds?: { clientId: string; clientSecret: string; refreshToken: string } | null
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

    // ── Pre-publish QA agent: category + item specifics validation ──
    const categoryName = row.category || categoryId;
    const requiredAspects = await getRequiredAspectsForCategory(categoryId, userCreds);
    const qa = await runPrePublishQA(row, categoryId, categoryName, requiredAspects, userCreds);

    if (qa.correctedCategoryId) {
      console.log(`[ebay-publish] LOT-${row.lot_number}: QA OVERRIDE category ${categoryId} (${categoryName}) → ${qa.correctedCategoryId} (${qa.correctedCategoryName}). Reason: ${qa.qaLog}`);
      categoryId = qa.correctedCategoryId;
    } else {
      console.log(`[ebay-publish] LOT-${row.lot_number}: QA OK — ${qa.qaLog}`);
    }

    // Merge QA-filled specifics (never overwrite existing user values)
    const qaRow: EbayRow = Object.keys(qa.filledSpecifics).length > 0
      ? { ...row, item_specifics: { ...(row.item_specifics || {}), ...qa.filledSpecifics } }
      : row;

    // Hard guardrail — reject before hitting Trading API if any required aspect is still missing.
    // Reports EVERY missing aspect at once so the operator fixes them in one pass
    // instead of rediscovering them one eBay rejection at a time.
    const rawSpecifics = buildEffectiveSpecifics(categoryId, { ...qaRow, category: categoryId });
    const aspectMaxLengths = await getAspectMaxLengths(categoryId, userCreds);
    const { specifics: effectiveSpecifics, clamped } = clampSpecifics(rawSpecifics, aspectMaxLengths);
    if (clamped.length > 0) {
      console.log(`[ebay-publish] LOT-${row.lot_number}: trimmed over-long item specifics — ${clamped.join(", ")}`);
    }
    const stillMissing = requiredAspects.filter(a => !effectiveSpecifics[a]);
    if (stillMissing.length > 0) {
      return {
        success: false,
        error: `Lot ${row.lot_number}: Missing required item specifics (${stillMissing.length}): ${stillMissing.join(", ")}. Add all of these in the item specifics panel before publishing.`,
      };
    }

    // Category-aware condition: eBay rejects ids that are illegal for the
    // final category, and the operator has no UI field to correct it.
    const desiredConditionId = mapConditionId(qaRow.condition);
    const allowedConditions = await getAllowedConditionIds(categoryId, userCreds);
    const resolvedCondition = resolveConditionId(desiredConditionId, allowedConditions);
    if (resolvedCondition.remapped) {
      console.log(
        `[ebay-publish] LOT-${row.lot_number}: condition "${qaRow.condition}" (${desiredConditionId}) not valid for category ${categoryId} — using ${resolvedCondition.id}. Allowed: [${(allowedConditions ?? []).join(", ")}]`,
      );
    }

    const xml = buildAddFixedPriceItemXml({ ...qaRow, category: categoryId }, resolvedCondition.id, effectiveSpecifics);

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
    const allForLog  = errorBlocks;

    const extract = (block: string, tag: string) =>
      block.match(new RegExp(`<${tag}>(.*?)<\/${tag}>`, "s"))?.[1]?.replace(/<[^>]+>/g, "").trim() || "";

    const logLines = allForLog.map(b => `[${extract(b,"ErrorCode")}] ${extract(b,"ShortMessage")}`);
    console.error(`[ebay-publish] LOT-${row.lot_number} (category="${row.category}") FAILED — ${logLines.join(" | ")}`);

    // Auto-retry: if eBay says the category is invalid/non-leaf (87 or 107), ask Taxonomy API for the right one
    const categoryErrorCodes = new Set(["87", "107"]);
    const hasCategoryError = realErrors.some(b => categoryErrorCodes.has(extract(b, "ErrorCode")));
    if (hasCategoryError) {
      console.log(`[ebay-publish] LOT-${row.lot_number}: category error detected, querying Taxonomy API for "${row.title}"`);
      const corrected = await getCategoryFromTaxonomy(row.title || "", userCreds, categoryId);
      if (corrected) {
        console.log(`[ebay-publish] LOT-${row.lot_number}: retrying with Taxonomy category ${corrected.id} (${corrected.name})`);
        // Re-resolve the condition against the NEW category — an id that was
        // legal for the old category may be rejected by the corrected one.
        const retryCondition = resolveConditionId(
          mapConditionId(row.condition),
          await getAllowedConditionIds(corrected.id, userCreds),
        );
        // Aspect limits are per-category too — re-clamp against the corrected one.
        const retrySpecifics = clampSpecifics(
          buildEffectiveSpecifics(corrected.id, { ...qaRow, category: corrected.id }),
          await getAspectMaxLengths(corrected.id, userCreds),
        ).specifics;
        const retryXml = buildAddFixedPriceItemXml({ ...row, category: corrected.id }, retryCondition.id, retrySpecifics);
        const retryRes = await fetch(tradingApiUrl, {
          method: "POST",
          headers: {
            "Content-Type": "text/xml",
            "X-EBAY-API-CALL-NAME": "AddFixedPriceItem",
            "X-EBAY-API-SITEID": "0",
            "X-EBAY-API-COMPATIBILITY-LEVEL": "1193",
            "X-EBAY-API-IAF-TOKEN": accessToken,
          },
          body: retryXml,
        });
        const retryText = await retryRes.text();
        const retryAck = retryText.match(/<Ack>(.*?)<\/Ack>/)?.[1] || "";
        const retryItemId = retryText.match(/<ItemID>(\d+)<\/ItemID>/)?.[1];
        if (retryAck === "Success" || retryAck === "Warning") {
          console.log(`[ebay-publish] LOT-${row.lot_number}: retry succeeded with category ${corrected.id} (${corrected.name})`);
          return { success: true, listingId: retryItemId, usedCategoryId: corrected.id, categoryName: corrected.name };
        }
      }
    }

    // Safety net: eBay rejected the condition id (21916883) and the metadata
    // lookup didn't catch it (API unavailable, or policy disagrees). There is
    // no condition field in the UI, so retry down the fallback chain rather
    // than dead-ending the operator with an unfixable error.
    const hasConditionError = realErrors.some(b => extract(b, "ErrorCode") === "21916883");
    if (hasConditionError) {
      const attempted = new Set<number>([resolvedCondition.id]);
      const chain = (CONDITION_FALLBACKS[desiredConditionId] ?? []).filter(c => !attempted.has(c));
      for (const candidate of chain) {
        console.log(`[ebay-publish] LOT-${row.lot_number}: condition ${resolvedCondition.id} rejected — retrying with ${candidate}`);
        const condRetryRes = await fetch(tradingApiUrl, {
          method: "POST",
          headers: {
            "Content-Type": "text/xml",
            "X-EBAY-API-CALL-NAME": "AddFixedPriceItem",
            "X-EBAY-API-SITEID": "0",
            "X-EBAY-API-COMPATIBILITY-LEVEL": "1193",
            "X-EBAY-API-IAF-TOKEN": accessToken,
          },
          body: buildAddFixedPriceItemXml({ ...qaRow, category: categoryId }, candidate, effectiveSpecifics),
        });
        const condText = await condRetryRes.text();
        const condAck = condText.match(/<Ack>(.*?)<\/Ack>/)?.[1] || "";
        if (condAck === "Success" || condAck === "Warning") {
          console.log(`[ebay-publish] LOT-${row.lot_number}: succeeded with condition ${candidate}`);
          return {
            success: true,
            listingId: condText.match(/<ItemID>(\d+)<\/ItemID>/)?.[1],
            usedCategoryId: categoryId,
            categoryName: row.category || categoryId,
          };
        }
        // Only keep walking the chain while the failure is still condition-related.
        if (!/21916883/.test(condText)) break;
      }
    }

    // Consolidate item-specific complaints. eBay reports these one aspect per
    // error block, which is what made fixing them a repeated push-fix-push loop.
    // Collect every aspect it named (plus any we already knew were required but
    // unfilled) and return them as a single actionable list.
    const aspectErrorCodes = new Set(["21919303", "21916564", "21917182"]);
    const namedAspects = new Set<string>();
    for (const b of realErrors) {
      if (!aspectErrorCodes.has(extract(b, "ErrorCode"))) continue;
      const text = `${extract(b, "ShortMessage")} ${extract(b, "LongMessage")}`;
      // eBay phrases these as: missing/invalid item specific "Brand" (quoted or after a colon)
      for (const m of text.matchAll(/["“]([^"”]{2,40})["”]/g)) namedAspects.add(m[1].trim());
      for (const m of text.matchAll(/item specific(?:s)?[:\s]+([A-Z][\w &/-]{1,38})/g)) namedAspects.add(m[1].trim());
    }
    if (namedAspects.size > 0) {
      const unfilled = requiredAspects.filter(a => !effectiveSpecifics[a]);
      const all = [...new Set([...namedAspects, ...unfilled])];
      console.error(`[ebay-publish] LOT-${row.lot_number}: eBay rejected ${all.length} item specific(s): ${all.join(", ")}`);
      return {
        success: false,
        error: `Lot ${row.lot_number} (cat:${categoryId}): eBay needs these item specifics — ${all.join(", ")}. Fill all of them, then push again.`,
      };
    }

    const errorSummary = realErrors.length > 0
      ? realErrors.map(b => `[${extract(b,"ErrorCode")}] ${extract(b,"ShortMessage")}: ${extract(b,"LongMessage")}`).join(" | ")
      : logLines.join(" | ");

    return { success: false, error: `Lot ${row.lot_number} (cat:${categoryId}): ${errorSummary}` };

  } catch (e) {
    return { success: false, error: e instanceof Error ? e.message : String(e) };
  }
}

/* ──────────── Marketing API — Promoted Listings ──────────── */

async function getMarketingToken(
  userCreds?: { clientId: string; clientSecret: string; refreshToken: string } | null
): Promise<string | null> {
  try {
    const environment = getEnvironment();
    const clientId = userCreds?.clientId ?? (Deno.env.get("EBAY_CLIENT_ID") ?? "").trim().replace(/^['"]|['"]$/g, "");
    const clientSecret = userCreds?.clientSecret ?? (Deno.env.get("EBAY_CLIENT_SECRET") ?? "").trim().replace(/^['"]|['"]$/g, "");
    const refreshToken = userCreds?.refreshToken ?? "";
    if (!clientId || !clientSecret || !refreshToken) return null;
    const tokenUrl = EBAY_ENV_CONFIG[environment].oauthTokenUrl;
    const res = await fetch(tokenUrl, {
      method: "POST",
      headers: {
        "Content-Type": "application/x-www-form-urlencoded",
        Authorization: `Basic ${btoa(`${clientId}:${clientSecret}`)}`,
      },
      body: new URLSearchParams({
        grant_type: "refresh_token",
        refresh_token: refreshToken,
        scope: "https://api.ebay.com/oauth/api_scope/sell.marketing",
      }),
    });
    if (!res.ok) return null;
    const data = await res.json();
    return data.access_token ?? null;
  } catch {
    return null;
  }
}

async function applyPromotedListings(
  listingsByRate: Map<string, string[]>,
  marketingToken: string
): Promise<string> {
  const environment = getEnvironment();
  const apiBase = environment === "sandbox"
    ? "https://api.sandbox.ebay.com"
    : "https://api.ebay.com";

  const messages: string[] = [];

  for (const [rate, listingIds] of listingsByRate) {
    const campaignName = `JSG Auto-Promote ${rate}%`;
    let campaignId: string | null = null;

    // Find existing running campaign with this name
    const campaignsRes = await fetch(
      `${apiBase}/sell/marketing/v1/ad_campaign?campaign_type=PROMOTED_LISTINGS_STANDARD&limit=50`,
      { headers: { Authorization: `Bearer ${marketingToken}` } }
    );
    if (campaignsRes.ok) {
      const cData = await campaignsRes.json();
      const found = (cData.campaigns ?? []).find((c: any) =>
        c.campaignName === campaignName &&
        (c.campaignStatus === "RUNNING" || c.campaignStatus === "SCHEDULED")
      );
      if (found) campaignId = found.campaignId;
    }

    if (!campaignId) {
      // eBay requires a full ISO-8601 timestamp here (yyyy-MM-ddThh:mm:ss.sssZ).
      // A bare yyyy-MM-dd is rejected (error 35028) and the campaign is never
      // created, so promotions silently never apply.
      const today = new Date().toISOString();
      const createRes = await fetch(`${apiBase}/sell/marketing/v1/ad_campaign`, {
        method: "POST",
        headers: { Authorization: `Bearer ${marketingToken}`, "Content-Type": "application/json" },
        body: JSON.stringify({
          campaignName,
          fundingStrategy: { bidPercentage: rate, fundingModel: "COST_PER_SALE" },
          marketplaceId: "EBAY_US",
          startDate: today,
          campaignType: "PROMOTED_LISTINGS_STANDARD",
        }),
      });
      if (!createRes.ok) {
        const err = await createRes.text();
        console.error(`[ebay-publish] Failed to create campaign for ${rate}%:`, err);
        messages.push(`Promotion at ${rate}% failed: could not create campaign`);
        continue;
      }
      const cData = await createRes.json();
      campaignId = cData.campaignId;
      console.log(`[ebay-publish] Created campaign ${campaignId} for ${rate}%`);
    }

    const bulkRes = await fetch(
      `${apiBase}/sell/marketing/v1/ad_campaign/${campaignId}/bulk_create_ads_by_listing_id`,
      {
        method: "POST",
        headers: { Authorization: `Bearer ${marketingToken}`, "Content-Type": "application/json" },
        body: JSON.stringify({ requests: listingIds.map(id => ({ listingId: id })) }),
      }
    );
    if (!bulkRes.ok) {
      const err = await bulkRes.text();
      console.error(`[ebay-publish] Failed to add ads at ${rate}%:`, err);
      messages.push(`Promotion at ${rate}% failed: could not add listings`);
    } else {
      console.log(`[ebay-publish] Promoted ${listingIds.length} listing(s) at ${rate}%`);
      messages.push(`Promoted ${listingIds.length} listing(s) at ${rate}%`);
    }
  }

  return messages.join("; ");
}

/* ──────────── Inventory API — draft path ──────────── */

async function getOrCreateMerchantLocation(accessToken: string, inventoryApiBase: string): Promise<string> {
  const LOCATION_KEY = "JSG_HIGHLANDS_RANCH";

  const listRes = await fetch(`${inventoryApiBase}/location`, {
    headers: { Authorization: `Bearer ${accessToken}`, "Content-Type": "application/json", "Accept-Language": "en-US" },
  });

  let listInfo = `GET /location → ${listRes.status}`;
  if (listRes.ok) {
    const listData = await listRes.json();
    const locations: any[] = listData.locations ?? [];
    const enabledLocations = locations.filter((l: any) => l.merchantLocationStatus === "ENABLED");
    const allKeys = locations.map((l: any) => `${l.merchantLocationKey}(${l.merchantLocationStatus})`).join(", ");
    listInfo += ` found ${locations.length} location(s) [${allKeys}]`;
    if (enabledLocations.length > 0) {
      const jsgLoc = enabledLocations.find((l: any) => l.merchantLocationKey === LOCATION_KEY);
      const key = jsgLoc ? LOCATION_KEY : enabledLocations[0].merchantLocationKey;
      console.log(`[ebay-publish] ${listInfo} → using ENABLED location "${key}"`);
      return key;
    }
    listInfo += ` — no ENABLED locations`;
  } else {
    const errText = await listRes.text();
    listInfo += ` error: ${errText.substring(0, 200)}`;
  }

  console.log(`[ebay-publish] ${listInfo} — attempting to create location "${LOCATION_KEY}"...`);

  const createRes = await fetch(`${inventoryApiBase}/location/${LOCATION_KEY}`, {
    method: "POST",
    headers: { Authorization: `Bearer ${accessToken}`, "Content-Type": "application/json", "Accept-Language": "en-US" },
    body: JSON.stringify({
      location: {
        address: {
          city: "Highlands Ranch",
          stateOrProvince: "CO",
          postalCode: "80129",
          country: "US",
        },
      },
      locationTypes: ["WAREHOUSE"],
      name: "JSG Estate Liquidators",
      merchantLocationStatus: "ENABLED",
    }),
  });

  if (!createRes.ok) {
    const err = await createRes.text();
    throw new Error(`eBay merchant location setup failed. ${listInfo} | POST /location/${LOCATION_KEY} → ${createRes.status}: ${err.substring(0, 400)}`);
  }

  console.log(`[ebay-publish] Created merchant location "${LOCATION_KEY}" successfully`);
  return LOCATION_KEY;
}

async function createInventoryItem(
  sku: string,
  row: EbayRow,
  effectiveSpecifics: Record<string, string>,
  accessToken: string,
  inventoryApiBase: string
): Promise<void> {
  const aspects: Record<string, string[]> = {};
  for (const [k, v] of Object.entries(effectiveSpecifics)) {
    if (v) aspects[k] = [String(v)];
  }

  const imageUrls = (row.image_urls || []).slice(0, 24);

  const body: Record<string, any> = {
    availability: { shipToLocationAvailability: { quantity: 1 } },
    condition: mapConditionEnum(row.condition),
    product: {
      title: (row.title || "").substring(0, 80),
      description: row.description || "",
      aspects,
      ...(imageUrls.length > 0 ? { imageUrls } : {}),
    },
  };

  const res = await fetch(`${inventoryApiBase}/inventory_item/${encodeURIComponent(sku)}`, {
    method: "PUT",
    headers: {
      Authorization: `Bearer ${accessToken}`,
      "Content-Type": "application/json",
      "Content-Language": "en-US",
      "Accept-Language": "en-US",
    },
    body: JSON.stringify(body),
  });

  if (!res.ok && res.status !== 204) {
    const err = await res.text();
    throw new Error(`createInventoryItem failed (${res.status}): ${err}`);
  }
}

async function createOffer(
  sku: string,
  row: EbayRow,
  categoryId: string,
  merchantLocationKey: string,
  accessToken: string,
  inventoryApiBase: string
): Promise<string> {
  const price = (row.price || 0).toFixed(2);

  const offerBody: Record<string, any> = {
    sku,
    marketplaceId: "EBAY_US",
    format: "FIXED_PRICE",
    availableQuantity: 1,
    categoryId,
    listingDescription: row.description || "",
    pricingSummary: {
      price: { value: price, currency: "USD" },
    },
    listingDuration: "GTC",
    merchantLocationKey,
    ...(row.subtitle ? { subtitle: row.subtitle.substring(0, 55) } : {}),
    ...(row.best_offer_enabled ? {
      bestOfferTerms: {
        bestOfferEnabled: true,
        ...(row.best_offer_auto_accept ? { autoAcceptPrice: { value: row.best_offer_auto_accept.toFixed(2), currency: "USD" } } : {}),
        ...(row.minimum_best_offer ? { autoDeclinePrice: { value: row.minimum_best_offer.toFixed(2), currency: "USD" } } : {}),
      },
    } : {}),
  };

  const res = await fetch(`${inventoryApiBase}/offer`, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${accessToken}`,
      "Content-Type": "application/json",
      "Content-Language": "en-US",
      "Accept-Language": "en-US",
    },
    body: JSON.stringify(offerBody),
  });

  if (!res.ok) {
    const err = await res.text();
    throw new Error(`createOffer failed (${res.status}): ${err}`);
  }

  const data = await res.json();
  return data.offerId as string;
}

async function publishRowAsDraft(
  row: EbayRow,
  accessToken: string,
  inventoryApiBase: string,
  merchantLocationKey: string,
  userCreds?: { clientId: string; clientSecret: string; refreshToken: string } | null
): Promise<{ success: boolean; error?: string; offerId?: string; usedCategoryId?: string; categoryName?: string }> {
  try {
    let categoryId = row.category?.match(/\d{3,}/)?.[0];
    if (!categoryId) {
      return {
        success: false,
        error: `Lot ${row.lot_number}: No eBay category ID found. Category field is: "${row.category || "empty"}". Set a numeric eBay category ID before pushing.`,
      };
    }

    const categoryName = row.category || categoryId;
    const requiredAspects = await getRequiredAspectsForCategory(categoryId, userCreds);
    const qa = await runPrePublishQA(row, categoryId, categoryName, requiredAspects, userCreds);

    if (qa.correctedCategoryId && qa.correctedCategoryId !== categoryId) {
      console.log(`[ebay-publish/draft] LOT-${row.lot_number}: QA OVERRIDE category ${categoryId} → ${qa.correctedCategoryId}. Reason: ${qa.qaLog}`);
      categoryId = qa.correctedCategoryId;
    } else {
      console.log(`[ebay-publish/draft] LOT-${row.lot_number}: QA OK — ${qa.qaLog}`);
    }

    const qaRow: EbayRow = Object.keys(qa.filledSpecifics).length > 0
      ? { ...row, item_specifics: { ...(row.item_specifics || {}), ...qa.filledSpecifics } }
      : row;

    const { specifics: effectiveSpecifics, clamped } = clampSpecifics(
      buildEffectiveSpecifics(categoryId, { ...qaRow, category: categoryId }),
      await getAspectMaxLengths(categoryId, userCreds),
    );
    if (clamped.length > 0) {
      console.log(`[ebay-publish/draft] LOT-${row.lot_number}: trimmed over-long item specifics — ${clamped.join(", ")}`);
    }
    const stillMissing = requiredAspects.filter(a => !effectiveSpecifics[a]);
    if (stillMissing.length > 0) {
      return {
        success: false,
        error: `Lot ${row.lot_number}: Missing required item specifics (${stillMissing.length}): ${stillMissing.join(", ")}. Add all of these before pushing.`,
      };
    }

    const sku = qaRow.custom_sku?.trim() || String(qaRow.lot_number);

    await createInventoryItem(sku, qaRow, effectiveSpecifics, accessToken, inventoryApiBase);
    const offerId = await createOffer(sku, qaRow, categoryId, merchantLocationKey, accessToken, inventoryApiBase);

    return { success: true, offerId, usedCategoryId: categoryId, categoryName: row.category || categoryId };
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

    const userCreds = await getUserEbayCreds(authHeader);
    if (!userCreds) {
      return new Response(
        JSON.stringify({ error: "Connect your eBay account in Settings → Platforms before publishing." }),
        { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

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

    // Draft mode: Inventory API → Seller Hub drafts (unpublished offers)
    if (body.mode === "draft") {
      let inventoryAuth: { accessToken: string; environment: EbayEnvironment; inventoryApiBase: string };
      try {
        inventoryAuth = await getInventoryAccessToken(userCreds);
      } catch (e) {
        return new Response(
          JSON.stringify({ error: `Inventory API auth failed: ${e instanceof Error ? e.message : String(e)}` }),
          { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } }
        );
      }
      console.log(`Creating drafts via Inventory API — ${inventoryAuth.environment}`);

      const merchantLocationKey = await getOrCreateMerchantLocation(inventoryAuth.accessToken, inventoryAuth.inventoryApiBase);
      console.log(`[ebay-publish/draft] merchantLocationKey="${merchantLocationKey}" env=${inventoryAuth.environment}`);

      const draftResults = [];
      for (const row of rows) {
        const result = await publishRowAsDraft(
          row as unknown as EbayRow,
          inventoryAuth.accessToken,
          inventoryAuth.inventoryApiBase,
          merchantLocationKey,
          userCreds
        );
        draftResults.push({ id: row.id, lot_number: row.lot_number, ...result });
        if (result.success && result.usedCategoryId) {
          await saveCategoryLearning((row as any).title || "", result.usedCategoryId, result.categoryName || result.usedCategoryId);
        }
      }

      const succeeded = draftResults.filter(r => r.success).length;
      const failed = draftResults.filter(r => !r.success).length;
      return new Response(
        JSON.stringify({
          succeeded,
          failed,
          results: draftResults,
          debug: { merchantLocationKey, environment: inventoryAuth.environment },
          promotionMessage: succeeded > 0 ? "Promotion applied at publish time — open Seller Hub to review and publish drafts." : undefined,
        }),
        { status: 200, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    // Get eBay access token (per-user if available, shared secrets otherwise)
    const { accessToken, environment, tradingApiUrl } = await getAccessToken(userCreds);
    console.log(`Publishing via Trading API — ${environment}`);

    // Process each row
    const results = [];
    for (const row of rows) {
      const result = await publishRow(row as unknown as EbayRow, accessToken, tradingApiUrl, environment, userCreds);
      results.push({ id: row.id, lot_number: row.lot_number, ...result });
      // Save category learning for every successful push
      if (result.success && result.usedCategoryId) {
        await saveCategoryLearning((row as any).title || '', result.usedCategoryId, result.categoryName || result.usedCategoryId);
      }
    }

    const succeeded = results.filter((r) => r.success).length;
    const failed = results.filter((r) => !r.success).length;

    // Apply Promoted Listings for rows that have a promotion_rate set
    const toPromote = new Map<string, string[]>();
    for (const row of rows) {
      const rate = (row as any).promotion_rate;
      if (rate > 0) {
        const result = results.find((r) => r.id === row.id);
        if (result?.success && result.listingId) {
          const rateStr = String(rate);
          if (!toPromote.has(rateStr)) toPromote.set(rateStr, []);
          toPromote.get(rateStr)!.push(result.listingId);
        }
      }
    }
    let promotionMessage = "";
    if (toPromote.size > 0) {
      const mktToken = await getMarketingToken(userCreds);
      if (mktToken) {
        promotionMessage = await applyPromotedListings(toPromote, mktToken);
      } else {
        promotionMessage = "Re-authorize eBay OAuth with sell.marketing scope to enable auto-promotion.";
        console.warn("[ebay-publish] sell.marketing token unavailable — skipping promotion");
      }
    }

    return new Response(
      JSON.stringify({ succeeded, failed, results, promotionMessage: promotionMessage || undefined }),
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
