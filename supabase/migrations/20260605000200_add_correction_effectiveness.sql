-- v2.4 self-improving loop: effectiveness tracking + decay (close the quality loop).
-- v2.2 retrieves the most *similar* past corrections; this stage tracks whether an
-- injected correction actually WORKED. When a listing generated with corrections
-- injected gets corrected again on the same field, the injected lesson failed -> we
-- down-weight/retire it. Stale corrections decay so the operator's current taste
-- dominates. A durable injection-event log powers the re-correction-rate metric for
-- the exit/data-room story ("re-correction rate down X% over 90 days").

-- 1. Effectiveness counters + retirement flag on each correction.
alter table public.listing_corrections
  add column if not exists times_injected int not null default 0,
  add column if not exists times_failed int not null default 0,
  add column if not exists retired boolean not null default false;

-- 2. UPDATE RLS policy (v1 only had select + insert). Needed so a caller can bump
--    their own counters / retire their own lessons. Per-user isolation preserved.
drop policy if exists "own corrections - update" on public.listing_corrections;
create policy "own corrections - update" on public.listing_corrections
  for update using (auth.uid() = user_id) with check (auth.uid() = user_id);

-- 3. Handle on the generated row so re-correction detection can find the lessons
--    that shaped it. (ebay_batch_rows churns/deletes; this is just a convenience
--    handle -- the durable history lives in correction_injections below.)
alter table public.ebay_batch_rows
  add column if not exists injected_correction_ids uuid[];

-- 4. Durable injection-event log. Survives ebay_batch_rows deletion (on delete set
--    null keeps the row's history) so the effectiveness metric has persistent data.
create table if not exists public.correction_injections (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id),
  platform text,
  row_id text,                          -- ebay_batch_rows id (text; rows may be deleted)
  correction_id uuid references public.listing_corrections(id) on delete set null,
  re_corrected boolean not null default false,
  re_corrected_field text,              -- 'title' | 'specifics' | 'both'
  re_corrected_at timestamptz,
  created_at timestamptz not null default now()
);

alter table public.correction_injections enable row level security;

drop policy if exists "own injections - select" on public.correction_injections;
create policy "own injections - select" on public.correction_injections
  for select using (auth.uid() = user_id);

drop policy if exists "own injections - insert" on public.correction_injections;
create policy "own injections - insert" on public.correction_injections
  for insert with check (auth.uid() = user_id);

drop policy if exists "own injections - update" on public.correction_injections;
create policy "own injections - update" on public.correction_injections
  for update using (auth.uid() = user_id) with check (auth.uid() = user_id);

create index if not exists correction_injections_user_created_idx
  on public.correction_injections (user_id, created_at desc);

-- Lookup by row for re-correction detection.
create index if not exists correction_injections_row_idx
  on public.correction_injections (user_id, row_id);

-- 5. Retrieval now excludes retired lessons and blends recency decay so stale
--    corrections fade. Ranking = similarity * decay, where decay halves relevance
--    roughly every ~90 days of age. security invoker + auth.uid() filter unchanged.
create or replace function public.match_listing_corrections(
  query_embedding vector(1536),
  match_count int default 8
)
returns table (
  id uuid,
  source text,
  category text,
  wrong_title text,
  corrected_title text,
  wrong_specifics jsonb,
  corrected_specifics jsonb,
  correction_note text,
  similarity float
)
language sql
stable
security invoker
set search_path = public
as $$
  select
    c.id,
    c.source,
    c.category,
    c.wrong_title,
    c.corrected_title,
    c.wrong_specifics,
    c.corrected_specifics,
    c.correction_note,
    1 - (c.embedding <=> query_embedding) as similarity
  from public.listing_corrections c
  where c.user_id = auth.uid()
    and c.embedding is not null
    and c.retired = false
  order by
    (1 - (c.embedding <=> query_embedding))
      * (1.0 / (1.0 + (extract(epoch from now() - c.created_at) / 86400.0) / 90.0)) desc
  limit greatest(match_count, 1);
$$;

grant execute on function public.match_listing_corrections(vector, int) to authenticated;

-- 6a. Record that a set of corrections shaped a generated listing: write one durable
--     event per correction and bump times_injected. Single round-trip, atomic, RLS-safe.
create or replace function public.record_correction_injections(
  p_row_id text,
  p_platform text,
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

  insert into public.correction_injections (user_id, platform, row_id, correction_id)
  select auth.uid(), p_platform, p_row_id, cid
  from unnest(p_ids) as cid;

  update public.listing_corrections
  set times_injected = times_injected + 1
  where user_id = auth.uid()
    and id = any(p_ids);
end;
$$;

grant execute on function public.record_correction_injections(text, text, uuid[]) to authenticated;

-- 6b. A re-correction on the same row means the injected lessons failed: flip the
--     open injection events, bump times_failed, and retire a lesson once it has
--     failed enough (>= 3 failures AND failures outweigh half its injections).
create or replace function public.mark_corrections_re_corrected(
  p_row_id text,
  p_field text,
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

  update public.correction_injections
  set re_corrected = true,
      re_corrected_field = p_field,
      re_corrected_at = now()
  where user_id = auth.uid()
    and row_id = p_row_id
    and correction_id = any(p_ids)
    and re_corrected = false;

  update public.listing_corrections
  set times_failed = times_failed + 1
  where user_id = auth.uid()
    and id = any(p_ids);

  update public.listing_corrections
  set retired = true
  where user_id = auth.uid()
    and id = any(p_ids)
    and times_failed >= 3
    and times_failed * 2 >= times_injected;
end;
$$;

grant execute on function public.mark_corrections_re_corrected(text, text, uuid[]) to authenticated;

-- 7. The exit-story metric: overall re-correction rate plus a trailing-30d vs prior-30d
--    comparison so we can say "re-correction rate is down X%". Per-user scoped.
create or replace function public.correction_effectiveness_stats()
returns table (
  total_injections bigint,
  re_corrected bigint,
  re_correction_rate float,
  rate_last_30d float,
  rate_prior_30d float
)
language sql
stable
security invoker
set search_path = public
as $$
  with mine as (
    select re_corrected, created_at
    from public.correction_injections
    where user_id = auth.uid()
  )
  select
    count(*)::bigint as total_injections,
    count(*) filter (where re_corrected)::bigint as re_corrected,
    case when count(*) > 0
      then count(*) filter (where re_corrected)::float / count(*)
      else 0 end as re_correction_rate,
    case when count(*) filter (where created_at >= now() - interval '30 days') > 0
      then count(*) filter (where re_corrected and created_at >= now() - interval '30 days')::float
           / count(*) filter (where created_at >= now() - interval '30 days')
      else 0 end as rate_last_30d,
    case when count(*) filter (where created_at >= now() - interval '60 days'
                                 and created_at < now() - interval '30 days') > 0
      then count(*) filter (where re_corrected
                              and created_at >= now() - interval '60 days'
                              and created_at < now() - interval '30 days')::float
           / count(*) filter (where created_at >= now() - interval '60 days'
                                and created_at < now() - interval '30 days')
      else 0 end as rate_prior_30d
  from mine;
$$;

grant execute on function public.correction_effectiveness_stats() to authenticated;
