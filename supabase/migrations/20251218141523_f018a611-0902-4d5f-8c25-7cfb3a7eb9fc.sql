-- Create a table to track different batches/projects
CREATE TABLE public.la_batches (
  id uuid NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  name text NOT NULL,
  created_by uuid REFERENCES auth.users(id) ON DELETE CASCADE,
  created_at timestamp with time zone NOT NULL DEFAULT now(),
  updated_at timestamp with time zone NOT NULL DEFAULT now(),
  is_active boolean NOT NULL DEFAULT true,
  lot_count integer NOT NULL DEFAULT 0
);

-- Enable RLS
ALTER TABLE public.la_batches ENABLE ROW LEVEL SECURITY;

-- Policies for authenticated users
CREATE POLICY "Users can view all batches" ON public.la_batches
  FOR SELECT TO authenticated USING (true);

CREATE POLICY "Users can create batches" ON public.la_batches
  FOR INSERT TO authenticated WITH CHECK (true);

CREATE POLICY "Users can update batches" ON public.la_batches
  FOR UPDATE TO authenticated USING (true);

CREATE POLICY "Users can delete batches" ON public.la_batches
  FOR DELETE TO authenticated USING (true);

-- Add batch_id to la_batch_rows
ALTER TABLE public.la_batch_rows 
ADD COLUMN batch_id uuid REFERENCES public.la_batches(id) ON DELETE CASCADE;

-- Create trigger to update updated_at
CREATE TRIGGER update_la_batches_updated_at
  BEFORE UPDATE ON public.la_batches
  FOR EACH ROW
  EXECUTE FUNCTION public.update_updated_at_column();