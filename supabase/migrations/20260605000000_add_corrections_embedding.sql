-- v2.2 self-improving loop: visual/semantic retrieval via pgvector embeddings.
-- Adds an embedding to each correction so generation can retrieve the *most
-- similar* past corrections (not just the most recent), so relevance improves
-- with volume instead of plateauing.

create extension if not exists vector;

-- 1536 dims = OpenAI text-embedding-3-small (stable dimension, Tier-1 cheap).
alter table public.listing_corrections
  add column if not exists embedding vector(1536);

-- HNSW (cosine) for nearest-neighbour search. Rows with a null embedding are
-- simply not indexed yet; the backfill function fills them in.
create index if not exists listing_corrections_embedding_idx
  on public.listing_corrections
  using hnsw (embedding vector_cosine_ops);

-- RLS-safe similarity search. security invoker + auth.uid() filter means a
-- caller only ever matches their OWN corrections (per-tenant isolation holds
-- even though pgvector ordering can't be expressed through PostgREST).
create or replace function public.match_listing_corrections(
  query_embedding vector(1536),
  match_count int default 8
)
returns table (
  id uuid,
  source text,
  category text,
  wrong_title text,
  corrected_title text,
  wrong_specifics jsonb,
  corrected_specifics jsonb,
  correction_note text,
  similarity float
)
language sql
stable
security invoker
set search_path = public
as $$
  select
    c.id,
    c.source,
    c.category,
    c.wrong_title,
    c.corrected_title,
    c.wrong_specifics,
    c.corrected_specifics,
    c.correction_note,
    1 - (c.embedding <=> query_embedding) as similarity
  from public.listing_corrections c
  where c.user_id = auth.uid()
    and c.embedding is not null
  order by c.embedding <=> query_embedding
  limit greatest(match_count, 1);
$$;

grant execute on function public.match_listing_corrections(vector, int) to authenticated;
