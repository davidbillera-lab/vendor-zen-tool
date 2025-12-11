-- Create storage bucket for listing images
INSERT INTO storage.buckets (id, name, public)
VALUES ('listing-images', 'listing-images', true);

-- Storage policies for listing images
CREATE POLICY "Anyone can view listing images"
ON storage.objects FOR SELECT
USING (bucket_id = 'listing-images');

CREATE POLICY "Anyone can upload listing images"
ON storage.objects FOR INSERT
WITH CHECK (bucket_id = 'listing-images');

CREATE POLICY "Anyone can update listing images"
ON storage.objects FOR UPDATE
USING (bucket_id = 'listing-images');

CREATE POLICY "Anyone can delete listing images"
ON storage.objects FOR DELETE
USING (bucket_id = 'listing-images');

-- Listings table for drafts and completed listings
CREATE TABLE public.listings (
  id UUID NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  platform TEXT NOT NULL CHECK (platform IN ('ebay', 'facebook', 'liveauctioneers', 'denver')),
  status TEXT NOT NULL DEFAULT 'draft' CHECK (status IN ('draft', 'pending', 'posted', 'exported')),
  title TEXT,
  description TEXT,
  price DECIMAL(10,2),
  category TEXT,
  condition TEXT,
  item_specifics JSONB DEFAULT '{}',
  promotion_rate DECIMAL(5,2),
  promotion_type TEXT CHECK (promotion_type IN ('flat', 'fluctuating')),
  image_urls TEXT[] DEFAULT '{}',
  lot_number INTEGER,
  csv_row_data JSONB,
  facebook_groups TEXT[] DEFAULT '{}',
  created_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(),
  updated_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now()
);

-- Enable RLS (public for now - no auth required)
ALTER TABLE public.listings ENABLE ROW LEVEL SECURITY;

-- Public access policies
CREATE POLICY "Anyone can view listings"
ON public.listings FOR SELECT
USING (true);

CREATE POLICY "Anyone can create listings"
ON public.listings FOR INSERT
WITH CHECK (true);

CREATE POLICY "Anyone can update listings"
ON public.listings FOR UPDATE
USING (true);

CREATE POLICY "Anyone can delete listings"
ON public.listings FOR DELETE
USING (true);

-- CSV exports table for batch exports
CREATE TABLE public.csv_exports (
  id UUID NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  platform TEXT NOT NULL CHECK (platform IN ('ebay', 'liveauctioneers')),
  filename TEXT NOT NULL,
  row_count INTEGER NOT NULL DEFAULT 0,
  csv_data TEXT,
  created_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now()
);

ALTER TABLE public.csv_exports ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Anyone can view csv exports"
ON public.csv_exports FOR SELECT
USING (true);

CREATE POLICY "Anyone can create csv exports"
ON public.csv_exports FOR INSERT
WITH CHECK (true);

-- Update trigger for listings
CREATE OR REPLACE FUNCTION public.update_updated_at_column()
RETURNS TRIGGER AS $$
BEGIN
  NEW.updated_at = now();
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER update_listings_updated_at
BEFORE UPDATE ON public.listings
FOR EACH ROW
EXECUTE FUNCTION public.update_updated_at_column();