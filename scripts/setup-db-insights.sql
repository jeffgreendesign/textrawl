-- =============================================================================
-- Proactive Insights Schema
-- =============================================================================
-- Run this in Supabase SQL Editor after setup-db.sql
--
-- Provides:
--   - insight_queue: tracks batch processing state (counter + debounce)
--   - proactive_insights: stores discovered cross-source connections
--   - insight_queue_increment(): atomically bumps the counter on chunk insert
-- =============================================================================

-- ---------------------------------------------------------------------------
-- 1. Insight queue (singleton row tracks pending batch state)
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS insight_queue (
  id          INTEGER PRIMARY KEY DEFAULT 1 CHECK (id = 1),   -- singleton
  chunks_pending  INTEGER   NOT NULL DEFAULT 0,
  last_insert_at  TIMESTAMPTZ,
  last_scan_at    TIMESTAMPTZ,
  is_processing   BOOLEAN   NOT NULL DEFAULT FALSE,
  processing_started_at TIMESTAMPTZ,   -- when the current scan acquired the lock (NULL when idle)
  created_at      TIMESTAMPTZ DEFAULT now()
);

-- Seed the singleton row
INSERT INTO insight_queue (id) VALUES (1) ON CONFLICT (id) DO NOTHING;

-- Migration: add processing_started_at to pre-existing deployments
ALTER TABLE insight_queue ADD COLUMN IF NOT EXISTS processing_started_at TIMESTAMPTZ;

-- ---------------------------------------------------------------------------
-- 2. Proactive insights table
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS proactive_insights (
  id            UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  insight_type  TEXT NOT NULL CHECK (insight_type IN (
    'cross_source',       -- connection between different source types
    'theme_cluster',      -- recurring theme across documents
    'entity_bridge',      -- entity appearing across unrelated contexts
    'temporal_pattern',   -- same topic resurfacing over time
    'outlier'             -- content unlike anything else in the DB
  )),
  title         TEXT NOT NULL,
  summary       TEXT NOT NULL,
  evidence      JSONB NOT NULL DEFAULT '[]',   -- array of {chunkId, documentId, content, score}
  entities      JSONB DEFAULT '[]',            -- related entity names
  embedding     vector(1536),                  -- for semantic retrieval of insights
  batch_id      UUID,                          -- groups insights from the same scan
  status        TEXT NOT NULL DEFAULT 'new' CHECK (status IN ('new', 'seen', 'dismissed')),
  created_at    TIMESTAMPTZ DEFAULT now()
);

-- HNSW index for semantic search over insights
CREATE INDEX IF NOT EXISTS idx_proactive_insights_embedding
  ON proactive_insights USING hnsw (embedding vector_cosine_ops);

CREATE INDEX IF NOT EXISTS idx_proactive_insights_status
  ON proactive_insights (status, created_at DESC);

CREATE INDEX IF NOT EXISTS idx_proactive_insights_type
  ON proactive_insights (insight_type, created_at DESC);

-- ---------------------------------------------------------------------------
-- 3. Atomically increment the queue counter (called after chunk inserts)
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.insight_queue_increment(chunk_count INTEGER DEFAULT 1)
RETURNS void
LANGUAGE plpgsql
SET search_path = 'public', 'extensions'
AS $$
BEGIN
  UPDATE public.insight_queue
  SET chunks_pending = chunks_pending + chunk_count,
      last_insert_at = now()
  WHERE id = 1;
END;
$$;

-- ---------------------------------------------------------------------------
-- 4. Check if a scan should run (threshold reached + debounce elapsed)
-- ---------------------------------------------------------------------------
-- Drop the older 2-arg signature so a 2-arg call cannot become ambiguous
-- against the 3-arg version below (both would match via the stale_seconds default).
DROP FUNCTION IF EXISTS public.insight_queue_check(INTEGER, INTEGER);

CREATE OR REPLACE FUNCTION public.insight_queue_check(
  threshold INTEGER DEFAULT 50,
  debounce_seconds INTEGER DEFAULT 300,
  stale_seconds INTEGER DEFAULT 1800
)
RETURNS TABLE (should_scan BOOLEAN, pending INTEGER)
LANGUAGE plpgsql
SET search_path = 'public', 'extensions'
AS $$
BEGIN
  RETURN QUERY
  SELECT
    (q.chunks_pending >= threshold
     -- Not currently processing, OR the lock is stale (a prior scan was killed
     -- mid-flight and never cleared the flag — common on CPU-throttled serverless).
     AND (q.is_processing = FALSE
          OR q.processing_started_at IS NULL
          OR q.processing_started_at < now() - (stale_seconds || ' seconds')::interval)
     AND (q.last_insert_at IS NULL
          OR q.last_insert_at < now() - (debounce_seconds || ' seconds')::interval)
    ) AS should_scan,
    q.chunks_pending AS pending
  FROM public.insight_queue q
  WHERE q.id = 1;
END;
$$;

-- ---------------------------------------------------------------------------
-- 5. Semantic search over insights
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.insight_semantic_search(
  query_embedding vector(1536),
  match_count INTEGER DEFAULT 10,
  status_filter TEXT DEFAULT NULL
)
RETURNS TABLE (
  id UUID,
  insight_type TEXT,
  title TEXT,
  summary TEXT,
  evidence JSONB,
  entities JSONB,
  status TEXT,
  created_at TIMESTAMPTZ,
  score FLOAT
)
LANGUAGE plpgsql
SET search_path = 'public', 'extensions'
AS $$
BEGIN
  RETURN QUERY
  SELECT
    pi.id,
    pi.insight_type,
    pi.title,
    pi.summary,
    pi.evidence,
    pi.entities,
    pi.status,
    pi.created_at,
    1 - (pi.embedding <=> query_embedding) AS score
  FROM public.proactive_insights pi
  WHERE pi.embedding IS NOT NULL
    AND (status_filter IS NULL OR pi.status = status_filter)
  ORDER BY pi.embedding <=> query_embedding
  LIMIT match_count;
END;
$$;

-- ---------------------------------------------------------------------------
-- 6. RLS (deny anon/authenticated, service role bypasses)
-- ---------------------------------------------------------------------------
ALTER TABLE insight_queue ENABLE ROW LEVEL SECURITY;
ALTER TABLE proactive_insights ENABLE ROW LEVEL SECURITY;

CREATE POLICY insight_queue_deny_anon ON insight_queue
  FOR ALL TO anon, authenticated USING (false);

CREATE POLICY proactive_insights_deny_anon ON proactive_insights
  FOR ALL TO anon, authenticated USING (false);

REVOKE ALL ON insight_queue FROM anon, authenticated;
REVOKE ALL ON proactive_insights FROM anon, authenticated;
