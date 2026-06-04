-- listing_corrections: capture every human correction of an AI-identified item
-- so the generation prompt can learn from past mistakes (self-improving loop).
-- Per-user RLS isolation, consistent with the multi-tenant direction.

create table if not exists public.listing_corrections (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id),
  source text not null,                 -- 'ai_verify' | 'refine' | 'guardrail'
  platform text,
  category text,                        -- category at correction time (future per-category retrieval)
  wrong_title text,
  corrected_title text,
  wrong_specifics jsonb,
  corrected_specifics jsonb,
  correction_note text,                 -- refine prompt / distilled lesson
  image_urls text[],
  created_at timestamptz not null default now()
);

alter table public.listing_corrections enable row level security;

create policy "own corrections - select" on public.listing_corrections
  for select using (auth.uid() = user_id);

create policy "own corrections - insert" on public.listing_corrections
  for insert with check (auth.uid() = user_id);

create index if not exists listing_corrections_user_created_idx
  on public.listing_corrections (user_id, created_at desc);
