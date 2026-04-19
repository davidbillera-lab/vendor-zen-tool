-- eBay category learnings — self-improving category knowledge base
-- Every successful push records item keywords → confirmed category ID
-- generate-listing queries this before AI or Taxonomy API

create table if not exists public.ebay_category_learnings (
  id uuid primary key default gen_random_uuid(),
  item_keywords text not null,         -- normalized title keywords (sorted, lowercase)
  category_id integer not null,        -- confirmed eBay leaf category ID
  category_name text not null,         -- human-readable category name
  confidence integer not null default 1,  -- incremented on each successful push
  last_confirmed timestamptz not null default now(),
  created_at timestamptz not null default now(),
  unique(item_keywords, category_id)
);

-- Full-text search index for fast keyword matching
create index if not exists idx_ebay_category_learnings_fts
  on public.ebay_category_learnings
  using gin(to_tsvector('english', item_keywords));

-- RLS: anyone authenticated can read; only service role writes (via RPC below)
alter table public.ebay_category_learnings enable row level security;

create policy "Anyone can read category learnings"
  on public.ebay_category_learnings for select
  using (true);

-- RPC for upsert+increment (security definer bypasses RLS for writes)
create or replace function public.record_category_learning(
  p_keywords text,
  p_category_id integer,
  p_category_name text
) returns void language plpgsql security definer as $$
begin
  insert into public.ebay_category_learnings (item_keywords, category_id, category_name, confidence)
  values (p_keywords, p_category_id, p_category_name, 1)
  on conflict (item_keywords, category_id) do update
    set confidence      = ebay_category_learnings.confidence + 1,
        last_confirmed  = now(),
        category_name   = excluded.category_name;
end;
$$;
