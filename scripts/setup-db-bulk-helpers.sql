-- Bulk Upload Helper Functions
-- Run this in Supabase SQL Editor to enable --drop-index support in the upload CLI.
-- These functions allow the CLI to drop and recreate the HNSW index via .rpc() calls,
-- which dramatically speeds up bulk vector inserts by avoiding per-row index maintenance.

-- Drop the HNSW index on chunks (for bulk inserts)
create or replace function public.drop_chunks_hnsw_index()
returns void
language plpgsql
security definer
set search_path = 'public'
as $$
begin
  drop index if exists chunks_embedding_idx;
end;
$$;

-- Recreate the HNSW index on chunks (after bulk inserts)
create or replace function public.create_chunks_hnsw_index()
returns void
language plpgsql
security definer
set search_path = 'public', 'extensions'
as $$
begin
  create index if not exists chunks_embedding_idx on chunks
    using hnsw (embedding vector_cosine_ops);
end;
$$;
