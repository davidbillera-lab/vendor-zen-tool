-- Create table for LiveAuctioneers batch rows (shared by all authenticated users)
CREATE TABLE public.la_batch_rows (
  id UUID NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  lot_number INTEGER NOT NULL,
  title TEXT NOT NULL,
  description TEXT,
  low_est NUMERIC DEFAULT 0,
  high_est NUMERIC DEFAULT 0,
  start_price NUMERIC DEFAULT 5,
  condition TEXT,
  consignor TEXT DEFAULT 'JSG',
  height TEXT,
  width TEXT,
  depth TEXT,
  dimension_unit TEXT,
  weight TEXT,
  weight_unit TEXT,
  category TEXT,
  image_urls TEXT[] DEFAULT '{}',
  created_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(),
  created_by UUID REFERENCES auth.users(id) ON DELETE SET NULL
);

-- Enable RLS
ALTER TABLE public.la_batch_rows ENABLE ROW LEVEL SECURITY;

-- All authenticated users can view all rows (shared batch)
CREATE POLICY "Authenticated users can view all batch rows"
ON public.la_batch_rows
FOR SELECT
TO authenticated
USING (true);

-- All authenticated users can insert rows
CREATE POLICY "Authenticated users can insert batch rows"
ON public.la_batch_rows
FOR INSERT
TO authenticated
WITH CHECK (true);

-- All authenticated users can delete rows (to clear batch)
CREATE POLICY "Authenticated users can delete batch rows"
ON public.la_batch_rows
FOR DELETE
TO authenticated
USING (true);

-- All authenticated users can update rows
CREATE POLICY "Authenticated users can update batch rows"
ON public.la_batch_rows
FOR UPDATE
TO authenticated
USING (true);