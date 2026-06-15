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

interface CacheRow {
  category_id: string;
  aspects: AspectMeta[];
  fetched_at: string;
}

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

const CACHE_TTL_DAYS = 7;
const EBAY_TAXONOMY_URL =
  "https://api.ebay.com/commerce/taxonomy/v1/category_tree/0/get_aspects_for_category";

const CORS_HEADERS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

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
 */
async function getEbayToken(
  clientId?: string,
  clientSecret?: string
): Promise<string | null> {
  const id = (clientId ?? Deno.env.get("EBAY_CLIENT_ID") ?? "").trim();
  const secret = (clientSecret ?? Deno.env.get("EBAY_CLIENT_SECRET") ?? "").trim();
  if (!id || !secret) return null;

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
  });

  if (!res.ok) return null;
  const data = await res.json();
  return data.access_token ?? null;
}

/**
 * Call eBay Taxonomy API and transform to AspectMeta[].
 * Returns full aspect list (required + recommended + optional).
 * Caller filters by `required` as needed.
 */
async function fetchFromEbay(
  categoryId: string,
  accessToken: string
): Promise<AspectMeta[]> {
  const res = await fetch(`${EBAY_TAXONOMY_URL}?category_id=${categoryId}`, {
    headers: { Authorization: `Bearer ${accessToken}` },
  });

  if (!res.ok) {
    console.error(`[ebay-category-aspects] eBay API ${res.status} for category ${categoryId}`);
    return [];
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
      ? (a.aspectValues ?? []).map((v: any) => String(v.localizedValue)).filter(Boolean)
      : [];

    aspects.push({
      name: String(a.localizedAspectName),
      required,
      mode,
      allowedValues,
    });
  }

  return aspects;
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
  categoryId: string
): Promise<{ aspects: AspectMeta[]; fetchedAt: string } | null> {
  const db = makeServiceClient();
  const { data, error } = await db
    .from("ebay_category_aspects_cache")
    .select("aspects, fetched_at")
    .eq("category_id", categoryId)
    .single();

  if (error || !data) return null;

  const fetchedAt = new Date(data.fetched_at);
  const ageMs = Date.now() - fetchedAt.getTime();
  const ttlMs = CACHE_TTL_DAYS * 24 * 60 * 60 * 1000;
  if (ageMs > ttlMs) return null; // stale

  return { aspects: data.aspects as AspectMeta[], fetchedAt: data.fetched_at };
}

async function writeCache(categoryId: string, aspects: AspectMeta[]): Promise<void> {
  const db = makeServiceClient();
  const { error } = await db.from("ebay_category_aspects_cache").upsert({
    category_id: categoryId,
    aspects,
    fetched_at: new Date().toISOString(),
    marketplace_id: "EBAY_US",
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

  const t0 = Date.now();

  let categoryId: string;
  try {
    const body = await req.json();
    categoryId = String(body.categoryId ?? "").trim();
  } catch {
    return json({ error: "Invalid JSON body" }, 400);
  }

  if (!categoryId || !/^\d{3,}$/.test(categoryId)) {
    return json({ error: "categoryId must be a numeric string of 3+ digits" }, 400);
  }

  // --- Cache read-through ---
  const cached = await getCached(categoryId);
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
  const token = await getEbayToken();
  if (!token) {
    return json({ error: "Could not obtain eBay access token — check EBAY_CLIENT_ID/SECRET" }, 503);
  }

  const aspects = await fetchFromEbay(categoryId, token);
  const fetchedAt = new Date().toISOString();

  if (aspects.length > 0) {
    await writeCache(categoryId, aspects);
  }

  await logCost(categoryId, false, Date.now() - t0);

  return json({ categoryId, aspects, fromCache: false, fetchedAt });
});
