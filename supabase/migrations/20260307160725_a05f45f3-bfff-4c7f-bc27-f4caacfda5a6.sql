-- Fix: Update platforms array for batches that have denver_batch_rows
UPDATE la_batches SET platforms = array_append(
  COALESCE(platforms, '{}'),
  'denver'
) WHERE id IN (
  SELECT DISTINCT batch_id FROM denver_batch_rows WHERE batch_id IS NOT NULL
) AND NOT ('denver' = ANY(COALESCE(platforms, '{}')));

-- Also fix batches with ebay rows
UPDATE la_batches SET platforms = array_append(
  COALESCE(platforms, '{}'),
  'ebay'
) WHERE id IN (
  SELECT DISTINCT batch_id FROM ebay_batch_rows WHERE batch_id IS NOT NULL
) AND NOT ('ebay' = ANY(COALESCE(platforms, '{}')));

-- Also fix batches with LA rows
UPDATE la_batches SET platforms = array_append(
  COALESCE(platforms, '{}'),
  'liveauctioneers'
) WHERE id IN (
  SELECT DISTINCT batch_id FROM la_batch_rows WHERE batch_id IS NOT NULL
) AND NOT ('liveauctioneers' = ANY(COALESCE(platforms, '{}')));