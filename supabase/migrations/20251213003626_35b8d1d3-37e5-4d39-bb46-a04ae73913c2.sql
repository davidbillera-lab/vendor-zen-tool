-- Drop overly permissive storage policies
DROP POLICY IF EXISTS "Anyone can upload listing images" ON storage.objects;
DROP POLICY IF EXISTS "Anyone can update listing images" ON storage.objects;
DROP POLICY IF EXISTS "Anyone can delete listing images" ON storage.objects;

-- Create auth-restricted policies for storage
CREATE POLICY "Authenticated users can upload listing images" ON storage.objects
FOR INSERT WITH CHECK (
  bucket_id = 'listing-images' AND auth.uid() IS NOT NULL
);

CREATE POLICY "Authenticated users can update listing images" ON storage.objects
FOR UPDATE USING (
  bucket_id = 'listing-images' AND auth.uid() IS NOT NULL
);

CREATE POLICY "Authenticated users can delete listing images" ON storage.objects
FOR DELETE USING (
  bucket_id = 'listing-images' AND auth.uid() IS NOT NULL
);

-- Add DELETE policy for csv_exports table
CREATE POLICY "Users can delete own exports" ON csv_exports
FOR DELETE USING (auth.uid() = user_id);