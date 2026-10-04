// eBay's get_category_suggestions ranks on title words alone, so WWII model titles
// land in Militaria shirts and patches (2026-10-01: an M21 half-track diorama ->
// "Casual Button-Down Shirts"). The model's category NAME is usually sensible even
// when its numeric ID is invented (same lot: ID 31787 = "Eyeliner"). Pick the eBay
// suggestion whose name/path best overlaps the model's category name. Ties and
// zero overlap keep eBay's order, i.e. the previous behaviour.

export interface CategorySuggestion {
  category: { categoryId: string; categoryName: string };
  categoryTreeNodeAncestors?: { categoryName: string }[];
}

const STOP = new Set(["and", "other", "the", "for", "with", "all", "more", "accessories"]);

const words = (s: string) => {
  const out = new Set<string>();
  for (const raw of s.toLowerCase().split(/[^a-z0-9-]+/)) {
    // Keep the joined form AND the parts: "die-cast" must match "diecast", and
    // "button-down" must match "button down".
    for (const w of [raw.replace(/-/g, ""), ...raw.split("-")]) {
      if (w.length > 2 && !STOP.has(w)) out.add(w.length > 3 ? w.replace(/s$/, "") : w); // tanks == tank
    }
  }
  return out;
};

export function pickCategorySuggestion(
  modelCategoryName: string | null | undefined,
  suggestions: CategorySuggestion[],
): CategorySuggestion | undefined {
  if (suggestions.length === 0) return undefined;
  const want = words(modelCategoryName ?? "");
  let best = suggestions[0];
  let bestScore = 0;
  for (const s of suggestions) {
    const leaf = words(s.category.categoryName);
    const path = words(
      [s.category.categoryName, ...(s.categoryTreeNodeAncestors ?? []).map((a) => a.categoryName)].join(" "),
    );
    // A hit on the leaf name says what the item IS, so it counts double.
    let score = 0;
    for (const w of want) score += leaf.has(w) ? 2 : path.has(w) ? 1 : 0;
    if (score > bestScore) {
      best = s;
      bestScore = score;
    }
  }
  return best;
}
