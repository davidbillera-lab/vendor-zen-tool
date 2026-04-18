-- Multi-tenant platform configuration
-- Additive only: no existing tables modified

-- User profiles (business name + admin flag)
create table if not exists public.user_profiles (
  id uuid primary key references auth.users(id) on delete cascade,
  business_name text,
  is_admin boolean not null default false,
  created_at timestamptz not null default now()
);

alter table public.user_profiles enable row level security;

create policy "Users can view own profile"
  on public.user_profiles for select
  using (auth.uid() = id);

create policy "Users can update own profile"
  on public.user_profiles for update
  using (auth.uid() = id);

create policy "Users can insert own profile"
  on public.user_profiles for insert
  with check (auth.uid() = id);

create policy "Admins can view all profiles"
  on public.user_profiles for select
  using (
    exists (
      select 1 from public.user_profiles
      where id = auth.uid() and is_admin = true
    )
  );

-- Auto-create profile row on sign up
create or replace function public.handle_new_user()
returns trigger language plpgsql security definer
as $$
begin
  insert into public.user_profiles (id)
  values (new.id)
  on conflict (id) do nothing;
  return new;
end;
$$;

drop trigger if exists on_auth_user_created on auth.users;
create trigger on_auth_user_created
  after insert on auth.users
  for each row execute procedure public.handle_new_user();

-- Per-user platform preferences
create table if not exists public.user_platforms (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  platform text not null,
  enabled boolean not null default true,
  display_order int not null default 0,
  created_at timestamptz not null default now(),
  unique (user_id, platform)
);

alter table public.user_platforms enable row level security;

create policy "Users can manage own platforms"
  on public.user_platforms for all
  using (auth.uid() = user_id)
  with check (auth.uid() = user_id);

create policy "Admins can view all platforms"
  on public.user_platforms for select
  using (
    exists (
      select 1 from public.user_profiles
      where id = auth.uid() and is_admin = true
    )
  );

-- Per-user eBay credentials
-- ebay-publish falls back to shared secrets if no row exists for the user
create table if not exists public.user_ebay_credentials (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null unique references auth.users(id) on delete cascade,
  client_id text,
  client_secret text,
  refresh_token text,
  environment text not null default 'production',
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

alter table public.user_ebay_credentials enable row level security;

create policy "Users can manage own eBay credentials"
  on public.user_ebay_credentials for all
  using (auth.uid() = user_id)
  with check (auth.uid() = user_id);

create policy "Admins can view all eBay credentials"
  on public.user_ebay_credentials for select
  using (
    exists (
      select 1 from public.user_profiles
      where id = auth.uid() and is_admin = true
    )
  );
