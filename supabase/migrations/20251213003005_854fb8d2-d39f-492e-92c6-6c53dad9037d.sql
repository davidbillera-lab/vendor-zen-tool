-- Add user_id column to listings table
ALTER TABLE public.listings 
ADD COLUMN user_id UUID REFERENCES auth.users(id) ON DELETE CASCADE;

-- Add user_id column to csv_exports table
ALTER TABLE public.csv_exports 
ADD COLUMN user_id UUID REFERENCES auth.users(id) ON DELETE CASCADE;

-- Drop existing permissive policies on listings
DROP POLICY IF EXISTS "Anyone can view listings" ON public.listings;
DROP POLICY IF EXISTS "Anyone can create listings" ON public.listings;
DROP POLICY IF EXISTS "Anyone can update listings" ON public.listings;
DROP POLICY IF EXISTS "Anyone can delete listings" ON public.listings;

-- Drop existing permissive policies on csv_exports
DROP POLICY IF EXISTS "Anyone can view csv exports" ON public.csv_exports;
DROP POLICY IF EXISTS "Anyone can create csv exports" ON public.csv_exports;

-- Create secure RLS policies for listings
CREATE POLICY "Users can view own listings" 
ON public.listings 
FOR SELECT 
USING (auth.uid() = user_id);

CREATE POLICY "Users can create own listings" 
ON public.listings 
FOR INSERT 
WITH CHECK (auth.uid() = user_id);

CREATE POLICY "Users can update own listings" 
ON public.listings 
FOR UPDATE 
USING (auth.uid() = user_id);

CREATE POLICY "Users can delete own listings" 
ON public.listings 
FOR DELETE 
USING (auth.uid() = user_id);

-- Create secure RLS policies for csv_exports
CREATE POLICY "Users can view own exports" 
ON public.csv_exports 
FOR SELECT 
USING (auth.uid() = user_id);

CREATE POLICY "Users can create own exports" 
ON public.csv_exports 
FOR INSERT 
WITH CHECK (auth.uid() = user_id);