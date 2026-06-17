-- Cost ledger for every AI call (operator rule: log tokens + cost per call,
-- monthly review per project). Created here because the self-improving v2.2
-- work adds the first calls that log to it (Haiku caption + OpenAI embedding).

create table if not exists public.model_costs (
  id uuid primary key default gen_random_uuid(),
  user_id uuid references auth.users(id),
  source text not null,            -- function/feature, e.g. 'generate-listing'
  operation text,                  -- e.g. 'caption' | 'embedding' | 'generation'
  model text not null,             -- e.g. 'claude-haiku-4-5' | 'text-embedding-3-small'
  input_tokens integer,
  output_tokens integer,
  cost_usd numeric(12,6),
  created_at timestamptz not null default now()
);

alter table public.model_costs enable row level security;

-- Own-row visibility; inserts come from edge functions acting for the user
-- (service role bypasses RLS, authenticated may log their own rows).
-- CREATE POLICY has no IF NOT EXISTS, so drop-then-create for idempotency.
drop policy if exists "model_costs_select_own" on public.model_costs;
create policy "model_costs_select_own"
  on public.model_costs for select
  using (auth.uid() = user_id);

drop policy if exists "model_costs_insert_own" on public.model_costs;
create policy "model_costs_insert_own"
  on public.model_costs for insert
  with check (auth.uid() = user_id or user_id is null);

create index if not exists model_costs_created_idx
  on public.model_costs (created_at desc);

create index if not exists model_costs_user_created_idx
  on public.model_costs (user_id, created_at desc);
