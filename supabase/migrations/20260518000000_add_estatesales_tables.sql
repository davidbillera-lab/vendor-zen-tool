-- user_estatesales_credentials: per-user EstateSales.net login credentials
create table if not exists user_estatesales_credentials (
  user_id uuid primary key references auth.users(id) on delete cascade,
  estatesales_email text not null,
  estatesales_password text not null,
  updated_at timestamptz default now()
);

alter table user_estatesales_credentials enable row level security;

create policy "Users manage own estatesales credentials"
  on user_estatesales_credentials
  for all
  using (auth.uid() = user_id);

-- estatesales_jobs: tracks each upload job triggered from VZT
create table if not exists estatesales_jobs (
  id uuid primary key default gen_random_uuid(),
  user_id uuid references auth.users(id) on delete cascade,
  doa_url text not null,
  estatesales_url text not null,
  status text not null default 'pending',
  error text,
  created_at timestamptz default now(),
  updated_at timestamptz default now()
);

alter table estatesales_jobs enable row level security;

create policy "Users view own estatesales jobs"
  on estatesales_jobs
  for select
  using (auth.uid() = user_id);

create policy "Service role manages estatesales jobs"
  on estatesales_jobs
  for all
  using (true)
  with check (true);
