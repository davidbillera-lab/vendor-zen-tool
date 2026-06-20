-- estatesales_uploaded_lots: dedup ledger / state machine for lot-level upload tracking
-- status values: reserved | uploaded | failed
create table if not exists estatesales_uploaded_lots (
  id uuid primary key default gen_random_uuid(),
  user_id uuid references auth.users(id) on delete cascade,
  job_id uuid,                          -- conceptual FK to estatesales_jobs(id); nullable, no hard FK
  es_url text not null,
  lot_url text not null,
  lot_number text,
  lot_title text,
  status text not null default 'reserved' check (status in ('reserved','uploaded','failed')),
  reserved_at timestamptz not null default now(),
  uploaded_at timestamptz,
  created_at timestamptz not null default now(),
  unique (es_url, lot_url)              -- idempotency boundary: one row per lot per sale
);

create index if not exists estatesales_uploaded_lots_es_url_idx
  on estatesales_uploaded_lots (es_url);

create index if not exists estatesales_uploaded_lots_status_idx
  on estatesales_uploaded_lots (status);

-- composite index for the dedup read path: "which lots of this sale are uploaded?"
create index if not exists estatesales_uploaded_lots_es_url_status_idx
  on estatesales_uploaded_lots (es_url, status);

alter table estatesales_uploaded_lots enable row level security;

-- RLS: only operators reading their own audit rows from the UI traverse RLS.
-- The agent writes via SUPABASE_SERVICE_KEY, which bypasses RLS entirely, so no
-- write policy is required. A permissive "FOR ALL using(true) with check(true)"
-- policy would NOT be scoped to the service role -- policy names are cosmetic in
-- Postgres, so it would apply to the authenticated/anon roles too. Because
-- permissive policies are OR'd, it would override the SELECT restriction below
-- and expose every user's rows. Omitting it keeps per-user isolation intact.
drop policy if exists "Service role manages estatesales uploaded lots" on estatesales_uploaded_lots;
drop policy if exists "Users view own estatesales uploaded lots" on estatesales_uploaded_lots;
create policy "Users view own estatesales uploaded lots"
  on estatesales_uploaded_lots
  for select
  using (auth.uid() = user_id);

-- estatesales_jobs: add progress + outcome columns
alter table estatesales_jobs add column if not exists error_message text;
alter table estatesales_jobs add column if not exists completed_at timestamptz;
alter table estatesales_jobs add column if not exists lots_scraped int;
alter table estatesales_jobs add column if not exists lots_uploaded int;
alter table estatesales_jobs add column if not exists lots_skipped int default 0;

-- user_estatesales_credentials: persist Playwright browser session state
-- SECURITY NOTE: estatesales_storage_state contains a full exported Playwright session JSON.
-- Treat this column as a credential -- encrypt at rest, never log, never expose client-side.
alter table user_estatesales_credentials
  add column if not exists estatesales_storage_state text;
