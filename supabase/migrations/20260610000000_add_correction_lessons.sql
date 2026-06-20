-- v2.3 self-improving loop: AI-distilled lessons (knowledge, not just memory).
-- v2.2 retrieves *similar* raw corrections; this stage periodically distills them
-- into a small set of GENERAL rules per user (e.g. many "vase -> umbrella stand"
-- fixes become one lesson: "tall narrow ceramic floor pieces in this inventory
-- are usually umbrella stands"). At generation time a few lessons are injected
-- alongside the raw corrections -- lessons generalize, raw cases give precision.
-- Distillation runs as a Tier-2 batch pass (distill-lessons edge function),
-- never in the hot listing path.

-- 1. Mark corrections consumed by a distillation pass so each pass only reads
--    new signal. Null = not yet distilled.
alter table public.listing_corrections
  add column if not exists distilled_at timestamptz;

-- 2. Distilled lessons. Each distillation pass is consolidating: it reads the
--    undistilled corrections + current active lessons, produces a fresh set
--    (capped at 15), retires the old set. Bounded count, no duplicates.
create table if not exists public.listing_correction_lessons (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id),
  lesson_text text not null,
  category text,
  source_correction_ids uuid[],         -- corrections consumed to produce this lesson
  times_injected int not null default 0,
  retired boolean not null default false,
  created_at timestamptz not null default now()
);

alter table public.listing_correction_lessons enable row level security;

drop policy if exists "own lessons - select" on public.listing_correction_lessons;
create policy "own lessons - select" on public.listing_correction_lessons
  for select using (auth.uid() = user_id);

drop policy if exists "own lessons - insert" on public.listing_correction_lessons;
create policy "own lessons - insert" on public.listing_correction_lessons
  for insert with check (auth.uid() = user_id);

drop policy if exists "own lessons - update" on public.listing_correction_lessons;
create policy "own lessons - update" on public.listing_correction_lessons
  for update using (auth.uid() = user_id) with check (auth.uid() = user_id);

-- Active-lesson reads are "newest non-retired for this user".
create index if not exists listing_correction_lessons_user_active_idx
  on public.listing_correction_lessons (user_id, retired, created_at desc);

-- 3. Bump times_injected when lessons shape a generated listing. Mirrors
--    record_correction_injections; RLS-safe via security invoker + auth.uid().
create or replace function public.record_lesson_injections(
  p_ids uuid[]
)
returns void
language plpgsql
security invoker
set search_path = public
as $$
begin
  if p_ids is null or array_length(p_ids, 1) is null then
    return;
  end if;

  update public.listing_correction_lessons
  set times_injected = times_injected + 1
  where user_id = auth.uid()
    and id = any(p_ids);
end;
$$;

grant execute on function public.record_lesson_injections(uuid[]) to authenticated;
