-- estatesales_jobs
-- Tracks each photo upload job submitted through the EstateSales SaaS app.
-- One row per run: stores the DOA auction URL, the estatesales.net listing URL,
-- live progress counters, and final status.

create table if not exists estatesales_jobs (
  id               uuid primary key default gen_random_uuid(),
  user_id          uuid references auth.users not null,
  doa_url          text not null,
  estatesales_url  text not null,
  status           text not null default 'pending',
    -- pending | running | completed | failed
  lots_scraped     int  not null default 0,
  lots_uploaded    int  not null default 0,
  lots_described   int  not null default 0,
  error_message    text,
  created_at       timestamptz not null default now(),
  completed_at     timestamptz
);

-- RLS: users can only see and update their own jobs.
-- The agent uses the service role key which bypasses RLS entirely.
alter table estatesales_jobs enable row level security;

create policy "Users manage their own jobs"
  on estatesales_jobs
  for all
  using  (auth.uid() = user_id)
  with check (auth.uid() = user_id);


-- user_estatesales_credentials
-- Stores each client's estatesales.net login credentials.
-- One row per user (unique constraint on user_id).

create table if not exists user_estatesales_credentials (
  id                   uuid primary key default gen_random_uuid(),
  user_id              uuid references auth.users not null unique,
  estatesales_email    text not null,
  estatesales_password text not null,
  created_at           timestamptz not null default now()
);

-- RLS: users can only read and write their own credentials row.
alter table user_estatesales_credentials enable row level security;

create policy "Users manage their own credentials"
  on user_estatesales_credentials
  for all
  using  (auth.uid() = user_id)
  with check (auth.uid() = user_id);
