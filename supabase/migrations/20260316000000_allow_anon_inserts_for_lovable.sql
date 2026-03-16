-- Allow the anon role to insert and select from la_batches and denver_batch_rows.
-- This is needed for the Lovable CSV upload tool which uses the anon key without auth.
-- This is safe because this is an internal tool and these tables contain no sensitive user data.

-- la_batches: allow anon to insert and read
CREATE POLICY "Anon can insert batches" ON public.la_batches
FOR INSERT TO anon WITH CHECK (true);

CREATE POLICY "Anon can view batches" ON public.la_batches
FOR SELECT TO anon USING (true);

-- denver_batch_rows: allow anon to insert and read
CREATE POLICY "Anon can insert denver rows" ON public.denver_batch_rows
FOR INSERT TO anon WITH CHECK (true);

CREATE POLICY "Anon can view denver rows" ON public.denver_batch_rows
FOR SELECT TO anon USING (true);
