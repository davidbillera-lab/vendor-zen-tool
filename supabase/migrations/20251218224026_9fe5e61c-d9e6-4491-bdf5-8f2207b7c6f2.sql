-- Create eBay batch rows table for storing eBay listings in batches
CREATE TABLE public.ebay_batch_rows (
  id UUID NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  batch_id UUID REFERENCES public.la_batches(id) ON DELETE CASCADE,
  lot_number INTEGER NOT NULL,
  title TEXT NOT NULL,
  description TEXT,
  price NUMERIC DEFAULT 0,
  category TEXT,
  condition TEXT,
  item_specifics JSONB DEFAULT '{}'::jsonb,
  image_urls TEXT[] DEFAULT '{}'::text[],
  
  -- Shipping settings
  shipping_type TEXT DEFAULT 'flat', -- flat, calculated, free
  shipping_cost NUMERIC DEFAULT 0,
  handling_time INTEGER DEFAULT 3, -- days
  
  -- Return policy
  returns_accepted BOOLEAN DEFAULT true,
  return_period INTEGER DEFAULT 30, -- days
  return_shipping TEXT DEFAULT 'buyer', -- buyer, seller
  
  -- Promotion
  promotion_rate NUMERIC DEFAULT 0,
  promotion_type TEXT DEFAULT 'flat', -- flat, fluctuating
  
  -- Metadata
  status TEXT DEFAULT 'draft',
  created_by UUID,
  created_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(),
  updated_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now()
);

-- Enable RLS
ALTER TABLE public.ebay_batch_rows ENABLE ROW LEVEL SECURITY;

-- RLS Policies
CREATE POLICY "Authenticated users can view ebay rows" ON public.ebay_batch_rows
  FOR SELECT USING (true);

CREATE POLICY "Authenticated users can insert ebay rows" ON public.ebay_batch_rows
  FOR INSERT WITH CHECK (true);

CREATE POLICY "Authenticated users can update ebay rows" ON public.ebay_batch_rows
  FOR UPDATE USING (true);

CREATE POLICY "Authenticated users can delete ebay rows" ON public.ebay_batch_rows
  FOR DELETE USING (true);

-- Trigger for updated_at
CREATE TRIGGER update_ebay_batch_rows_updated_at
  BEFORE UPDATE ON public.ebay_batch_rows
  FOR EACH ROW
  EXECUTE FUNCTION public.update_updated_at_column();