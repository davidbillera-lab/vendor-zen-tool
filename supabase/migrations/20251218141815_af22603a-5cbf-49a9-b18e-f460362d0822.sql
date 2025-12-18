-- Rename la_batches to projects for multi-platform use
ALTER TABLE public.la_batches ADD COLUMN IF NOT EXISTS platforms text[] DEFAULT '{}';

-- Create denver_batch_rows table for Denver Auctions
CREATE TABLE public.denver_batch_rows (
  id uuid NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  batch_id uuid REFERENCES public.la_batches(id) ON DELETE CASCADE,
  lot_number integer NOT NULL,
  title text NOT NULL,
  description text,
  starting_bid numeric DEFAULT 5,
  image_urls text[] DEFAULT '{}',
  created_by uuid,
  created_at timestamp with time zone NOT NULL DEFAULT now()
);

-- Enable RLS
ALTER TABLE public.denver_batch_rows ENABLE ROW LEVEL SECURITY;

-- Policies for denver_batch_rows
CREATE POLICY "Authenticated users can view denver rows" ON public.denver_batch_rows
  FOR SELECT TO authenticated USING (true);

CREATE POLICY "Authenticated users can insert denver rows" ON public.denver_batch_rows
  FOR INSERT TO authenticated WITH CHECK (true);

CREATE POLICY "Authenticated users can update denver rows" ON public.denver_batch_rows
  FOR UPDATE TO authenticated USING (true);

CREATE POLICY "Authenticated users can delete denver rows" ON public.denver_batch_rows
  FOR DELETE TO authenticated USING (true);

-- Add project_id to listings table for eBay/Facebook
ALTER TABLE public.listings ADD COLUMN IF NOT EXISTS project_id uuid REFERENCES public.la_batches(id) ON DELETE SET NULL;