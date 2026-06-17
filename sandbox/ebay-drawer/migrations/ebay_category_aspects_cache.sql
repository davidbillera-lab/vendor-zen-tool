-- sandbox/ebay-drawer/migrations/ebay_category_aspects_cache.sql
--
-- STAGED ONLY — not applied. Run via Supabase CLI or dashboard on staging first.
-- Apply to production only after Phase 1 verification passes.
--
-- Creates the read-through cache table for eBay category aspect metadata.
-- Aspects are global reference data (not per-tenant), so no RLS is needed.
-- The table is written only by the service-role edge function.

-- ---------------------------------------------------------------------------
-- Table
-- ---------------------------------------------------------------------------

CREATE TABLE IF NOT EXISTS public.ebay_category_aspects_cache (
  category_id    TEXT        NOT NULL,
  marketplace_id TEXT        NOT NULL DEFAULT 'EBAY_US',
  aspects        JSONB       NOT NULL DEFAULT '[]'::jsonb,
  fetched_at     TIMESTAMPTZ NOT NULL DEFAULT now(),

  PRIMARY KEY (category_id, marketplace_id)
);

COMMENT ON TABLE public.ebay_category_aspects_cache IS
  'Read-through cache for eBay Taxonomy API aspect metadata. '
  'Written only by the ebay-category-aspects edge function (service role). '
  'TTL enforced in application layer (~7 days). '
  'Global reference data — no per-tenant scoping required.';

COMMENT ON COLUMN public.ebay_category_aspects_cache.category_id IS
  'eBay leaf category numeric ID as text (e.g. "66426").';

COMMENT ON COLUMN public.ebay_category_aspects_cache.marketplace_id IS
  'eBay marketplace (e.g. EBAY_US). Supports future non-US tenants.';

COMMENT ON COLUMN public.ebay_category_aspects_cache.aspects IS
  'JSON array of AspectMeta: [{name, required, mode, allowedValues}]. '
  'Populated from commerce/taxonomy/v1/.../get_aspects_for_category response.';

-- ---------------------------------------------------------------------------
-- Indexes
-- ---------------------------------------------------------------------------

-- NOTE: no separate idx on category_id — already covered by the leading column
-- of the composite PK (category_id, marketplace_id). Adding it would be redundant.

-- Staleness sweeps (identify expired cache rows for TTL housekeeping)
CREATE INDEX IF NOT EXISTS idx_ebay_category_aspects_cache_fetched_at
  ON public.ebay_category_aspects_cache (fetched_at);

-- ---------------------------------------------------------------------------
-- Row-Level Security
-- ---------------------------------------------------------------------------

-- No RLS required: category aspect data is public eBay reference data.
-- Clients cannot write to this table (no INSERT/UPDATE policy granted).
-- Reads are allowed to authenticated clients so the drawer can inspect cached data
-- directly if needed; the edge function is the authoritative write path.

ALTER TABLE public.ebay_category_aspects_cache ENABLE ROW LEVEL SECURITY;

-- Allow authenticated users to SELECT (read-only)
CREATE POLICY "allow_authenticated_read"
  ON public.ebay_category_aspects_cache
  FOR SELECT
  TO authenticated
  USING (true);

-- No INSERT/UPDATE/DELETE policies for clients — service role only.
-- The edge function uses SUPABASE_SERVICE_ROLE_KEY which bypasses RLS.

-- ---------------------------------------------------------------------------
-- model_costs table note
-- ---------------------------------------------------------------------------
-- The ebay-category-aspects edge function inserts rows into model_costs with
-- provider='ebay', model='taxonomy-api', operation='get_aspects_for_category'.
-- If model_costs does not yet have a flexible enough schema to accept
-- provider != 'anthropic', add the column or relax the check constraint.
-- See decisions.md for the model_costs schema decision log.
