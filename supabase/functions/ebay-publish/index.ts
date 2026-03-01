import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers":
    "authorization, x-client-info, apikey, content-type, x-supabase-client-platform, x-supabase-client-platform-version, x-supabase-client-runtime, x-supabase-client-runtime-version",
};

/* ───────────────────── eBay OAuth helpers ───────────────────── */

type EbayEnvironment = "production" | "sandbox";

interface EbayAuthContext {
  accessToken: string;
  apiBaseUrl: string;
  environment: EbayEnvironment;
}

const EBAY_ENV_CONFIG: Record<EbayEnvironment, { apiBaseUrl: string; oauthTokenUrl: string }> = {
  production: {
    apiBaseUrl: "https://api.ebay.com",
    oauthTokenUrl: "https://api.ebay.com/identity/v1/oauth2/token",
  },
  sandbox: {
    apiBaseUrl: "https://api.sandbox.ebay.com",
    oauthTokenUrl: "https://api.sandbox.ebay.com/identity/v1/oauth2/token",
  },
};

function sanitizeSecret(secretName: string): string {
  const raw = Deno.env.get(secretName) ?? "";
  const cleaned = raw.trim().replace(/^['"]|['"]$/g, "");

  if (!cleaned) {
    throw new Error(`Missing or empty required secret: ${secretName}`);
  }

  return cleaned;
}

function getEnvironmentOrder(): EbayEnvironment[] {
  const configured = (Deno.env.get("EBAY_ENV") || Deno.env.get("EBAY_ENVIRONMENT") || "")
    .trim()
    .toLowerCase();

  if (configured === "sandbox") return ["sandbox"];
  if (configured === "production") return ["production"];

  // Try production first (default), then sandbox fallback for mismatched app/token env.
  return ["production", "sandbox"];
}

async function requestAccessToken(environment: EbayEnvironment): Promise<string> {
  const clientId = sanitizeSecret("EBAY_CLIENT_ID");
  const clientSecret = sanitizeSecret("EBAY_CLIENT_SECRET");
  const refreshToken = sanitizeSecret("EBAY_REFRESH_TOKEN");

  // Diagnostic: log credential fingerprints (first 8 + last 4 chars) to verify they match
  const fp = (s: string) => s.length > 12 ? `${s.slice(0, 8)}...${s.slice(-4)}` : `${s.slice(0, 4)}...`;
  console.log(`[eBay ${environment}] ClientID: ${fp(clientId)}, Secret length: ${clientSecret.length}, RefreshToken: ${fp(refreshToken)}`);

  const res = await fetch(EBAY_ENV_CONFIG[environment].oauthTokenUrl, {
    method: "POST",
    headers: {
      "Content-Type": "application/x-www-form-urlencoded",
      Authorization: `Basic ${btoa(`${clientId}:${clientSecret}`)}`,
    },
    body: new URLSearchParams({
      grant_type: "refresh_token",
      refresh_token: refreshToken,
    }),
  });

  if (!res.ok) {
    const text = await res.text();
    throw new Error(`OAuth token refresh failed in ${environment} (${res.status}): ${text}`);
  }

  const data = await res.json();
  return data.access_token;
}

async function getAccessToken(): Promise<EbayAuthContext> {
  const environments = getEnvironmentOrder();
  const errors: string[] = [];

  for (const environment of environments) {
    try {
      const accessToken = await requestAccessToken(environment);
      return {
        accessToken,
        apiBaseUrl: EBAY_ENV_CONFIG[environment].apiBaseUrl,
        environment,
      };
    } catch (error) {
      errors.push(error instanceof Error ? error.message : String(error));
    }
  }

  throw new Error(
    `OAuth token refresh failed for all configured eBay environments. ${errors.join(" | ")}`
  );
}

/* ───────────────── Upload image to eBay EPS ─────────────────── */

async function uploadImageToEPS(
  imageUrl: string,
  accessToken: string,
  apiBaseUrl: string
): Promise<string> {
  // Download image bytes
  const imgRes = await fetch(imageUrl);
  if (!imgRes.ok) throw new Error(`Failed to download image: ${imageUrl}`);
  const imgBytes = await imgRes.arrayBuffer();
  const contentType = imgRes.headers.get("content-type") || "image/jpeg";

  // Upload to eBay
  const epsRes = await fetch(
    `${apiBaseUrl}/commerce/media/v1_beta/image`,
    {
      method: "POST",
      headers: {
        Authorization: `Bearer ${accessToken}`,
        "Content-Type": contentType,
      },
      body: imgBytes,
    }
  );

  if (!epsRes.ok) {
    const errText = await epsRes.text();
    console.error("EPS upload error:", errText);
    // Fall back to original URL if EPS fails
    return imageUrl;
  }

  const epsData = await epsRes.json();
  return epsData.imageUrl || imageUrl;
}

/* ───────────── Ensure merchant location exists ───────────── */

async function ensureLocation(accessToken: string, apiBaseUrl: string): Promise<void> {
  const locationKey = "HIGHLANDS_RANCH";
  // Try to create; if it already exists eBay returns 409 which we ignore
  const res = await fetch(
    `${apiBaseUrl}/sell/inventory/v1/location/${locationKey}`,
    {
      method: "PUT",
      headers: {
        Authorization: `Bearer ${accessToken}`,
        "Content-Type": "application/json",
      },
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
        name: "Highlands Ranch",
        merchantLocationStatus: "ENABLED",
      }),
    }
  );
  // 204 = created, 409 = already exists — both are fine
  if (!res.ok && res.status !== 409 && res.status !== 204) {
    const errText = await res.text();
    console.warn(`Location creation returned ${res.status}: ${errText}`);
  }
  // Consume body to prevent leak
  if (res.status !== 204) {
    try { await res.text(); } catch {}
  }
}

/* ──────────── eBay condition enum mapping ──────────── */

function mapCondition(condition: string | null): string {
  const map: Record<string, string> = {
    "New": "NEW",
    "New with tags": "NEW",
    "New other": "NEW_OTHER",
    "New without tags": "NEW_OTHER",
    "Open box": "NEW_OTHER",
    "Certified refurbished": "CERTIFIED_REFURBISHED",
    "Seller refurbished": "SELLER_REFURBISHED",
    "Used": "USED_EXCELLENT",
    "Pre-owned": "USED_EXCELLENT",
    "Pre-owned - Excellent": "USED_EXCELLENT",
    "Pre-owned - Good": "USED_GOOD",
    "Pre-owned - Fair": "USED_ACCEPTABLE",
    "For parts": "FOR_PARTS_OR_NOT_WORKING",
    "For parts or not working": "FOR_PARTS_OR_NOT_WORKING",
  };
  return map[condition || ""] || "USED_EXCELLENT";
}

/* ──────────── Build offer body for createOffer ──────────── */

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
  package_weight_lbs: number | null;
  package_weight_oz: number | null;
  package_length: number | null;
  package_width: number | null;
  package_height: number | null;
}

async function publishRow(
  row: EbayRow,
  accessToken: string,
  location: string,
  apiBaseUrl: string
): Promise<{ success: boolean; error?: string; listingId?: string }> {
  try {
    // 1. Upload images to EPS
    const epsImageUrls: string[] = [];
    if (row.image_urls && row.image_urls.length > 0) {
      for (const url of row.image_urls.slice(0, 24)) {
        try {
          const epsUrl = await uploadImageToEPS(url, accessToken, apiBaseUrl);
          epsImageUrls.push(epsUrl);
        } catch (e) {
          console.warn(`EPS upload failed for ${url}, using original`, e);
          epsImageUrls.push(url);
        }
      }
    }

    // 2. Build product aspects (item specifics)
    const aspects: Record<string, string[]> = {};
    if (row.item_specifics) {
      for (const [key, value] of Object.entries(row.item_specifics)) {
        if (value) aspects[key] = [String(value)];
      }
    }
    if (row.brand && !aspects["Brand"]) aspects["Brand"] = [row.brand];

    // Extract numeric category ID
    const categoryId = row.category?.match(/\d{3,}/)?.[0] || "0";

    const sku = `LOT-${row.lot_number}`;

    // 3. Create inventory item
    // Ensure merchant location exists (create once, ignore if exists)
    await ensureLocation(accessToken, apiBaseUrl);

    const inventoryBody: Record<string, unknown> = {
      availability: {
        shipToLocationAvailability: { quantity: 1 },
      },
      condition: mapCondition(row.condition),
      product: {
        title: (row.title || "").substring(0, 80),
        description: row.description || "",
        aspects,
        imageUrls: epsImageUrls,
        ...(row.upc ? { upc: [row.upc] } : {}),
        ...(row.mpn ? { mpn: [row.mpn] } : {}),
      },
      ...(row.subtitle ? { subtitle: row.subtitle } : {}),
    };

    // Add package weight/dimensions if available
    const totalOz =
      (row.package_weight_lbs || 0) * 16 + (row.package_weight_oz || 0);
    if (totalOz > 0 || (row.package_length && row.package_width && row.package_height)) {
      inventoryBody.packageWeightAndSize = {
        ...(totalOz > 0
          ? { weight: { value: totalOz, unit: "OUNCE" } }
          : {}),
        ...(row.package_length && row.package_width && row.package_height
          ? {
              dimensions: {
                length: row.package_length,
                width: row.package_width,
                height: row.package_height,
                unit: "INCH",
              },
            }
          : {}),
      };
    }

    const invRes = await fetch(
      `${apiBaseUrl}/sell/inventory/v1/inventory_item/${encodeURIComponent(sku)}`,
      {
        method: "PUT",
        headers: {
          Authorization: `Bearer ${accessToken}`,
          "Content-Type": "application/json",
          "Content-Language": "en-US",
        },
        body: JSON.stringify(inventoryBody),
      }
    );

    if (!invRes.ok) {
      const errText = await invRes.text();
      // 204 is success for PUT
      if (invRes.status !== 204) {
        return { success: false, error: `Inventory item failed (${invRes.status}): ${errText}` };
      }
    }
    // Consume body to avoid leak
    if (invRes.status !== 204) await invRes.text();

    // 4. Create offer (draft)
    const offerBody: Record<string, unknown> = {
      sku,
      marketplaceId: "EBAY_US",
      format: "FIXED_PRICE",
      listingDescription: row.description || "",
      categoryId,
      pricingSummary: {
        price: {
          value: String(row.price || 0),
          currency: "USD",
        },
      },
      listingPolicies: {
        // These will use eBay business policies if set, otherwise inline
        shippingCostOverrides: row.shipping_type === "free"
          ? [{ shippingCost: { value: "0.00", currency: "USD" }, shippingServiceType: "DOMESTIC", priority: 1 }]
          : row.shipping_cost
            ? [{ shippingCost: { value: String(row.shipping_cost), currency: "USD" }, shippingServiceType: "DOMESTIC", priority: 1 }]
            : undefined,
      },
      merchantLocationKey: "HIGHLANDS_RANCH",
      availableQuantity: 1,
      ...(row.best_offer_enabled
        ? {
            extendedProducerResponsibility: undefined,
            bestOfferTerms: {
              bestOfferEnabled: true,
              ...(row.best_offer_auto_accept
                ? { autoAcceptPrice: { value: String(row.best_offer_auto_accept), currency: "USD" } }
                : {}),
              ...(row.minimum_best_offer
                ? { autoDeclinePrice: { value: String(row.minimum_best_offer), currency: "USD" } }
                : {}),
            },
          }
        : {}),
    };

    const offerRes = await fetch(
      `${apiBaseUrl}/sell/inventory/v1/offer`,
      {
        method: "POST",
        headers: {
          Authorization: `Bearer ${accessToken}`,
          "Content-Type": "application/json",
          "Content-Language": "en-US",
        },
        body: JSON.stringify(offerBody),
      }
    );

    const offerText = await offerRes.text();
    if (!offerRes.ok) {
      return { success: false, error: `Create offer failed (${offerRes.status}): ${offerText}` };
    }

    const offerData = JSON.parse(offerText);
    return { success: true, listingId: offerData.offerId };
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
    // Auth
    const authHeader = req.headers.get("Authorization");
    const supabase = createClient(
      Deno.env.get("SUPABASE_URL")!,
      Deno.env.get("SUPABASE_ANON_KEY")!,
      { global: { headers: { Authorization: authHeader || "" } } }
    );

    const body = await req.json();

    // Quick auth test mode (no user auth needed)
    if (body.test_auth_only) {
      const auth = await getAccessToken();
      return new Response(
        JSON.stringify({ success: true, environment: auth.environment }),
        { status: 200, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    const {
      data: { user },
    } = await supabase.auth.getUser();
    if (!user) {
      return new Response(JSON.stringify({ error: "Unauthorized" }), {
        status: 401,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const { rowIds, location } = body;
    if (!rowIds || !Array.isArray(rowIds) || rowIds.length === 0) {
      return new Response(
        JSON.stringify({ error: "rowIds array required" }),
        { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    // Fetch rows from DB
    const { data: rows, error: fetchErr } = await supabase
      .from("ebay_batch_rows")
      .select("*")
      .in("id", rowIds);

    if (fetchErr || !rows) {
      return new Response(
        JSON.stringify({ error: fetchErr?.message || "No rows found" }),
        { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    // Get eBay access token
    const { accessToken, apiBaseUrl, environment } = await getAccessToken();
    console.log(`Publishing with eBay ${environment} environment`);

    // Process each row
    const results = [];
    for (const row of rows) {
      const result = await publishRow(row as unknown as EbayRow, accessToken, location || "", apiBaseUrl);
      results.push({ id: row.id, lot_number: row.lot_number, ...result });

      // Update status in DB
      if (result.success) {
        await supabase
          .from("ebay_batch_rows")
          .update({ status: "published" })
          .eq("id", row.id);
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
