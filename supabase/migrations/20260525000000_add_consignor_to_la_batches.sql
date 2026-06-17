ALTER TABLE la_batches
  ADD COLUMN IF NOT EXISTS consignor_name text,
  ADD COLUMN IF NOT EXISTS consignor_email text;
