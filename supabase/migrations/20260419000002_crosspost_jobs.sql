create table if not exists public.crosspost_jobs (
  id uuid primary key default gen_random_uuid(),
  listing_id uuid references public.listings(id) on delete set null,
  batch_id uuid references public.la_batches(id) on delete set null,
  platform text not null check (platform in ('mercari', 'poshmark', 'etsy')),
  status text not null default 'pending' check (status in ('pending', 'in_progress', 'completed', 'failed')),
  formatted_data jsonb,
  error_log text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

-- Index for agent polling (platform + status is the hot query path)
create index if not exists crosspost_jobs_platform_status_idx
  on public.crosspost_jobs (platform, status)
  where status = 'pending';

-- Auto-update updated_at on row change
create or replace function public.update_crosspost_jobs_updated_at()
returns trigger language plpgsql as $$
begin
  new.updated_at = now();
  return new;
end;
$$;

create trigger crosspost_jobs_updated_at
  before update on public.crosspost_jobs
  for each row execute function public.update_crosspost_jobs_updated_at();

-- RLS: authenticated users can read/insert their own jobs (agents use service role, bypass RLS)
alter table public.crosspost_jobs enable row level security;

create policy "Users can manage their own crosspost jobs"
  on public.crosspost_jobs
  for all
  using (
    listing_id in (
      select id from public.listings where user_id = auth.uid()
    )
  );
