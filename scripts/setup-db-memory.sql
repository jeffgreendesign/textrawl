-- Textrawl Persistent Memory Schema (OpenAI Version)
-- Use this when using OpenAI embeddings (text-embedding-3-small, 1536 dimensions)
-- For Ollama users: use setup-db-memory-ollama.sql instead
-- Run this in Supabase SQL Editor after setting up the base schema with setup-db.sql

-- ============================================
-- Memory Entities (people, concepts, preferences)
-- ============================================
CREATE TABLE IF NOT EXISTS memory_entities (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  name TEXT NOT NULL,
  entity_type TEXT NOT NULL CHECK (entity_type IN ('person', 'concept', 'project', 'preference', 'fact', 'location', 'organization')),
  description TEXT,
  embedding VECTOR(1536), -- For semantic entity search
  metadata JSONB DEFAULT '{}',
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW(),
  UNIQUE(name, entity_type)
);

-- ============================================
-- Memory Observations (atomic facts about entities)
-- ============================================
CREATE TABLE IF NOT EXISTS memory_observations (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  entity_id UUID NOT NULL REFERENCES memory_entities(id) ON DELETE CASCADE,
  content TEXT NOT NULL,
  source TEXT DEFAULT 'conversation', -- conversation, note, document, manual
  confidence FLOAT DEFAULT 1.0 CHECK (confidence >= 0 AND confidence <= 1),
  valid_from TIMESTAMPTZ DEFAULT NOW(),
  valid_until TIMESTAMPTZ, -- NULL means indefinitely valid
  embedding VECTOR(1536),
  metadata JSONB DEFAULT '{}',
  created_at TIMESTAMPTZ DEFAULT NOW()
);

-- ============================================
-- Memory Relations (connections between entities)
-- ============================================
CREATE TABLE IF NOT EXISTS memory_relations (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  from_entity_id UUID NOT NULL REFERENCES memory_entities(id) ON DELETE CASCADE,
  to_entity_id UUID NOT NULL REFERENCES memory_entities(id) ON DELETE CASCADE,
  relation_type TEXT NOT NULL, -- works_at, prefers, knows, created, part_of, related_to
  strength FLOAT DEFAULT 1.0 CHECK (strength >= 0 AND strength <= 1),
  metadata JSONB DEFAULT '{}',
  created_at TIMESTAMPTZ DEFAULT NOW(),
  UNIQUE(from_entity_id, to_entity_id, relation_type),
  CHECK (from_entity_id != to_entity_id)
);

-- ============================================
-- Indexes for performance
-- ============================================

-- Entity indexes
CREATE INDEX IF NOT EXISTS memory_entities_type_idx ON memory_entities(entity_type);
CREATE INDEX IF NOT EXISTS memory_entities_name_idx ON memory_entities(name);
CREATE INDEX IF NOT EXISTS memory_entities_created_idx ON memory_entities(created_at DESC);
CREATE INDEX IF NOT EXISTS memory_entities_embedding_idx ON memory_entities
  USING hnsw (embedding vector_cosine_ops);

-- Observation indexes
CREATE INDEX IF NOT EXISTS memory_observations_entity_idx ON memory_observations(entity_id);
CREATE INDEX IF NOT EXISTS memory_observations_source_idx ON memory_observations(source);
CREATE INDEX IF NOT EXISTS memory_observations_created_idx ON memory_observations(created_at DESC);
CREATE INDEX IF NOT EXISTS memory_observations_valid_idx ON memory_observations(valid_from, valid_until);
CREATE INDEX IF NOT EXISTS memory_observations_embedding_idx ON memory_observations
  USING hnsw (embedding vector_cosine_ops);

-- Relation indexes
CREATE INDEX IF NOT EXISTS memory_relations_from_idx ON memory_relations(from_entity_id);
CREATE INDEX IF NOT EXISTS memory_relations_to_idx ON memory_relations(to_entity_id);
CREATE INDEX IF NOT EXISTS memory_relations_type_idx ON memory_relations(relation_type);

-- Full-text search on observations
ALTER TABLE memory_observations ADD COLUMN IF NOT EXISTS fts TSVECTOR
  GENERATED ALWAYS AS (to_tsvector('english', content)) STORED;
CREATE INDEX IF NOT EXISTS memory_observations_fts_idx ON memory_observations USING gin(fts);

-- ============================================
-- Updated_at trigger for entities
-- ============================================
DROP TRIGGER IF EXISTS memory_entities_updated_at ON memory_entities;
CREATE TRIGGER memory_entities_updated_at
  BEFORE UPDATE ON memory_entities
  FOR EACH ROW EXECUTE FUNCTION update_updated_at();

-- ============================================
-- Memory Search Functions
-- ============================================

-- Drop existing functions to avoid PostgREST overload errors when signatures change
DROP FUNCTION IF EXISTS memory_semantic_search(VECTOR(1536), INT, TEXT[], BOOLEAN);
DROP FUNCTION IF EXISTS memory_hybrid_search(TEXT, VECTOR(1536), INT, FLOAT, FLOAT, INT, TEXT[], BOOLEAN);
DROP FUNCTION IF EXISTS get_entity_context(TEXT, BOOLEAN);
DROP FUNCTION IF EXISTS cleanup_expired_observations();

-- Semantic search across memories (entities + observations)
CREATE OR REPLACE FUNCTION memory_semantic_search(
  query_embedding VECTOR(1536),
  match_count INT DEFAULT 10,
  entity_types TEXT[] DEFAULT NULL,
  include_expired BOOLEAN DEFAULT FALSE
)
RETURNS TABLE (
  entity_id UUID,
  entity_name TEXT,
  entity_type TEXT,
  observation_id UUID,
  observation_content TEXT,
  source TEXT,
  confidence FLOAT,
  similarity FLOAT
)
LANGUAGE SQL
AS $$
SELECT
  e.id AS entity_id,
  e.name AS entity_name,
  e.entity_type,
  o.id AS observation_id,
  o.content AS observation_content,
  o.source,
  o.confidence,
  1 - (o.embedding <=> query_embedding) AS similarity
FROM memory_observations o
JOIN memory_entities e ON o.entity_id = e.id
WHERE
  o.embedding IS NOT NULL
  AND (entity_types IS NULL OR e.entity_type = ANY(entity_types))
  AND (include_expired OR o.valid_until IS NULL OR o.valid_until > NOW())
ORDER BY o.embedding <=> query_embedding
LIMIT match_count;
$$;

-- Hybrid memory search (FTS + semantic)
CREATE OR REPLACE FUNCTION memory_hybrid_search(
  query_text TEXT,
  query_embedding VECTOR(1536),
  match_count INT DEFAULT 10,
  full_text_weight FLOAT DEFAULT 1.0,
  semantic_weight FLOAT DEFAULT 1.0,
  rrf_k INT DEFAULT 60,
  entity_types TEXT[] DEFAULT NULL,
  include_expired BOOLEAN DEFAULT FALSE
)
RETURNS TABLE (
  entity_id UUID,
  entity_name TEXT,
  entity_type TEXT,
  observation_id UUID,
  observation_content TEXT,
  source TEXT,
  confidence FLOAT,
  score FLOAT
)
LANGUAGE SQL
AS $$
WITH full_text AS (
  SELECT
    o.id,
    o.entity_id,
    ROW_NUMBER() OVER (ORDER BY ts_rank_cd(o.fts, websearch_to_tsquery(query_text)) DESC) AS rank_ix
  FROM memory_observations o
  JOIN memory_entities e ON o.entity_id = e.id
  WHERE
    o.fts @@ websearch_to_tsquery(query_text)
    AND (entity_types IS NULL OR e.entity_type = ANY(entity_types))
    AND (include_expired OR o.valid_until IS NULL OR o.valid_until > NOW())
  LIMIT match_count * 2
),
semantic AS (
  SELECT
    o.id,
    o.entity_id,
    ROW_NUMBER() OVER (ORDER BY o.embedding <=> query_embedding) AS rank_ix
  FROM memory_observations o
  JOIN memory_entities e ON o.entity_id = e.id
  WHERE
    o.embedding IS NOT NULL
    AND (entity_types IS NULL OR e.entity_type = ANY(entity_types))
    AND (include_expired OR o.valid_until IS NULL OR o.valid_until > NOW())
  ORDER BY o.embedding <=> query_embedding
  LIMIT match_count * 2
)
SELECT
  e.id AS entity_id,
  e.name AS entity_name,
  e.entity_type,
  o.id AS observation_id,
  o.content AS observation_content,
  o.source,
  o.confidence,
  (
    COALESCE(1.0 / (rrf_k + ft.rank_ix), 0.0) * full_text_weight +
    COALESCE(1.0 / (rrf_k + s.rank_ix), 0.0) * semantic_weight
  ) AS score
FROM full_text ft
FULL OUTER JOIN semantic s ON ft.id = s.id
JOIN memory_observations o ON COALESCE(ft.id, s.id) = o.id
JOIN memory_entities e ON o.entity_id = e.id
ORDER BY score DESC
LIMIT match_count;
$$;

-- Get entity with all observations and relations
CREATE OR REPLACE FUNCTION get_entity_context(
  target_entity_name TEXT,
  include_related BOOLEAN DEFAULT TRUE
)
RETURNS TABLE (
  entity_id UUID,
  entity_name TEXT,
  entity_type TEXT,
  entity_description TEXT,
  observations JSONB,
  outgoing_relations JSONB,
  incoming_relations JSONB
)
LANGUAGE SQL
AS $$
WITH target AS (
  SELECT id, name, entity_type, description
  FROM memory_entities
  WHERE LOWER(name) = LOWER(target_entity_name)
  LIMIT 1
),
entity_observations AS (
  SELECT
    t.id AS entity_id,
    COALESCE(jsonb_agg(
      jsonb_build_object(
        'id', o.id,
        'content', o.content,
        'source', o.source,
        'confidence', o.confidence,
        'created_at', o.created_at
      ) ORDER BY o.created_at DESC
    ) FILTER (WHERE o.id IS NOT NULL), '[]'::jsonb) AS observations
  FROM target t
  LEFT JOIN memory_observations o ON o.entity_id = t.id
    AND (o.valid_until IS NULL OR o.valid_until > NOW())
  GROUP BY t.id
),
outgoing AS (
  SELECT
    t.id AS entity_id,
    COALESCE(jsonb_agg(
      jsonb_build_object(
        'relation_type', r.relation_type,
        'to_entity', e.name,
        'to_entity_type', e.entity_type,
        'strength', r.strength
      )
    ) FILTER (WHERE r.id IS NOT NULL), '[]'::jsonb) AS relations
  FROM target t
  LEFT JOIN memory_relations r ON r.from_entity_id = t.id
  LEFT JOIN memory_entities e ON r.to_entity_id = e.id
  WHERE include_related
  GROUP BY t.id
),
incoming AS (
  SELECT
    t.id AS entity_id,
    COALESCE(jsonb_agg(
      jsonb_build_object(
        'relation_type', r.relation_type,
        'from_entity', e.name,
        'from_entity_type', e.entity_type,
        'strength', r.strength
      )
    ) FILTER (WHERE r.id IS NOT NULL), '[]'::jsonb) AS relations
  FROM target t
  LEFT JOIN memory_relations r ON r.to_entity_id = t.id
  LEFT JOIN memory_entities e ON r.from_entity_id = e.id
  WHERE include_related
  GROUP BY t.id
)
SELECT
  t.id AS entity_id,
  t.name AS entity_name,
  t.entity_type,
  t.description AS entity_description,
  eo.observations,
  o.relations AS outgoing_relations,
  i.relations AS incoming_relations
FROM target t
LEFT JOIN entity_observations eo ON eo.entity_id = t.id
LEFT JOIN outgoing o ON o.entity_id = t.id
LEFT JOIN incoming i ON i.entity_id = t.id;
$$;

-- ============================================
-- Row Level Security (if needed)
-- ============================================
-- Uncomment and customize if multi-tenant support is needed

-- ALTER TABLE memory_entities ENABLE ROW LEVEL SECURITY;
-- ALTER TABLE memory_observations ENABLE ROW LEVEL SECURITY;
-- ALTER TABLE memory_relations ENABLE ROW LEVEL SECURITY;

-- CREATE POLICY "Service role full access to memory_entities"
--   ON memory_entities FOR ALL
--   USING (auth.role() = 'service_role');

-- CREATE POLICY "Service role full access to memory_observations"
--   ON memory_observations FOR ALL
--   USING (auth.role() = 'service_role');

-- CREATE POLICY "Service role full access to memory_relations"
--   ON memory_relations FOR ALL
--   USING (auth.role() = 'service_role');

-- ============================================
-- Cleanup function for expired observations
-- ============================================
CREATE OR REPLACE FUNCTION cleanup_expired_observations()
RETURNS INTEGER
LANGUAGE PLPGSQL
AS $$
DECLARE
  deleted_count INTEGER;
BEGIN
  DELETE FROM memory_observations
  WHERE valid_until IS NOT NULL AND valid_until < NOW();

  GET DIAGNOSTICS deleted_count = ROW_COUNT;
  RETURN deleted_count;
END;
$$;

-- Optional: Schedule cleanup (requires pg_cron extension)
-- SELECT cron.schedule('cleanup-expired-memories', '0 3 * * *', 'SELECT cleanup_expired_observations()');
