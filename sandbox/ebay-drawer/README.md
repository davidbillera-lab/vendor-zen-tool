# eBay Listing Detail Drawer — Sandbox Artifact

**Status:** Sandbox only. Not bundled, not deployed, not type-checked.
**Phase:** Phase 1/2 ready. Awaiting David's sign-off on Phase 1 (edge fn + cache) before wiring into `src/`.
**Spec:** `sandbox/specs/ebay-detail-drawer-spec.md`
**Visual target:** `option-b-mockup.html` (open in browser)

---

## What's in this folder

| File | Purpose |
|---|---|
| `EbayListingDrawer.tsx` | Drawer component (Phase 2). Move to `src/components/ebay/`. |
| `ebayCategoryAspects.ts` | Client helper + types (Phase 2). Move to `src/components/ebay/`. |
| `functions/ebay-category-aspects/index.ts` | Edge function (Phase 1). Move to `supabase/functions/ebay-category-aspects/`. |
| `migrations/ebay_category_aspects_cache.sql` | Cache table migration (Phase 1). Apply to staging Supabase first. |

---

## How to incorporate (engineer runbook)

### Phase 1 — Edge function + cache table

1. **Apply migration to staging Supabase:**
   ```bash
   supabase db push --db-url <STAGING_DB_URL> < sandbox/ebay-drawer/migrations/ebay_category_aspects_cache.sql
   ```
   Verify the `ebay_category_aspects_cache` table exists with `category_id` PK, `aspects jsonb`, `fetched_at`.

2. **Deploy edge function to staging:**
   ```bash
   cp -r sandbox/ebay-drawer/functions/ebay-category-aspects supabase/functions/
   supabase functions deploy ebay-category-aspects --project-ref <STAGING_REF>
   ```

3. **Verify cache read-through:**
   ```bash
   # First call — should hit eBay and write cache row
   curl -X POST https://<STAGING_URL>/functions/v1/ebay-category-aspects \
     -H "Authorization: Bearer <ANON_KEY>" \
     -H "Content-Type: application/json" \
     -d '{"categoryId":"66426"}'

   # Second call — should return fromCache: true
   curl -X POST https://<STAGING_URL>/functions/v1/ebay-category-aspects \
     -H "Authorization: Bearer <ANON_KEY>" \
     -H "Content-Type: application/json" \
     -d '{"categoryId":"66426"}'
   ```
   Assert: first response has `"fromCache":false`, second has `"fromCache":true`.
   Also confirm a row in `ebay_category_aspects_cache` and a row in `model_costs` with `provider='ebay'`.

4. **Cross-check required names:** Compare `required: true` names in the response against what
   `getRequiredAspectsForCategory("66426")` returns in `ebay-publish/index.ts` — they must be a superset.

5. **Codex second-opinion** on the edge function before promoting to production (Tier-1 rule).

6. **Apply migration to production** after staging verification passes:
   ```bash
   supabase db push --db-url <PROD_DB_URL> < sandbox/ebay-drawer/migrations/ebay_category_aspects_cache.sql
   supabase functions deploy ebay-category-aspects --project-ref <PROD_REF>
   ```

### Phase 2 — Drawer component

1. **Move client files into src:**
   ```bash
   cp sandbox/ebay-drawer/EbayListingDrawer.tsx src/components/ebay/
   cp sandbox/ebay-drawer/ebayCategoryAspects.ts src/components/ebay/
   ```
   No path changes needed — all imports already use `@/` aliases.

2. **Enable feature flag in `.env.local`:**
   ```
   VITE_FEATURE_EBAY_DRAWER=true
   ```
   Default is `false` (drawer renders null). Enable per-tenant via this flag or a tenant feature row.

3. **Wire into EbayBatchPanel.tsx** (additive — no existing handler changes):
   ```tsx
   import { EbayListingDrawer } from "@/components/ebay/EbayListingDrawer";

   // Inside EbayBatchPanel component state:
   const [drawerRow, setDrawerRow] = useState<DrawerEbayRow | null>(null);
   const [drawerOpen, setDrawerOpen] = useState(false);

   // In the row onClick / eye-icon handler:
   function openDrawer(row: EbayRow) {
     setDrawerRow(row);
     setDrawerOpen(true);
   }

   // In the JSX return:
   <EbayListingDrawer
     row={drawerRow}
     open={drawerOpen}
     onOpenChange={setDrawerOpen}
     onSaveSpecifics={async (rowId, specifics) => {
       // call your existing Supabase update for ebay_batch_rows.item_specifics
       await supabase
         .from("ebay_batch_rows")
         .update({ item_specifics: specifics })
         .eq("id", rowId);
     }}
     onPublish={async (rowId) => {
       // call your existing publish flow
       await handlePublishRow(rowId);
     }}
   />
   ```

4. **Vitest tests:**
   Write tests in `src/components/ebay/__tests__/EbayListingDrawer.test.tsx` covering:
   - Row with missing required aspect → Publish button disabled, red banner shows count
   - Fill all required → Publish button enabled, green banner
   - Live/published row → all fields read-only, "View live listing" link shown
   - No category on row → falls back to free-text fields for existing item_specifics

5. **Run build and existing tests:**
   ```bash
   npm run build    # must be clean
   npx vitest       # existing test suite must stay green
   ```

6. **Codex second-opinion** on drawer component before merging (Tier-1 rule).

---

## Image editing

The drawer reuses `src/components/ImageEditor.tsx` AS-IS via the `PhotoStrip` sub-component.

Clicking a photo thumbnail opens `ImageEditor` as a full-screen Dialog overlay (it renders its own Dialog when mounted — it is not embedded inline). On save, the drawer's local `workingImages` state is updated. The parent must persist updated images separately if needed (the drawer's `onSaveSpecifics` only persists `item_specifics`).

**Do not** add new crop/rotate/enhance logic to the drawer. All image editing happens inside `ImageEditor`.

---

## Key design decisions

**Data-mirror, not UI-clone:** The drawer shows eBay's required-specifics *data* in native VZT styling. It does not clone eBay's listing page layout. See `sandbox/specs/ebay-detail-drawer-spec.md` §7.

**Additive only:** `EbayBatchPanel.tsx`, `ebay-publish/index.ts`, and all publish paths are untouched. The drawer is a new surface that front-loads the same validation already run at publish time.

**No lesson injection in directive mode:** If this drawer ever surfaces a refine/directive AI call (e.g. "fix the title"), do NOT inject Hermes Loop lessons. Lesson injection is for generative/evaluative calls only. See `CLAUDE.md` Hermes Loop section.

**Feature flag:** `VITE_FEATURE_EBAY_DRAWER=true` gates the drawer. Default is off. Per multi-tenant plan: enable per-tenant, not globally.

---

## model_costs note

The edge function inserts into `model_costs` with `provider='ebay'`, `model='taxonomy-api'`, `cost_usd=0`. If `model_costs` has a check constraint on `provider` allowing only `'anthropic'`, relax it before deploying. Check `decisions.md` for the model_costs schema history.
