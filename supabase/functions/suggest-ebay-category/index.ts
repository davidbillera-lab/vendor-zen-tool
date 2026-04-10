/**
 * suggest-ebay-category
 *
 * Returns eBay leaf category suggestions for a given search query (item title).
 * Two sources, tried in order:
 *   1. eBay Taxonomy API Category Suggestions endpoint (live, most accurate)
 *   2. Local `ebay_categories` table full-text search (fallback if API fails)
 *
 * Request body: { q: string, limit?: number }
 * Response: { suggestions: [{ categoryId, name, path, source }] }
 *
 * Used by:
 *   - generate-listing (auto-validates AI-assigned category)
 *   - EbayBatchPanel "Suggest Category" button
 */

import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers":
    "authorization, x-client-info, apikey, content-type",
};

const EBAY_TOKEN_URL = "https://api.ebay.com/identity/v1/oauth2/token";
const EBAY_TAXONOMY_BASE = "https://api.ebay.com/commerce/taxonomy/v1";
const US_CATEGORY_TREE_ID = "0";

/* ─── eBay app token ─── */

let cachedToken: { token: string; expiresAt: number } | null = null;

async function getAppToken(): Promise<string> {
  // Reuse cached token if still valid (tokens last 2 hours)
  if (cachedToken && Date.now() < cachedToken.expiresAt) {
    return cachedToken.token;
  }

  const clientId = (Deno.env.get("EBAY_CLIENT_ID") ?? "").trim();
  const clientSecret = (Deno.env.get("EBAY_CLIENT_SECRET") ?? "").trim();
  if (!clientId || !clientSecret)
    throw new Error("EBAY_CLIENT_ID and EBAY_CLIENT_SECRET must be set");

  const res = await fetch(EBAY_TOKEN_URL, {
    method: "POST",
    headers: {
      "Content-Type": "application/x-www-form-urlencoded",
      Authorization: `Basic ${btoa(`${clientId}:${clientSecret}`)}`,
    },
    body: new URLSearchParams({
      grant_type: "client_credentials",
      scope: "https://api.ebay.com/oauth/api_scope",
    }),
  });

  if (!res.ok) {
    const t = await res.text();
    throw new Error(`App token failed (${res.status}): ${t}`);
  }
  const data = await res.json();
  cachedToken = {
    token: data.access_token,
    expiresAt: Date.now() + (data.expires_in - 60) * 1000, // 60s buffer
  };
  return cachedToken.token;
}

/* ─── eBay Category Suggestions API ─── */

interface CategorySuggestion {
  categoryId: string;
  name: string;
  path: string;
  source: "ebay_api" | "local_db";
}

async function fetchEbaySuggestions(
  q: string,
  limit: number
): Promise<CategorySuggestion[]> {
  const token = await getAppToken();
  const url =
    `${EBAY_TAXONOMY_BASE}/category_tree/${US_CATEGORY_TREE_ID}/get_category_suggestions` +
    `?q=${encodeURIComponent(q)}`;

  const res = await fetch(url, {
    headers: { Authorization: `Bearer ${token}` },
  });

  if (!res.ok) {
    const t = await res.text();
    throw new Error(`Category Suggestions API error (${res.status}): ${t}`);
  }

  const data = await res.json();
  const suggestions = (data.categorySuggestions ?? []) as Array<{
    category: { categoryId: string; categoryName: string };
    categoryTreeNodeAncestors?: Array<{ categoryName: string }>;
  }>;

  return suggestions.slice(0, limit).map((s) => {
    const ancestors = (s.categoryTreeNodeAncestors ?? [])
      .reverse()
      .map((a) => a.categoryName);
    const path = [...ancestors, s.category.categoryName].join(" > ");
    return {
      categoryId: s.category.categoryId,
      name: s.category.categoryName,
      path,
      source: "ebay_api" as const,
    };
  });
}

/* ─── Local DB fallback (FTS on ebay_categories table) ─── */

async function fetchLocalSuggestions(
  supabase: ReturnType<typeof createClient>,
  q: string,
  limit: number
): Promise<CategorySuggestion[]> {
  const { data, error } = await supabase.rpc("suggest_ebay_category", {
    query: q,
    result_limit: limit,
  });

  if (error || !data) return [];

  return (data as Array<{ id: string; name: string; path: string }>).map((r) => ({
    categoryId: r.id,
    name: r.name,
    path: r.path ?? r.name,
    source: "local_db" as const,
  }));
}

/* ─── Main handler ─── */

Deno.serve(async (req: Request) => {
  if (req.method === "OPTIONS") {
    return new Response(null, { headers: corsHeaders });
  }

  try {
    const body = await req.json();
    const q: string = (body.q ?? "").trim();
    const limit: number = Math.min(body.limit ?? 5, 20);

    if (!q) {
      return new Response(
        JSON.stringify({ error: "q (search query) is required" }),
        { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    const supabase = createClient(
      Deno.env.get("SUPABASE_URL")!,
      Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!
    );

    let suggestions: CategorySuggestion[] = [];
    let apiError: string | undefined;

    // Try eBay live API first
    try {
      suggestions = await fetchEbaySuggestions(q, limit);
      console.log(
        `[suggest-ebay-category] eBay API returned ${suggestions.length} suggestions for "${q}"`
      );
    } catch (e) {
      apiError = e instanceof Error ? e.message : String(e);
      console.warn(`[suggest-ebay-category] eBay API failed, falling back to local DB: ${apiError}`);
    }

    // Fall back to local DB if API failed or returned nothing
    if (suggestions.length === 0) {
      suggestions = await fetchLocalSuggestions(supabase, q, limit);
      console.log(
        `[suggest-ebay-category] Local DB returned ${suggestions.length} suggestions for "${q}"`
      );
    }

    // Cache any eBay API results into our local table for future offline use
    if (suggestions.length > 0 && suggestions[0].source === "ebay_api") {
      const rows = suggestions
        .filter((s) => s.categoryId && s.name)
        .map((s) => ({
          id: s.categoryId,
          name: s.name,
          path: s.path,
          is_leaf: true,
          synced_at: new Date().toISOString(),
        }));
      // Fire-and-forget — don't block the response
      supabase
        .from("ebay_categories")
        .upsert(rows, { onConflict: "id" })
        .then(({ error }) => {
          if (error)
            console.warn("[suggest-ebay-category] Cache upsert error:", error.message);
        });
    }

    return new Response(
      JSON.stringify({
        q,
        suggestions,
        source: suggestions[0]?.source ?? "none",
        api_error: apiError,
      }),
      { status: 200, headers: { ...corsHeaders, "Content-Type": "application/json" } }
    );
  } catch (e) {
    console.error("[suggest-ebay-category] Error:", e);
    return new Response(
      JSON.stringify({ error: e instanceof Error ? e.message : String(e) }),
      { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } }
    );
  }
});
