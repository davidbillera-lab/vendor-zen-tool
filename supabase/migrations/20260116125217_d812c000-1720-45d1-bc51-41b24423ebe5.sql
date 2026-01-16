-- Fix RLS policies for ebay_batch_rows
DROP POLICY IF EXISTS "Authenticated users can delete ebay rows" ON public.ebay_batch_rows;
DROP POLICY IF EXISTS "Authenticated users can insert ebay rows" ON public.ebay_batch_rows;
DROP POLICY IF EXISTS "Authenticated users can update ebay rows" ON public.ebay_batch_rows;
DROP POLICY IF EXISTS "Authenticated users can view ebay rows" ON public.ebay_batch_rows;

CREATE POLICY "Users can view own ebay rows" ON public.ebay_batch_rows
FOR SELECT TO authenticated USING (auth.uid() = created_by);

CREATE POLICY "Users can insert own ebay rows" ON public.ebay_batch_rows
FOR INSERT TO authenticated WITH CHECK (auth.uid() = created_by);

CREATE POLICY "Users can update own ebay rows" ON public.ebay_batch_rows
FOR UPDATE TO authenticated USING (auth.uid() = created_by);

CREATE POLICY "Users can delete own ebay rows" ON public.ebay_batch_rows
FOR DELETE TO authenticated USING (auth.uid() = created_by);

-- Fix RLS policies for la_batches
DROP POLICY IF EXISTS "Users can view all batches" ON public.la_batches;
DROP POLICY IF EXISTS "Users can create batches" ON public.la_batches;
DROP POLICY IF EXISTS "Users can update batches" ON public.la_batches;
DROP POLICY IF EXISTS "Users can delete batches" ON public.la_batches;

CREATE POLICY "Users can view own batches" ON public.la_batches
FOR SELECT TO authenticated USING (auth.uid() = created_by);

CREATE POLICY "Users can insert own batches" ON public.la_batches
FOR INSERT TO authenticated WITH CHECK (auth.uid() = created_by);

CREATE POLICY "Users can update own batches" ON public.la_batches
FOR UPDATE TO authenticated USING (auth.uid() = created_by);

CREATE POLICY "Users can delete own batches" ON public.la_batches
FOR DELETE TO authenticated USING (auth.uid() = created_by);

-- Fix RLS policies for la_batch_rows
DROP POLICY IF EXISTS "Authenticated users can view all batch rows" ON public.la_batch_rows;
DROP POLICY IF EXISTS "Authenticated users can insert batch rows" ON public.la_batch_rows;
DROP POLICY IF EXISTS "Authenticated users can update batch rows" ON public.la_batch_rows;
DROP POLICY IF EXISTS "Authenticated users can delete batch rows" ON public.la_batch_rows;

CREATE POLICY "Users can view own batch rows" ON public.la_batch_rows
FOR SELECT TO authenticated USING (auth.uid() = created_by);

CREATE POLICY "Users can insert own batch rows" ON public.la_batch_rows
FOR INSERT TO authenticated WITH CHECK (auth.uid() = created_by);

CREATE POLICY "Users can update own batch rows" ON public.la_batch_rows
FOR UPDATE TO authenticated USING (auth.uid() = created_by);

CREATE POLICY "Users can delete own batch rows" ON public.la_batch_rows
FOR DELETE TO authenticated USING (auth.uid() = created_by);

-- Fix RLS policies for denver_batch_rows
DROP POLICY IF EXISTS "Authenticated users can view denver rows" ON public.denver_batch_rows;
DROP POLICY IF EXISTS "Authenticated users can insert denver rows" ON public.denver_batch_rows;
DROP POLICY IF EXISTS "Authenticated users can update denver rows" ON public.denver_batch_rows;
DROP POLICY IF EXISTS "Authenticated users can delete denver rows" ON public.denver_batch_rows;

CREATE POLICY "Users can view own denver rows" ON public.denver_batch_rows
FOR SELECT TO authenticated USING (auth.uid() = created_by);

CREATE POLICY "Users can insert own denver rows" ON public.denver_batch_rows
FOR INSERT TO authenticated WITH CHECK (auth.uid() = created_by);

CREATE POLICY "Users can update own denver rows" ON public.denver_batch_rows
FOR UPDATE TO authenticated USING (auth.uid() = created_by);

CREATE POLICY "Users can delete own denver rows" ON public.denver_batch_rows
FOR DELETE TO authenticated USING (auth.uid() = created_by);