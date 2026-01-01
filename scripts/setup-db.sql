-- Textrawl Database Schema
-- Run this in Supabase SQL Editor after creating your project

-- Enable required extensions
create extension if not exists vector with schema extensions;

-- Documents table (source of truth)
create table if not exists documents (
  id uuid primary key default gen_random_uuid(),
  title text not null,
  source_type text not null check (source_type in ('note', 'file', 'url')),
  source_url text,
  file_path text,
  raw_content text not null,
  metadata jsonb default '{}',
  -- Full-text search vector (auto-generated)
  fts tsvector generated always as (
    setweight(to_tsvector('english', coalesce(title, '')), 'A') ||
    setweight(to_tsvector('english', coalesce(raw_content, '')), 'B')
  ) stored,
  created_at timestamptz default now(),
  updated_at timestamptz default now()
);

-- Chunks table with embeddings
create table if not exists chunks (
  id uuid primary key default gen_random_uuid(),
  document_id uuid not null references documents(id) on delete cascade,
  content text not null,
  chunk_index integer not null,
  start_offset integer,
  end_offset integer,
  embedding vector(1536), -- text-embedding-3-small dimension
  metadata jsonb default '{}',
  created_at timestamptz default now()
);

-- Indexes for performance
create index if not exists documents_fts_idx on documents using gin(fts);
create index if not exists documents_source_type_idx on documents(source_type);
create index if not exists documents_created_at_idx on documents(created_at desc);

create index if not exists chunks_document_id_idx on chunks(document_id);
create index if not exists chunks_chunk_index_idx on chunks(document_id, chunk_index);

-- HNSW index for vector similarity search (faster than IVFFlat for smaller datasets)
create index if not exists chunks_embedding_idx on chunks
  using hnsw (embedding vector_cosine_ops);

-- Hybrid search function using Reciprocal Rank Fusion (RRF)
create or replace function hybrid_search(
  query_text text,
  query_embedding vector(1536),
  match_count int default 10,
  full_text_weight float default 1.0,
  semantic_weight float default 1.0,
  rrf_k int default 60
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
as $$
with full_text as (
  -- Full-text search ranked results
  select
    c.id,
    c.document_id,
    row_number() over (order by ts_rank_cd(d.fts, websearch_to_tsquery(query_text)) desc) as rank_ix
  from chunks c
  join documents d on c.document_id = d.id
  where d.fts @@ websearch_to_tsquery(query_text)
  limit match_count * 2
),
semantic as (
  -- Semantic search ranked results
  select
    id,
    document_id,
    row_number() over (order by embedding <=> query_embedding) as rank_ix
  from chunks
  where embedding is not null
  order by embedding <=> query_embedding
  limit match_count * 2
)
-- Combine with RRF scoring
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
join chunks c on coalesce(ft.id, s.id) = c.id
join documents d on c.document_id = d.id
order by score desc
limit match_count;
$$;

-- Semantic-only search function (when full-text query is empty)
create or replace function semantic_search(
  query_embedding vector(1536),
  match_count int default 10
)
returns table (
  chunk_id uuid,
  document_id uuid,
  content text,
  document_title text,
  source_type text,
  document_metadata jsonb,
  similarity float
)
language sql
as $$
select
  c.id as chunk_id,
  c.document_id,
  c.content,
  d.title as document_title,
  d.source_type,
  d.metadata as document_metadata,
  1 - (c.embedding <=> query_embedding) as similarity
from chunks c
join documents d on c.document_id = d.id
where c.embedding is not null
order by c.embedding <=> query_embedding
limit match_count;
$$;

-- Updated_at trigger function
create or replace function update_updated_at()
returns trigger as $$
begin
  new.updated_at = now();
  return new;
end;
$$ language plpgsql;

-- Apply trigger to documents table
drop trigger if exists documents_updated_at on documents;
create trigger documents_updated_at
  before update on documents
  for each row execute function update_updated_at();

-- Create storage bucket for file uploads (run in Supabase dashboard or via API)
-- Note: This needs to be done via Supabase dashboard or storage API
-- insert into storage.buckets (id, name, public) values ('documents', 'documents', false);
