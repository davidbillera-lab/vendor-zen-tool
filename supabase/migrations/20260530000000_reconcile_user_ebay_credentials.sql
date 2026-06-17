-- Reconcile user_ebay_credentials with the schema the ebay-oauth function expects.
--
-- The original migration (20260529000000) used CREATE TABLE IF NOT EXISTS, but the
-- table already existed in production from an earlier manual version with a different
-- shape (id, user_id, client_id, client_secret, refresh_token, environment,
-- created_at, updated_at). That made the CREATE silently no-op, so production never
-- got the `connected_at` column the function writes (exchange_code) and reads
-- (get_status). Result: "Failed to save eBay credentials" + status stuck on "Not Connected".
--
-- This migration is additive and safe: it only ADDS the missing column and backfills
-- existing rows from their created_at. Nothing in the publish path reads connected_at
-- (ebay-publish reads only refresh_token), so JSG's existing connection is unaffected.

ALTER TABLE public.user_ebay_credentials
  ADD COLUMN IF NOT EXISTS connected_at TIMESTAMPTZ;

UPDATE public.user_ebay_credentials
  SET connected_at = COALESCE(connected_at, created_at, now())
  WHERE connected_at IS NULL;

ALTER TABLE public.user_ebay_credentials
  ALTER COLUMN connected_at SET DEFAULT now();

ALTER TABLE public.user_ebay_credentials
  ALTER COLUMN connected_at SET NOT NULL;
