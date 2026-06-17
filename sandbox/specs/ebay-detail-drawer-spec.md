# Build Spec — eBay Listing Detail Drawer (item-specifics editor)

> **Status:** SPEC ONLY. Not wired into production. Lives in `/sandbox` so Vite never
> bundles it (nothing in `src/` imports this folder). Build is gated behind David's
> explicit go — see "Rollout gate" at the bottom.
>
> **Author context:** Claude Code (Opus 4.8), 2026-06-13. Companion visual:
> `/option-b-mockup.html` at repo root (open in a browser to see the target UX).

---

## 1. Goal (operator terms)

When you click a staged eBay listing (or its eye icon) in the eBay Batch panel, a
side drawer opens showing that item's photos, core fields, and — the point of the
whole thing — **the exact item specifics eBay requires for that item's category**,
with anything missing flagged in red. You fill the gaps *before* you push instead of
finding out eBay rejected the listing afterward.

**Why it matters:** fewer rejected pushes = less rework per item = more listings/hour.
At single-tenant that's a JSG efficiency win. At multi-tenant it's a feature every
auction-house tenant benefits from, because the data is pulled live per category — it
isn't hardcoded to JSG's inventory.

**What it is NOT:** it is not a pixel-clone of eBay's listing page. We mirror eBay's
required-specifics *data*, rendered as a native VZT form. Cloning eBay's visual chrome
would be cosmetic, fragile (their UI changes), and adds no validation value. (See
§7 "Decision: data-mirror, not UI-clone" — this is the one open recommendation needing
David's nod.)

---

## 2. What already exists (do NOT rebuild)

| Thing | Where | Note |
|---|---|---|
| eBay Batch panel (rows, status badges, toolbar, publish buttons) | `src/components/ebay/EbayBatchPanel.tsx` | The drawer attaches here. Row statuses today: `pending` / `published` / `draft` / `error` / `archived`. |
| Category required-aspect fetch | `supabase/functions/ebay-publish/index.ts` → `getRequiredAspectsForCategory()` (~line 433) | **Already calls eBay's `get_aspects_for_category`** and gets the *full* aspect metadata back. Today it throws away everything except required aspect *names* (lines ~457-459). |
| Pre-publish QA agent | `ebay-publish/index.ts` → `runPrePublishQA()` (~line 467, Haiku 4.5) | Validates category + required specifics on both draft and live paths before commit. The drawer moves this check *earlier* (into the editor) but does not replace it. |
| eBay aspects endpoint | `https://api.ebay.com/commerce/taxonomy/v1/category_tree/0/get_aspects_for_category?category_id=…` | Returns `aspects[]` with `localizedAspectName`, `aspectConstraint.aspectRequired`, `aspectConstraint.aspectUsage` (REQUIRED/RECOMMENDED), `aspectMode` (FREE_TEXT / SELECTION_ONLY), and `aspectValues[]` (allowed values for SELECTION_ONLY). |
| shadcn `Sheet` (slide-over) | `src/components/ui/sheet.tsx` (verify present) | Use this for the drawer shell — don't hand-roll. |

**The core insight that makes this low-risk:** we are not adding a new eBay
integration. The exact API call we need is *already being made* on every publish.
We just stop discarding the rest of its response.

---

## 3. The change, in pieces

### Piece A — A read-only edge endpoint for aspect metadata
`ebay-publish/getRequiredAspectsForCategory` currently returns `string[]` (names only).
Add a sibling function (do **not** change the existing one — the publish path depends
on its exact return shape) that returns the full shape the drawer needs:

```ts
// NEW — additive, in ebay-publish/index.ts or a new ebay-category-aspects function
type AspectMeta = {
  name: string;            // localizedAspectName
  required: boolean;       // aspectRequired === true || aspectUsage === "REQUIRED"
  mode: "SELECTION_ONLY" | "FREE_TEXT";   // aspectConstraint.aspectMode
  allowedValues: string[]; // aspectValues[].localizedValue (empty for FREE_TEXT)
};
// GET ?category_id=… → { categoryId, aspects: AspectMeta[] }
```

Prefer a **new** edge function `ebay-category-aspects` (cleaner isolation, never
touches the publish handler) OR a new exported route inside `ebay-publish`. Either
way: read-only, no DB writes, no publish side effects.

**Cost-log rule:** this calls eBay (token + taxonomy). Per standing rules, log the
call to `model_costs` (even though it's not an LLM call — keep the audit trail; mark
provider `ebay`, op `get_aspects_for_category`). The existing publish path's identical
call is also currently unlogged — note that gap but fix it in a separate commit.

### Piece B — Per-category caching (multi-tenant ready)
Aspect metadata for a category is identical across tenants and changes rarely.
Cache it so we don't hammer eBay's taxonomy API once many tenants are live.

- New table `ebay_category_aspects_cache`: `category_id text PK`, `aspects jsonb`,
  `fetched_at timestamptz`. TTL ~7 days (config constant). Marketplace-scoped if/when
  we add non-US tenants (`marketplace_id` column, default `EBAY_US`).
- Read-through: drawer asks edge fn → edge fn checks cache → on miss, fetch eBay,
  write cache, return. No RLS tenant-scoping needed (category aspects are global
  reference data, not tenant data) — but the table is read-only to clients; only the
  service-role edge fn writes it.

### Piece C — The drawer component (`EbayListingDrawer.tsx`)
New file `src/components/ebay/EbayListingDrawer.tsx`. Props: the row + `open`/`onOpenChange`.
On open, fetch aspect metadata for the row's `categoryId` (Piece A), merge with the
row's existing item-specifics values, render:

1. **Header** — title, SKU, close.
2. **Core block** — photo strip (existing image URLs), title, price, condition,
   category (read-only display of the resolved category path + id).
3. **Item Specifics (hero):**
   - **Required group** first. Each aspect: label with `*`; control is a `Select`
     when `mode === "SELECTION_ONLY"` (options = `allowedValues`), else an `Input`
     (FREE_TEXT). Empty + required → red border + "Required by eBay". Filled → green.
   - **Recommended group** below, same controls, not blocking.
   - Live validation banner: count of required-but-empty; when > 0, the drawer's
     Publish button is **disabled** with helper text.
4. **Footer** — "Save & close" (persists edited specifics back to the row/draft) and
   "Publish to eBay" (calls existing `publishOffer` path; disabled while required
   missing). For `live` rows the drawer is read-only ("View live listing").

Wire-up in `EbayBatchPanel.tsx`: row `onClick` and the eye-icon button set
`selectedRowId` + open state. **Purely additive** — no existing handler changes.

### Piece D — Persist edited specifics
Edited item-specifics values save back to wherever the row's specifics already live
(confirm the column/shape on the listings/drafts row before building — likely a
`jsonb` item_specifics field). Save is a normal update to the row the operator owns;
no schema change beyond Piece B's cache table.

---

## 4. Risk isolation (why this is safe for a Tier-1 protected app)

- **Additive only.** New component, new edge fn/route, new cache table. The existing
  `getRequiredAspectsForCategory`, `runPrePublishQA`, and both publish paths are
  untouched — same signatures, same behavior.
- **Read-mostly.** Piece A/B are reads + a reference-cache write. The only
  operator-data write is Piece D (saving specifics the operator explicitly edited),
  which is the same kind of write the panel already does.
- **No change to publish semantics.** Publish still goes through the existing
  `publishOffer` + `runPrePublishQA`. The drawer just front-loads the same validation
  so fewer pushes reach eBay incomplete.
- **Feature-flag it.** Gate the drawer behind a flag (e.g. `VITE_FEATURE_EBAY_DRAWER`
  or a tenant feature row) so it ships dark and is enabled per-tenant. Aligns with the
  multi-tenant "feature flags + manual deploy approval gate" requirement in CLAUDE.md.
- **Codex second-opinion before merge** (Tier-1 protection rule #1). Codex is
  observe-and-report only; Claude makes any fixes.

---

## 5. Verification

| Piece | How to verify |
|---|---|
| A — aspect endpoint | Call with a known category id (e.g. Pyrex `66426`); assert returns required+recommended names, modes, and allowed values. Compare required names to what `getRequiredAspectsForCategory` returns today — must be a superset. |
| B — cache | First call writes cache row + hits eBay; second call within TTL returns from cache (no eBay call — assert via logs). |
| C — drawer | Vitest + Testing Library: render with a row missing a required aspect → Publish disabled, red banner shows correct count; fill it → Publish enabled. Render a `live` row → read-only. |
| D — persist | Edit a specific, Save, reopen → value persists on the row. |
| Pipeline | Existing listing-generation + image-processing tests still green (Tier-1 rule #3). `npm run build` clean. |

---

## 6. Phased rollout

1. **Phase 0 (now):** spec + mockup. No code in `src/`. ← *we are here*
2. **Phase 1:** Piece A endpoint + Piece B cache, behind no UI. Verify against live
   eBay categories on **staging Supabase** (Tier-1 rule #2), cost-logged.
3. **Phase 2:** Piece C drawer + Piece D persist, behind `VITE_FEATURE_EBAY_DRAWER`
   off by default. Vitest green, `npm run build` clean, Codex QC pass.
4. **Phase 3:** enable flag for JSG (single tenant), measure rejected-push rate
   before/after. If it drops, promote to default-on; carry into the multi-tenant
   feature-flag set.

---

## 7. Image editing — ImageEditor reuse

The drawer's photo strip reuses `src/components/ImageEditor.tsx` as-is. No new
crop / rotate / enhance logic is built inside the drawer.

### How it works

1. The drawer renders a `PhotoStrip` sub-component that displays up to 8 thumbnail
   buttons from the row's `image_urls`.
2. Clicking a thumbnail (only in non-live rows) mounts `<ImageEditor>` with
   `images={workingImages}` and `initialIndex={clickedIndex}`.
3. `ImageEditor` is itself a full-screen `Dialog` overlay — when mounted it opens
   immediately. It does **not** need to be wrapped in another dialog.
4. On `onSave(updatedImages)`, the drawer updates its local `workingImages` state.
   The parent must persist updated image URLs separately via its own Supabase update
   (the drawer's `onSaveSpecifics` only persists `item_specifics`).
5. On `onCancel`, the editor closes with no changes.

### ImageEditor prop contract (from `src/components/ImageEditor.tsx`)

```typescript
export interface ImageEditorProps {
  images: string[];          // array of image URLs
  initialIndex?: number;     // which photo opens first (default 0)
  onSave: (updatedImages: string[]) => void;  // receives full updated array
  onCancel: () => void;      // editor closes, no changes applied
}
```

### Do NOT

- Build new image crop / rotate / enhance logic in the drawer or any sandbox file.
- Call the `enhance-image` edge function directly from the drawer — that is
  `ImageEditor`'s responsibility.
- Modify `ImageEditor.tsx` for the drawer's needs.

---

## 8. Decision needed: data-mirror, not UI-clone

David asked whether the detail view should "mimic the eBay listing page." My
recommendation, for his confirmation: **no — mirror eBay's required-specifics *data*,
not its page layout.** Rationale: the value is in catching missing required fields
(which is pure data eBay hands us), not in looking like eBay. A visual clone is
cosmetic, breaks when eBay restyles, and adds maintenance with zero validation
benefit. A native VZT form that's *driven by* eBay's category data gives every
rejection-prevention benefit and stays on-brand. If David wants the eBay look-and-feel
for operator familiarity, we can echo their grouping/labels — but I'd keep VZT styling.

**Rollout gate:** do not start Phase 1 until David (a) confirms the data-mirror
direction and (b) explicitly green-lights the build. Per davids-way: plan →
approval → build, one commit per piece.
