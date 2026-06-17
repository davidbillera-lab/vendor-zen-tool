ALTER TABLE public.ebay_batch_rows
ADD COLUMN IF NOT EXISTS custom_sku text;
