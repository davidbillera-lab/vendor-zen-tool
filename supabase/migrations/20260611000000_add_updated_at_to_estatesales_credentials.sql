-- Reconcile schema drift: user_estatesales_credentials was created by Lovable
-- without an updated_at column, unlike its three sibling credential tables
-- (user_doa/mercari/poshmark_credentials all have updated_at NOT NULL DEFAULT now()).
--
-- The generic save-credentials edge function stamps updated_at on every upsert.
-- Without this column the estatesales upsert failed with a 500. Adding the column
-- keeps the function uniform across all four platforms.
alter table user_estatesales_credentials
  add column if not exists updated_at timestamptz not null default now();
