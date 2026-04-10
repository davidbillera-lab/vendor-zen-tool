/**
 * sync-ebay-categories
 *
 * Scrapes the complete eBay US category tree from the Taxonomy REST API
 * and upserts every category (leaf + parent) into the `ebay_categories` table.
 *
 * Called manually from the Lovable UI or via a cron trigger monthly.
 * Returns a summary: { total, leaves, elapsed_ms }
 *
 * Authentication: uses client_credentials app token — no user token required.
 * Required secrets: EBAY_CLIENT_ID, EBAY_CLIENT_SECRET
 */

import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import { Pool } from "https://deno.land/x/postgres@v0.17.0/mod.ts";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers":
    "authorization, x-client-info, apikey, content-type",
};

const EBAY_TOKEN_URL = "https://api.ebay.com/identity/v1/oauth2/token";
const EBAY_TAXONOMY_BASE = "https://api.ebay.com/commerce/taxonomy/v1";
const US_CATEGORY_TREE_ID = "0";
const UPSERT_BATCH = 500;

/* ─── eBay app token (client credentials — no user context needed) ─── */

async function getAppToken(): Promise<string> {
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
  return data.access_token as string;
}

/* ─── Flatten the nested category tree into a flat array ─── */

interface EbayTreeNode {
  category: { categoryId: string; categoryName: string };
  leafCategoryTreeNode?: boolean;
  childCategoryTreeNodes?: EbayTreeNode[];
}

interface FlatCategory {
  id: string;
  name: string;
  parent_id: string | null;
  path: string;
  level: number;
  is_leaf: boolean;
}

function flattenTree(
  node: EbayTreeNode,
  parentId: string | null,
  parentPath: string,
  level: number,
  out: FlatCategory[]
): void {
  const id = node.category.categoryId;
  const name = node.category.categoryName;
  const path = parentPath ? `${parentPath} > ${name}` : name;
  const children = node.childCategoryTreeNodes ?? [];
  const isLeaf = node.leafCategoryTreeNode === true || children.length === 0;

  out.push({ id, name, parent_id: parentId, path, level, is_leaf: isLeaf });

  for (const child of children) {
    flattenTree(child, id, path, level + 1, out);
  }
}

/* ─── Bootstrap the table if it doesn't exist yet ─── */

async function ensureSchema(dbUrl: string): Promise<void> {
  const pool = new Pool(dbUrl, 1, true);
  const conn = await pool.connect();
  try {
    await conn.queryObject(`
      CREATE TABLE IF NOT EXISTS ebay_categories (
        id         TEXT PRIMARY KEY,
        name       TEXT NOT NULL,
        parent_id  TEXT,
        path       TEXT,
        level      INTEGER,
        is_leaf    BOOLEAN NOT NULL DEFAULT FALSE,
        synced_at  TIMESTAMPTZ DEFAULT NOW()
      );
      CREATE INDEX IF NOT EXISTS idx_ebay_categories_leaf
        ON ebay_categories(is_leaf) WHERE is_leaf = TRUE;
      CREATE INDEX IF NOT EXISTS idx_ebay_categories_fts
        ON ebay_categories
        USING gin(to_tsvector('english', name || ' ' || COALESCE(path, '')));
      CREATE OR REPLACE FUNCTION suggest_ebay_category(query TEXT, result_limit INT DEFAULT 5)
      RETURNS TABLE (id TEXT, name TEXT, path TEXT, rank REAL) AS $$
      BEGIN
        RETURN QUERY
        SELECT c.id, c.name, c.path,
          ts_rank(to_tsvector('english', c.name || ' ' || COALESCE(c.path, '')),
                  plainto_tsquery('english', query)) AS rank
        FROM ebay_categories c
        WHERE c.is_leaf = TRUE
          AND to_tsvector('english', c.name || ' ' || COALESCE(c.path, ''))
              @@ plainto_tsquery('english', query)
        ORDER BY rank DESC
        LIMIT result_limit;
      END;
      $$ LANGUAGE plpgsql;
    `);
  } finally {
    conn.release();
    await pool.end();
  }
}

/* ─── Upsert in batches ─── */

async function batchUpsert(
  supabase: ReturnType<typeof createClient>,
  rows: FlatCategory[]
): Promise<{ upserted: number; errors: string[] }> {
  let upserted = 0;
  const errors: string[] = [];

  for (let i = 0; i < rows.length; i += UPSERT_BATCH) {
    const batch = rows.slice(i, i + UPSERT_BATCH).map((r) => ({
      ...r,
      synced_at: new Date().toISOString(),
    }));

    const { error } = await supabase
      .from("ebay_categories")
      .upsert(batch, { onConflict: "id" });

    if (error) {
      errors.push(`Batch ${Math.floor(i / UPSERT_BATCH) + 1}: ${error.message}`);
    } else {
      upserted += batch.length;
    }
  }

  return { upserted, errors };
}

/* ─── Main handler ─── */

Deno.serve(async (req: Request) => {
  if (req.method === "OPTIONS") {
    return new Response(null, { headers: corsHeaders });
  }

  const t0 = Date.now();

  try {
    const supabaseUrl = Deno.env.get("SUPABASE_URL")!;
    const serviceKey  = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
    const dbUrl       = Deno.env.get("SUPABASE_DB_URL")!;

    const supabase = createClient(supabaseUrl, serviceKey);

    // 0. Ensure table + indexes + FTS function exist (self-bootstrapping)
    console.log("[sync-ebay-categories] Ensuring schema...");
    await ensureSchema(dbUrl);

    // 1. Get eBay app token
    console.log("[sync-ebay-categories] Getting app token...");
    const token = await getAppToken();

    // 2. Fetch the full US category tree from Taxonomy REST API
    // This JSON is large (~10-20MB) but well within Deno's memory limits.
    console.log("[sync-ebay-categories] Fetching category tree...");
    const treeRes = await fetch(
      `${EBAY_TAXONOMY_BASE}/category_tree/${US_CATEGORY_TREE_ID}`,
      {
        headers: {
          Authorization: `Bearer ${token}`,
          "Content-Type": "application/json",
        },
      }
    );

    if (!treeRes.ok) {
      const t = await treeRes.text();
      throw new Error(`Taxonomy API error (${treeRes.status}): ${t}`);
    }

    const tree = await treeRes.json();
    const version = tree.categoryTreeVersion as string;
    const root = tree.rootCategoryNode as EbayTreeNode;

    // 3. Flatten the entire tree
    console.log("[sync-ebay-categories] Flattening tree...");
    const categories: FlatCategory[] = [];
    // Process each top-level child (skip the root "All Categories" node)
    for (const child of root.childCategoryTreeNodes ?? []) {
      flattenTree(child, null, "", 1, categories);
    }

    const leaves = categories.filter((c) => c.is_leaf).length;
    console.log(
      `[sync-ebay-categories] Found ${categories.length} categories (${leaves} leaves) — tree version ${version}`
    );

    // 4. Batch upsert
    console.log("[sync-ebay-categories] Upserting to Supabase...");
    const { upserted, errors } = await batchUpsert(supabase, categories);

    const elapsed = Date.now() - t0;
    console.log(
      `[sync-ebay-categories] Done — ${upserted} upserted in ${elapsed}ms`
    );

    return new Response(
      JSON.stringify({
        success: true,
        category_tree_version: version,
        total_categories: categories.length,
        leaf_categories: leaves,
        upserted,
        errors: errors.length > 0 ? errors : undefined,
        elapsed_ms: elapsed,
      }),
      { status: 200, headers: { ...corsHeaders, "Content-Type": "application/json" } }
    );
  } catch (e) {
    console.error("[sync-ebay-categories] Error:", e);
    return new Response(
      JSON.stringify({ success: false, error: e instanceof Error ? e.message : String(e) }),
      { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } }
    );
  }
});
