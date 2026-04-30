-- Textrawl Conversation Memory Schema (Google AI Version)
-- Use this when using Google AI embeddings with 3072 dimensions (gemini-embedding-2-preview)
-- For OpenAI users: use setup-db-conversation.sql
-- For Google AI users: use this file
-- For Ollama v1 users: use setup-db-conversation-ollama.sql
-- Run this in Supabase SQL Editor after setting up the base schema and memory schema

-- ============================================
-- Migration: resize embedding columns to VECTOR(3072)
-- ============================================
-- Existing installs (e.g. from text-embedding-004 with VECTOR(768), or any other dimension)
-- won't have their embedding columns updated by the CREATE TABLE IF NOT EXISTS below.
-- This block detects a mismatched dimension and recreates the columns.
-- NOTE: Switching embedding models means the old vectors are in a different vector space
-- and cannot be meaningfully resized. Old embeddings are dropped; re-embedding is required.
DO $$
BEGIN
  IF EXISTS (
    SELECT 1 FROM pg_attribute a
    JOIN pg_class c ON c.oid = a.attrelid
    JOIN pg_namespace n ON n.oid = c.relnamespace
    WHERE n.nspname = 'public'
      AND c.relname = 'conversation_sessions'
      AND a.attname = 'summary_embedding'
      AND a.atttypmod <> 3072
      AND a.attnum > 0
      AND NOT a.attisdropped
  ) THEN
    DROP INDEX IF EXISTS conversation_sessions_embedding_idx;
    ALTER TABLE conversation_sessions DROP COLUMN summary_embedding;
    ALTER TABLE conversation_sessions ADD COLUMN summary_embedding VECTOR(3072);
    RAISE NOTICE 'Resized conversation_sessions.summary_embedding to VECTOR(3072). Re-embedding required.';
  END IF;

  IF EXISTS (
    SELECT 1 FROM pg_attribute a
    JOIN pg_class c ON c.oid = a.attrelid
    JOIN pg_namespace n ON n.oid = c.relnamespace
    WHERE n.nspname = 'public'
      AND c.relname = 'conversation_turns'
      AND a.attname = 'embedding'
      AND a.atttypmod <> 3072
      AND a.attnum > 0
      AND NOT a.attisdropped
  ) THEN
    DROP INDEX IF EXISTS conversation_turns_embedding_idx;
    ALTER TABLE conversation_turns DROP COLUMN embedding;
    ALTER TABLE conversation_turns ADD COLUMN embedding VECTOR(3072);
    RAISE NOTICE 'Resized conversation_turns.embedding to VECTOR(3072). Re-embedding required.';
  END IF;
END $$;

-- ============================================
-- Conversation Sessions
-- ============================================
CREATE TABLE IF NOT EXISTS conversation_sessions (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  session_key TEXT UNIQUE,
  title TEXT,
  summary TEXT,
  summary_embedding VECTOR(3072),
  metadata JSONB DEFAULT '{}',
  turn_count INTEGER DEFAULT 0,
  last_activity TIMESTAMPTZ DEFAULT NOW(),
  created_at TIMESTAMPTZ DEFAULT NOW()
);

-- ============================================
-- Conversation Turns
-- ============================================
CREATE TABLE IF NOT EXISTS conversation_turns (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  session_id UUID NOT NULL REFERENCES conversation_sessions(id) ON DELETE CASCADE,
  role TEXT NOT NULL CHECK (role IN ('user', 'assistant', 'system')),
  content TEXT NOT NULL,
  embedding VECTOR(3072),
  turn_index INTEGER NOT NULL,
  token_count INTEGER,
  metadata JSONB DEFAULT '{}',
  created_at TIMESTAMPTZ DEFAULT NOW(),
  UNIQUE (session_id, turn_index)
);

-- ============================================
-- Indexes
-- ============================================
CREATE INDEX IF NOT EXISTS conversation_sessions_key_idx ON conversation_sessions(session_key);
CREATE INDEX IF NOT EXISTS conversation_sessions_activity_idx ON conversation_sessions(last_activity DESC);
CREATE INDEX IF NOT EXISTS conversation_sessions_created_idx ON conversation_sessions(created_at DESC);
CREATE INDEX IF NOT EXISTS conversation_sessions_embedding_idx ON conversation_sessions
  USING hnsw (summary_embedding vector_cosine_ops);

CREATE INDEX IF NOT EXISTS conversation_turns_session_idx ON conversation_turns(session_id);
CREATE INDEX IF NOT EXISTS conversation_turns_order_idx ON conversation_turns(session_id, turn_index);
CREATE INDEX IF NOT EXISTS conversation_turns_created_idx ON conversation_turns(created_at DESC);
CREATE INDEX IF NOT EXISTS conversation_turns_embedding_idx ON conversation_turns
  USING hnsw (embedding vector_cosine_ops);

ALTER TABLE conversation_turns ADD COLUMN IF NOT EXISTS fts TSVECTOR
  GENERATED ALWAYS AS (to_tsvector('english', content)) STORED;
CREATE INDEX IF NOT EXISTS conversation_turns_fts_idx ON conversation_turns USING gin(fts);

ALTER TABLE conversation_sessions ADD COLUMN IF NOT EXISTS summary_fts TSVECTOR
  GENERATED ALWAYS AS (to_tsvector('english', COALESCE(summary, ''))) STORED;
CREATE INDEX IF NOT EXISTS conversation_sessions_fts_idx ON conversation_sessions USING gin(summary_fts);

-- ============================================
-- Triggers
-- ============================================
CREATE OR REPLACE FUNCTION public.update_session_activity()
RETURNS TRIGGER
LANGUAGE plpgsql
SET search_path = 'public', 'extensions'
AS $$
BEGIN
  UPDATE public.conversation_sessions
  SET
    last_activity = NOW(),
    turn_count = (SELECT COUNT(*) FROM public.conversation_turns WHERE session_id = NEW.session_id)
  WHERE id = NEW.session_id;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS conversation_turns_activity ON conversation_turns;
CREATE TRIGGER conversation_turns_activity
  AFTER INSERT ON conversation_turns
  FOR EACH ROW EXECUTE FUNCTION update_session_activity();

-- Update turn_count when turns are deleted
CREATE OR REPLACE FUNCTION public.update_session_activity_on_delete()
RETURNS TRIGGER
LANGUAGE plpgsql
SET search_path = 'public', 'extensions'
AS $$
BEGIN
  UPDATE public.conversation_sessions
  SET turn_count = (SELECT COUNT(*) FROM public.conversation_turns WHERE session_id = OLD.session_id)
  WHERE id = OLD.session_id;
  RETURN OLD;
END;
$$;

DROP TRIGGER IF EXISTS conversation_turns_delete_activity ON conversation_turns;
CREATE TRIGGER conversation_turns_delete_activity
  AFTER DELETE ON conversation_turns
  FOR EACH ROW EXECUTE FUNCTION update_session_activity_on_delete();

-- ============================================
-- Search Functions (768 dimensions)
-- ============================================
DROP FUNCTION IF EXISTS conversation_semantic_search(VECTOR(3072), INT);
DROP FUNCTION IF EXISTS conversation_hybrid_search(TEXT, VECTOR(3072), INT, FLOAT, FLOAT, INT);
DROP FUNCTION IF EXISTS conversation_turn_search(TEXT, VECTOR(3072), INT, FLOAT, FLOAT, INT, UUID);

CREATE OR REPLACE FUNCTION public.conversation_semantic_search(
  query_embedding VECTOR(3072),
  match_count INT DEFAULT 10
)
RETURNS TABLE (
  session_id UUID,
  session_key TEXT,
  title TEXT,
  summary TEXT,
  turn_count INTEGER,
  last_activity TIMESTAMPTZ,
  score FLOAT
)
LANGUAGE SQL
SET search_path = 'public', 'extensions'
AS $$
SELECT
  cs.id AS session_id,
  cs.session_key,
  cs.title,
  cs.summary,
  cs.turn_count,
  cs.last_activity,
  1 - (cs.summary_embedding <=> query_embedding) AS score
FROM public.conversation_sessions cs
WHERE cs.summary_embedding IS NOT NULL
ORDER BY cs.summary_embedding <=> query_embedding
LIMIT match_count;
$$;

CREATE OR REPLACE FUNCTION public.conversation_hybrid_search(
  query_text TEXT,
  query_embedding VECTOR(3072),
  match_count INT DEFAULT 10,
  full_text_weight FLOAT DEFAULT 1.0,
  semantic_weight FLOAT DEFAULT 1.0,
  rrf_k INT DEFAULT 60
)
RETURNS TABLE (
  session_id UUID,
  session_key TEXT,
  title TEXT,
  summary TEXT,
  turn_count INTEGER,
  last_activity TIMESTAMPTZ,
  score FLOAT
)
LANGUAGE SQL
SET search_path = 'public', 'extensions'
AS $$
WITH full_text AS (
  SELECT cs.id, ROW_NUMBER() OVER (ORDER BY ts_rank_cd(cs.summary_fts, websearch_to_tsquery(query_text)) DESC) AS rank_ix
  FROM public.conversation_sessions cs
  WHERE cs.summary_fts @@ websearch_to_tsquery(query_text)
  LIMIT match_count * 2
),
semantic AS (
  SELECT cs.id, ROW_NUMBER() OVER (ORDER BY cs.summary_embedding <=> query_embedding) AS rank_ix
  FROM public.conversation_sessions cs
  WHERE cs.summary_embedding IS NOT NULL
  ORDER BY cs.summary_embedding <=> query_embedding
  LIMIT match_count * 2
)
SELECT
  cs.id AS session_id, cs.session_key, cs.title, cs.summary, cs.turn_count, cs.last_activity,
  (COALESCE(1.0 / (rrf_k + ft.rank_ix), 0.0) * full_text_weight + COALESCE(1.0 / (rrf_k + s.rank_ix), 0.0) * semantic_weight) AS score
FROM full_text ft
FULL OUTER JOIN semantic s ON ft.id = s.id
JOIN public.conversation_sessions cs ON COALESCE(ft.id, s.id) = cs.id
ORDER BY score DESC
LIMIT match_count;
$$;

CREATE OR REPLACE FUNCTION public.conversation_turn_search(
  query_text TEXT,
  query_embedding VECTOR(3072),
  match_count INT DEFAULT 20,
  full_text_weight FLOAT DEFAULT 1.0,
  semantic_weight FLOAT DEFAULT 1.0,
  rrf_k INT DEFAULT 60,
  filter_session_id UUID DEFAULT NULL
)
RETURNS TABLE (
  turn_id UUID,
  session_id UUID,
  role TEXT,
  content TEXT,
  turn_index INTEGER,
  created_at TIMESTAMPTZ,
  score FLOAT
)
LANGUAGE SQL
SET search_path = 'public', 'extensions'
AS $$
WITH full_text AS (
  SELECT ct.id, ROW_NUMBER() OVER (ORDER BY ts_rank_cd(ct.fts, websearch_to_tsquery(query_text)) DESC) AS rank_ix
  FROM public.conversation_turns ct
  WHERE ct.fts @@ websearch_to_tsquery(query_text) AND (filter_session_id IS NULL OR ct.session_id = filter_session_id)
  LIMIT match_count * 2
),
semantic AS (
  SELECT ct.id, ROW_NUMBER() OVER (ORDER BY ct.embedding <=> query_embedding) AS rank_ix
  FROM public.conversation_turns ct
  WHERE ct.embedding IS NOT NULL AND (filter_session_id IS NULL OR ct.session_id = filter_session_id)
  ORDER BY ct.embedding <=> query_embedding
  LIMIT match_count * 2
)
SELECT
  ct.id AS turn_id, ct.session_id, ct.role, ct.content, ct.turn_index, ct.created_at,
  (COALESCE(1.0 / (rrf_k + ft.rank_ix), 0.0) * full_text_weight + COALESCE(1.0 / (rrf_k + s.rank_ix), 0.0) * semantic_weight) AS score
FROM full_text ft
FULL OUTER JOIN semantic s ON ft.id = s.id
JOIN public.conversation_turns ct ON COALESCE(ft.id, s.id) = ct.id
ORDER BY score DESC
LIMIT match_count;
$$;

CREATE OR REPLACE FUNCTION public.get_recent_conversations(result_limit INT DEFAULT 20, result_offset INT DEFAULT 0)
RETURNS TABLE (session_id UUID, session_key TEXT, title TEXT, summary TEXT, turn_count INTEGER, last_activity TIMESTAMPTZ, created_at TIMESTAMPTZ)
LANGUAGE SQL
SET search_path = 'public', 'extensions'
AS $$
SELECT cs.id, cs.session_key, cs.title, cs.summary, cs.turn_count, cs.last_activity, cs.created_at
FROM public.conversation_sessions cs ORDER BY cs.last_activity DESC LIMIT result_limit OFFSET result_offset;
$$;

CREATE OR REPLACE FUNCTION public.cleanup_old_conversations(days_to_keep INT DEFAULT 90)
RETURNS INTEGER
LANGUAGE PLPGSQL
SET search_path = 'public', 'extensions'
AS $$
DECLARE deleted_count INTEGER;
BEGIN
  DELETE FROM public.conversation_sessions WHERE last_activity < NOW() - (days_to_keep || ' days')::INTERVAL;
  GET DIAGNOSTICS deleted_count = ROW_COUNT;
  RETURN deleted_count;
END;
$$;

-- ============================================
-- Row Level Security
-- ============================================
ALTER TABLE conversation_sessions ENABLE ROW LEVEL SECURITY;
ALTER TABLE conversation_turns ENABLE ROW LEVEL SECURITY;
ALTER TABLE conversation_sessions FORCE ROW LEVEL SECURITY;
ALTER TABLE conversation_turns FORCE ROW LEVEL SECURITY;

-- Permissive policies scoped to service_role
CREATE POLICY "Service role access to conversation_sessions"
  ON conversation_sessions FOR ALL TO service_role USING (true) WITH CHECK (true);
CREATE POLICY "Service role access to conversation_turns"
  ON conversation_turns FOR ALL TO service_role USING (true) WITH CHECK (true);

-- Restrictive policies
CREATE POLICY "Deny anon access to conversation_sessions"
  ON conversation_sessions AS RESTRICTIVE FOR ALL TO anon USING (false);
CREATE POLICY "Deny authenticated access to conversation_sessions"
  ON conversation_sessions AS RESTRICTIVE FOR ALL TO authenticated USING (false);
CREATE POLICY "Deny anon access to conversation_turns"
  ON conversation_turns AS RESTRICTIVE FOR ALL TO anon USING (false);
CREATE POLICY "Deny authenticated access to conversation_turns"
  ON conversation_turns AS RESTRICTIVE FOR ALL TO authenticated USING (false);

-- Revoke permissions
REVOKE ALL ON TABLE conversation_sessions FROM anon, authenticated;
REVOKE ALL ON TABLE conversation_turns FROM anon, authenticated;
REVOKE EXECUTE ON FUNCTION conversation_semantic_search FROM anon, authenticated;
REVOKE EXECUTE ON FUNCTION conversation_hybrid_search FROM anon, authenticated;
REVOKE EXECUTE ON FUNCTION conversation_turn_search FROM anon, authenticated;
REVOKE EXECUTE ON FUNCTION get_recent_conversations FROM anon, authenticated;
REVOKE EXECUTE ON FUNCTION cleanup_old_conversations FROM anon, authenticated;

-- Grant to service_role
GRANT ALL ON TABLE conversation_sessions TO service_role;
GRANT ALL ON TABLE conversation_turns TO service_role;
GRANT EXECUTE ON FUNCTION conversation_semantic_search TO service_role;
GRANT EXECUTE ON FUNCTION conversation_hybrid_search TO service_role;
GRANT EXECUTE ON FUNCTION conversation_turn_search TO service_role;
GRANT EXECUTE ON FUNCTION get_recent_conversations TO service_role;
GRANT EXECUTE ON FUNCTION cleanup_old_conversations TO service_role;
