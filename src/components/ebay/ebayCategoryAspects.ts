/**
 * sandbox/ebay-drawer/ebayCategoryAspects.ts
 *
 * Client-side helper for fetching eBay category aspect metadata.
 * Calls the staged `ebay-category-aspects` edge function (not deployed yet).
 *
 * Authored as if it lives at src/components/ebay/ — uses @/ aliases throughout.
 * Move to src/components/ebay/ when Phase 1 is approved.
 */

import { supabase } from "@/integrations/supabase/client";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export type AspectMode = "SELECTION_ONLY" | "FREE_TEXT";

export interface AspectMeta {
  /** localizedAspectName from eBay Taxonomy API */
  name: string;
  /** true when aspectRequired === true OR aspectUsage === "REQUIRED" */
  required: boolean;
  /** SELECTION_ONLY → dropdown with allowedValues; FREE_TEXT → text input */
  mode: AspectMode;
  /** Populated for SELECTION_ONLY aspects; empty array for FREE_TEXT */
  allowedValues: string[];
}

export interface CategoryAspectsResponse {
  categoryId: string;
  aspects: AspectMeta[];
  fromCache: boolean;
  fetchedAt: string; // ISO timestamp
}

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

/** Edge function name (not yet deployed — staged only) */
const EDGE_FN = "ebay-category-aspects";

/** Client-side in-memory cache keyed by categoryId to avoid duplicate fetches
 *  within a single session. The edge function also caches in Supabase (~7 days). */
const _memCache = new Map<string, { data: CategoryAspectsResponse; ts: number }>();
const MEM_TTL_MS = 5 * 60 * 1000; // 5 minutes

// ---------------------------------------------------------------------------
// Main fetch helper
// ---------------------------------------------------------------------------

/**
 * Fetch aspect metadata for an eBay leaf category.
 *
 * Usage:
 *   const { aspects } = await fetchCategoryAspects("66426");
 *   const required = aspects.filter(a => a.required);
 *
 * Returns null on network error or missing creds — caller should degrade
 * gracefully (show all current item_specifics as free-text fields).
 */
export async function fetchCategoryAspects(
  categoryId: string
): Promise<CategoryAspectsResponse | null> {
  if (!categoryId) return null;

  // Check in-memory cache first
  const cached = _memCache.get(categoryId);
  if (cached && Date.now() - cached.ts < MEM_TTL_MS) {
    return cached.data;
  }

  try {
    const { data, error } = await supabase.functions.invoke<CategoryAspectsResponse>(EDGE_FN, {
      body: { categoryId },
    });

    if (error) {
      console.error("[ebayCategoryAspects] edge fn error:", error.message);
      return null;
    }

    if (!data) return null;

    _memCache.set(categoryId, { data, ts: Date.now() });
    return data;
  } catch (err) {
    console.error("[ebayCategoryAspects] unexpected error:", err);
    return null;
  }
}

// ---------------------------------------------------------------------------
// Category ID extraction helper
// ---------------------------------------------------------------------------

/**
 * Extract numeric eBay category ID from an EbayRow.category string.
 * The column sometimes carries label text like "66426 - Kitchen Accessories".
 *
 * Returns empty string if no 3+-digit number is found.
 *
 * Example:
 *   extractCategoryId("66426 - Kitchen Accessories") // → "66426"
 *   extractCategoryId("66426")                        // → "66426"
 *   extractCategoryId(null)                           // → ""
 */
export function extractCategoryId(category: string | null | undefined): string {
  if (!category) return "";
  return category.match(/\d{3,}/)?.[0] ?? "";
}

// ---------------------------------------------------------------------------
// Merge helper
// ---------------------------------------------------------------------------

/**
 * Merge aspect metadata with the row's existing item_specifics values.
 * Returns an array of { aspect, currentValue } ready for the drawer to render.
 */
export function mergeAspectsWithSpecifics(
  aspects: AspectMeta[],
  itemSpecifics: Record<string, string>
): Array<{ aspect: AspectMeta; currentValue: string }> {
  return aspects.map((aspect) => ({
    aspect,
    currentValue: itemSpecifics[aspect.name] ?? "",
  }));
}
