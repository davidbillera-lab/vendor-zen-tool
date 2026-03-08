-- Add doa_first_lot_url to la_batches so each auction's starting URL
-- can be stored per-batch instead of in the agent's .env file.
-- This allows multiple auctions to be managed without editing .env.
ALTER TABLE public.la_batches
  ADD COLUMN doa_first_lot_url text;

COMMENT ON COLUMN public.la_batches.doa_first_lot_url IS
  'The DOA EditAuction URL of the first lot for this batch, e.g. https://denveronlineauctions.com/sub-admin/EditAuction?id=1678303&PartyId=115. If set, the agent uses this instead of DOA_FIRST_LOT_URL in .env.';
