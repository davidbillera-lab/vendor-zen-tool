-- Add status and error_log columns to denver_batch_rows for DOA agent integration
ALTER TABLE public.denver_batch_rows
  ADD COLUMN IF NOT EXISTS status text DEFAULT 'pending'
    CHECK (status IN ('pending', 'in_progress', 'completed', 'failed')),
  ADD COLUMN IF NOT EXISTS error_log text;
