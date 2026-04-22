-- Add user_id to crosspost_jobs so agents can fetch per-user credentials at runtime
alter table public.crosspost_jobs
  add column if not exists user_id uuid references auth.users(id);

create index if not exists crosspost_jobs_user_id_idx
  on public.crosspost_jobs (user_id);
