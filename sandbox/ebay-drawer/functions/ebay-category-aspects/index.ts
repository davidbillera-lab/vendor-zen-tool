/**
 * sandbox/ebay-drawer/functions/ebay-category-aspects/index.ts
 *
 * STAGED ONLY — not deployed. Move to supabase/functions/ebay-category-aspects/
 * when Phase 1 is approved.
 *
 * Reads aspect metadata for a given eBay leaf category from the Taxonomy API,
 * caches the result in `ebay_category_aspects_cache`, and returns the full
 * AspectMeta[] shape the drawer needs.
 *
 * Pattern mirrors supabase/functions/ebay-publish/index.ts for OAuth, env var
 * access, and CORS handling.
 */

import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

// ---------------------------------------------------------------------------
// Types (must match ebayCategoryAspects.ts)
// ---------------------------------------------------------------------------

interface AspectMeta {
  name: string;
  required: boolean;
  mode: "SELECTION_ONLY" | "FREE_TEXT";
  allowedValues: string[];
}

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

const CACHE_TTL_DAYS = 7;
const FETCH_TIMEOUT_MS = 10_000;
const EBAY_TAXONOMY_URL =
  "https://api.ebay.com/commerce/taxonomy/v1/category_tree/0/get_aspects_for_category";

const CORS_HEADERS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

// ---------------------------------------------------------------------------
// Module-scope OAuth token memo (avoids re-fetching on every cache miss)
// ---------------------------------------------------------------------------

let tokenCache: { token: string; expiresAt: number } | null = null;

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function json(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...CORS_HEADERS, "Content-Type": "application/json" },
  });
}

/**
 * Fetch an eBay client-credentials OAuth token.
 * Uses tenant creds if supplied, falls back to env vars (JSG defaults).
 * Returns cached token until 60s before expiry to avoid per-request fetches.
 */
async function getEbayToken(
  clientId?: string,
  clientSecret?: string
): Promise<string | null> {
  if (tokenCache && Date.now() < tokenCache.expiresAt - 60_000) {
    return tokenCache.token;
  }

  const id = (clientId ?? Deno.env.get("EBAY_CLIENT_ID") ?? "").trim();
  const secret = (clientSecret ?? Deno.env.get("EBAY_CLIENT_SECRET") ?? "").trim();
  if (!id || !secret) return null;

  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), FETCH_TIMEOUT_MS);

  try {
    const res = await fetch("https://api.ebay.com/identity/v1/oauth2/token", {
      method: "POST",
      headers: {
        "Content-Type": "application/x-www-form-urlencoded",
        Authorization: `Basic ${btoa(`${id}:${secret}`)}`,
      },
      body: new URLSearchParams({
        grant_type: "client_credentials",
        scope: "https://api.ebay.com/oauth/api_scope",
      }),
      signal: ctrl.signal,
    });

    if (!res.ok) return null;
    const data = await res.json();
    const token: string | null = data.access_token ?? null;
    if (token) {
      const expiresIn = Number(data.expires_in ?? 7200);
      tokenCache = { token, expiresAt: Date.now() + expiresIn * 1000 };
    }
    return token;
  } catch {
    return null;
  } finally {
    clearTimeout(timer);
  }
}

/**
 * Call eBay Taxonomy API and transform to AspectMeta[].
 * Returns full aspect list (required + recommended + optional).
 * Throws on non-OK eBay response — caller must catch and return 502.
 */
async function fetchFromEbay(
  categoryId: string,
  accessToken: string
): Promise<AspectMeta[]> {
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), FETCH_TIMEOUT_MS);

  try {
    const res = await fetch(`${EBAY_TAXONOMY_URL}?category_id=${categoryId}`, {
      headers: { Authorization: `Bearer ${accessToken}` },
      signal: ctrl.signal,
    });

    if (!res.ok) {
      console.error(`[ebay-category-aspects] eBay API ${res.status} for category ${categoryId}`);
      throw new Error(`eBay API error: ${res.status}`);
    }

    const data = await res.json();
    const aspects: AspectMeta[] = [];

    for (const a of data.aspects ?? []) {
      const constraint = a.aspectConstraint ?? {};
      const required: boolean =
        constraint.aspectRequired === true || constraint.aspectUsage === "REQUIRED";
      const mode: "SELECTION_ONLY" | "FREE_TEXT" =
        constraint.aspectMode === "SELECTION_ONLY" ? "SELECTION_ONLY" : "FREE_TEXT";
      const allowedValues: string[] = mode === "SELECTION_ONLY"
        ? (a.aspectValues ?? [])
            .map((v: { localizedValue?: string }) => v.localizedValue)
            .filter((v: string | undefined): v is string => typeof v === "string" && v.length > 0)
        : [];

      aspects.push({
        name: String(a.localizedAspectName),
        required,
        mode,
        allowedValues,
      });
    }

    return aspects;
  } finally {
    clearTimeout(timer);
  }
}

// ---------------------------------------------------------------------------
// Cache read/write (using service-role client — only the edge fn writes)
// ---------------------------------------------------------------------------

function makeServiceClient() {
  const url = Deno.env.get("SUPABASE_URL");
  const key = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");
  if (!url || !key) throw new Error("Missing SUPABASE_URL or SUPABASE_SERVICE_ROLE_KEY");
  return createClient(url, key);
}

async function getCached(
  categoryId: string,
  marketplaceId: string
): Promise<{ aspects: AspectMeta[]; fetchedAt: string } | null> {
  const db = makeServiceClient();
  const { data, error } = await db
    .from("ebay_category_aspects_cache")
    .select("aspects, fetched_at")
    .eq("category_id", categoryId)
    .eq("marketplace_id", marketplaceId)
    .single();

  if (error || !data) return null;

  const fetchedAt = new Date(data.fetched_at);
  const ageMs = Date.now() - fetchedAt.getTime();
  const ttlMs = CACHE_TTL_DAYS * 24 * 60 * 60 * 1000;
  if (ageMs > ttlMs) return null; // stale

  return { aspects: data.aspects as AspectMeta[], fetchedAt: data.fetched_at };
}

async function writeCache(
  categoryId: string,
  marketplaceId: string,
  aspects: AspectMeta[]
): Promise<void> {
  const db = makeServiceClient();
  const { error } = await db.from("ebay_category_aspects_cache").upsert({
    category_id: categoryId,
    marketplace_id: marketplaceId,
    aspects,
    fetched_at: new Date().toISOString(),
  });
  if (error) console.error("[ebay-category-aspects] cache write error:", error.message);
}

// ---------------------------------------------------------------------------
// Cost logging (per standing rules — log even non-LLM API calls)
// ---------------------------------------------------------------------------

async function logCost(
  categoryId: string,
  fromCache: boolean,
  durationMs: number
): Promise<void> {
  try {
    const db = makeServiceClient();
    await db.from("model_costs").insert({
      provider: "ebay",
      model: "taxonomy-api",
      operation: "get_aspects_for_category",
      input_tokens: 0,
      output_tokens: 0,
      cost_usd: 0,
      metadata: { category_id: categoryId, from_cache: fromCache, duration_ms: durationMs },
    });
  } catch {
    // Non-fatal — don't let logging failure break the response
  }
}

// ---------------------------------------------------------------------------
// Main handler
// ---------------------------------------------------------------------------

serve(async (req: Request) => {
  if (req.method === "OPTIONS") {
    return new Response(null, { headers: CORS_HEADERS });
  }

  // JWT auth gate — reject anon and unauthenticated callers before any eBay call.
  // Anyone with the URL could otherwise burn eBay quota and proxy JSG credentials.
  const authHeader = req.headers.get("Authorization");
  const bearerToken = authHeader?.startsWith("Bearer ") ? authHeader.slice(7) : null;
  if (!bearerToken) {
    return json({ error: "Missing Authorization header" }, 401);
  }
  const supabaseUrl = Deno.env.get("SUPABASE_URL");
  const supabaseAnonKey = Deno.env.get("SUPABASE_ANON_KEY");
  if (!supabaseUrl || !supabaseAnonKey) {
    return json({ error: "Server configuration error" }, 500);
  }
  const userClient = createClient(supabaseUrl, supabaseAnonKey, {
    global: { headers: { Authorization: `Bearer ${bearerToken}` } },
  });
  const { data: { user }, error: authError } = await userClient.auth.getUser();
  if (authError || !user) {
    return json({ error: "Unauthorized" }, 401);
  }

  const t0 = Date.now();

  let categoryId: string;
  let marketplaceId: string;
  try {
    const body = await req.json();
    categoryId = String(body.categoryId ?? "").trim();
    marketplaceId = String(body.marketplaceId ?? "EBAY_US").trim();
  } catch {
    return json({ error: "Invalid JSON body" }, 400);
  }

  if (!categoryId || !/^\d{3,}$/.test(categoryId)) {
    return json({ error: "categoryId must be a numeric string of 3+ digits" }, 400);
  }

  // --- Cache read-through ---
  const cached = await getCached(categoryId, marketplaceId);
  if (cached) {
    await logCost(categoryId, true, Date.now() - t0);
    return json({
      categoryId,
      aspects: cached.aspects,
      fromCache: true,
      fetchedAt: cached.fetchedAt,
    });
  }

  // --- Cache miss: fetch from eBay ---
  const ebayToken = await getEbayToken();
  if (!ebayToken) {
    return json({ error: "Could not obtain eBay access token — check EBAY_CLIENT_ID/SECRET" }, 503);
  }

  let aspects: AspectMeta[];
  try {
    aspects = await fetchFromEbay(categoryId, ebayToken);
  } catch (err) {
    // Return 502 so the client knows eBay failed — not masked as "no required fields"
    const msg = err instanceof Error ? err.message : "eBay API error";
    await logCost(categoryId, false, Date.now() - t0);
    return json({ error: msg }, 502);
  }

  const fetchedAt = new Date().toISOString();

  if (aspects.length > 0) {
    await writeCache(categoryId, marketplaceId, aspects);
  }

  await logCost(categoryId, false, Date.now() - t0);

  return json({ categoryId, aspects, fromCache: false, fetchedAt });
});
