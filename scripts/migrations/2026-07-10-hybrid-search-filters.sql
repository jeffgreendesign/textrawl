-- Migration: push search filters into hybrid_search() + pgvector 0.8 iterative scans
--
-- Adds source_type / content_type / tags predicates to hybrid_search so filtered
-- searches no longer post-filter in the app (which could return 0 results when the
-- matching chunks fell outside the RRF fetch window). Backs the JSONB predicates
-- with a GIN index on documents.metadata.
--
-- Idempotent; safe to re-run.
--
-- PROVIDER NOTE: the function below is the OpenAI 1536-dim variant. On other
-- providers, either re-run your matching scripts/setup-db*.sql (idempotent), or
-- change BOTH vector(1536) occurrences below to your dimension:
--   Google gemini-embedding      -> vector(3072)
--   Ollama nomic-embed-text       -> vector(1024)
--   Ollama nomic-embed-text-v2-moe-> vector(768)
--
-- PGVECTOR NOTE: iterative index scans require pgvector >= 0.8. They are enabled
-- per-connection by the server (see src/db/pg-client.ts), guarded so older
-- pgvector still works — this migration only needs the SQL below.

-- GIN index on documents.metadata backs the tag/content_type predicates.
create index if not exists documents_metadata_gin_idx on documents using gin (metadata jsonb_path_ops);

-- Drop the old 6-arg signature so 5-/6-arg calls cannot become ambiguous against
-- the 9-arg version below (the added filter args all have defaults).
drop function if exists public.hybrid_search(text, vector(1536), int, float, float, int);

create or replace function public.hybrid_search(
  query_text text,
  query_embedding vector(1536),
  match_count int default 10,
  full_text_weight float default 1.0,
  semantic_weight float default 1.0,
  rrf_k int default 60,
  filter_source_type text default null,
  filter_content_type text default null,
  filter_tags jsonb default null
)
returns table (
  chunk_id uuid,
  document_id uuid,
  content text,
  document_title text,
  source_type text,
  document_metadata jsonb,
  score float
)
language sql
set search_path = 'public', 'extensions'
as $$
with full_text as (
  select
    c.id,
    c.document_id,
    row_number() over (order by ts_rank_cd(d.fts, websearch_to_tsquery(query_text)) desc) as rank_ix
  from public.chunks c
  join public.documents d on c.document_id = d.id
  where d.fts @@ websearch_to_tsquery(query_text)
    and (filter_source_type is null or d.source_type = filter_source_type)
    and (filter_content_type is null or d.metadata->>'content_type' = filter_content_type)
    and (filter_tags is null or d.metadata->'tags' @> filter_tags)
  limit match_count * 2
),
semantic as (
  -- Filters live inside the CTE (not after fusion) so a selective filter is never
  -- starved by the match_count*2 window; pgvector >= 0.8 iterative scans keep the
  -- HNSW scan going until the filtered limit is met.
  select
    c.id,
    c.document_id,
    row_number() over (order by c.embedding <=> query_embedding) as rank_ix
  from public.chunks c
  join public.documents d on c.document_id = d.id
  where c.embedding is not null
    and (filter_source_type is null or d.source_type = filter_source_type)
    and (filter_content_type is null or d.metadata->>'content_type' = filter_content_type)
    and (filter_tags is null or d.metadata->'tags' @> filter_tags)
  order by c.embedding <=> query_embedding
  limit match_count * 2
)
select
  coalesce(ft.id, s.id) as chunk_id,
  coalesce(ft.document_id, s.document_id) as document_id,
  c.content,
  d.title as document_title,
  d.source_type,
  d.metadata as document_metadata,
  (
    coalesce(1.0 / (rrf_k + ft.rank_ix), 0.0) * full_text_weight +
    coalesce(1.0 / (rrf_k + s.rank_ix), 0.0) * semantic_weight
  ) as score
from full_text ft
full outer join semantic s on ft.id = s.id
join public.chunks c on coalesce(ft.id, s.id) = c.id
join public.documents d on c.document_id = d.id
order by score desc
limit match_count;
$$;
