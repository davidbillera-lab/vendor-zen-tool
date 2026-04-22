-- user_mercari_credentials
create table if not exists public.user_mercari_credentials (
  id               uuid primary key default gen_random_uuid(),
  user_id          uuid not null unique references auth.users(id) on delete cascade,
  mercari_email    text not null,
  mercari_password text not null,
  created_at       timestamptz not null default now(),
  updated_at       timestamptz not null default now()
);

alter table public.user_mercari_credentials enable row level security;

create policy "Users manage own Mercari credentials"
  on public.user_mercari_credentials for all
  using (auth.uid() = user_id)
  with check (auth.uid() = user_id);

-- user_poshmark_credentials
create table if not exists public.user_poshmark_credentials (
  id                uuid primary key default gen_random_uuid(),
  user_id           uuid not null unique references auth.users(id) on delete cascade,
  poshmark_email    text not null,
  poshmark_password text not null,
  created_at        timestamptz not null default now(),
  updated_at        timestamptz not null default now()
);

alter table public.user_poshmark_credentials enable row level security;

create policy "Users manage own Poshmark credentials"
  on public.user_poshmark_credentials for all
  using (auth.uid() = user_id)
  with check (auth.uid() = user_id);

-- user_doa_credentials
create table if not exists public.user_doa_credentials (
  id                uuid primary key default gen_random_uuid(),
  user_id           uuid not null unique references auth.users(id) on delete cascade,
  doa_email         text not null,
  doa_password      text not null,
  doa_first_lot_url text,
  created_at        timestamptz not null default now(),
  updated_at        timestamptz not null default now()
);

alter table public.user_doa_credentials enable row level security;

create policy "Users manage own DOA credentials"
  on public.user_doa_credentials for all
  using (auth.uid() = user_id)
  with check (auth.uid() = user_id);
