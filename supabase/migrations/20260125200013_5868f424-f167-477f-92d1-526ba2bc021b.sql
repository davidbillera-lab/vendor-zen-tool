-- Add new columns to ebay_batch_rows to match eBay's full desktop format
ALTER TABLE public.ebay_batch_rows 
ADD COLUMN IF NOT EXISTS subtitle text,
ADD COLUMN IF NOT EXISTS store_category text,
ADD COLUMN IF NOT EXISTS package_weight_lbs numeric DEFAULT 0,
ADD COLUMN IF NOT EXISTS package_weight_oz numeric DEFAULT 0,
ADD COLUMN IF NOT EXISTS package_length numeric DEFAULT 0,
ADD COLUMN IF NOT EXISTS package_width numeric DEFAULT 0,
ADD COLUMN IF NOT EXISTS package_height numeric DEFAULT 0,
ADD COLUMN IF NOT EXISTS best_offer_enabled boolean DEFAULT true,
ADD COLUMN IF NOT EXISTS best_offer_auto_accept numeric,
ADD COLUMN IF NOT EXISTS minimum_best_offer numeric,
ADD COLUMN IF NOT EXISTS upc text,
ADD COLUMN IF NOT EXISTS brand text,
ADD COLUMN IF NOT EXISTS mpn text;