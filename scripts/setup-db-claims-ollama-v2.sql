-- =============================================================================
-- Source-Backed Claims Schema (Ollama, 768d)
-- =============================================================================
-- Run this in the Supabase SQL Editor / via psql AFTER setup-db-ollama-v2.sql.
--
-- INERT FOUNDATION: this PR establishes storage only. Nothing in the server
-- reads from or writes to this table yet — no extraction (LLM), no queue, no
-- MCP tools, no API routes, no search fusion, no dashboard. A future PR adds
-- the writer that resolves a claim's quote against chunks.content and persists
-- only verified claims.
--
-- PROVENANCE INVARIANT: a claim is anchored to a single chunk. source_quote is
-- a verbatim slice of chunks.content, and (source_start_offset, source_end_offset)
-- are UTF-16 code-unit indices into chunks.content — NOT documents.raw_content.
-- The chunker normalizes (\r\n -> \n) and trims before computing chunk offsets,
-- so only chunks.content offsets round-trip (see src/utils/source-span.ts).
--
-- NOTE: embedding is kept as a nullable vector(768) column for forward
-- compatibility, but NO vector (HNSW) index is created here. Provider-safe
-- vector indexes are deferred to the future retrieval PR. Every provider variant
-- is now <= 1536d, so all of them are HNSW-indexable when that PR lands.
-- =============================================================================

-- ---------------------------------------------------------------------------
-- Prerequisite: composite-unique target on chunks.
-- A claim's (document_id, chunk_id) must be a real pair, not two independently
-- valid ids. Enforcing that with a foreign key requires a unique index on the
-- referenced (document_id, id) columns. chunks.id is already unique (PK), so
-- this index always builds and only adds the composite the FK below targets.
-- Owned by the claims feature so the base setup-db*.sql ingestion path is
-- untouched for deployments that do not enable claims.
-- ---------------------------------------------------------------------------
CREATE UNIQUE INDEX IF NOT EXISTS chunks_document_id_id_key ON chunks(document_id, id);

-- ---------------------------------------------------------------------------
-- Claims table
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS claims (
  id                  UUID PRIMARY KEY DEFAULT gen_random_uuid(),

  -- Claim content
  claim_text          TEXT NOT NULL,
  question            TEXT,                       -- nullable: the question this claim answers, if any

  -- Provenance (anchored to a verified span in chunks.content)
  document_id         UUID NOT NULL REFERENCES documents(id) ON DELETE CASCADE,
  chunk_id            UUID NOT NULL,              -- FK is the composite (document_id, chunk_id) below
  source_quote        TEXT    NOT NULL,
  source_start_offset INTEGER NOT NULL,           -- UTF-16 index into chunks.content (inclusive)
  source_end_offset   INTEGER NOT NULL,           -- UTF-16 index into chunks.content (exclusive)

  -- Review / lifecycle
  confidence          REAL,                       -- nullable; 0..1 when present
  status              TEXT NOT NULL DEFAULT 'unreviewed'
                        CHECK (status IN ('unreviewed', 'approved', 'rejected')),
  state               TEXT NOT NULL DEFAULT 'current'
                        CHECK (state IN ('current', 'stale', 'conflicting', 'superseded')),
  superseded_by       UUID REFERENCES claims(id) ON DELETE SET NULL,

  -- Classification / annotation
  tags                TEXT[] NOT NULL DEFAULT '{}',
  entities            JSONB  NOT NULL DEFAULT '[]',
  sensitivity         TEXT NOT NULL DEFAULT 'normal'
                        CHECK (sensitivity IN ('normal', 'sensitive', 'restricted')),

  -- Retrieval (unused this PR; nullable, backfilled by a future retrieval PR)
  embedding           vector(768),                -- Ollama nomic-embed-text-v2-moe

  -- Full-text search (auto-generated; weighted claim > question > quote)
  fts tsvector GENERATED ALWAYS AS (
    setweight(to_tsvector('english', coalesce(claim_text, '')),   'A') ||
    setweight(to_tsvector('english', coalesce(question, '')),     'B') ||
    setweight(to_tsvector('english', coalesce(source_quote, '')), 'C')
  ) STORED,

  metadata            JSONB NOT NULL DEFAULT '{}',
  created_at          TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at          TIMESTAMPTZ NOT NULL DEFAULT now(),

  -- Provenance pair integrity: chunk_id must belong to document_id. The composite
  -- FK enforces the pair (not just each column independently) and cascades when
  -- the anchoring chunk — or its document — is removed.
  CONSTRAINT claims_chunk_in_document FOREIGN KEY (document_id, chunk_id)
    REFERENCES chunks(document_id, id) ON DELETE CASCADE,

  -- Light, non-speculative constraints
  CONSTRAINT claims_offsets_valid CHECK (source_start_offset >= 0
                                         AND source_end_offset > source_start_offset),
  CONSTRAINT claims_confidence_range CHECK (confidence IS NULL
                                            OR (confidence >= 0 AND confidence <= 1)),
  CONSTRAINT claims_not_self_superseded CHECK (superseded_by IS NULL OR superseded_by <> id)
);

-- ---------------------------------------------------------------------------
-- Indexes (no vector index — deferred to the retrieval PR)
-- ---------------------------------------------------------------------------
CREATE INDEX IF NOT EXISTS claims_document_id_idx ON claims(document_id);
CREATE INDEX IF NOT EXISTS claims_chunk_id_idx    ON claims(chunk_id);
CREATE INDEX IF NOT EXISTS claims_status_idx      ON claims(status, created_at DESC);
CREATE INDEX IF NOT EXISTS claims_state_idx       ON claims(state, created_at DESC);
CREATE INDEX IF NOT EXISTS claims_superseded_by_idx ON claims(superseded_by)
  WHERE superseded_by IS NOT NULL;
CREATE INDEX IF NOT EXISTS claims_fts_idx      ON claims USING gin(fts);
CREATE INDEX IF NOT EXISTS claims_tags_idx     ON claims USING gin(tags);
CREATE INDEX IF NOT EXISTS claims_entities_idx ON claims USING gin(entities jsonb_path_ops);

-- ---------------------------------------------------------------------------
-- updated_at trigger (reuses update_updated_at() from setup-db.sql)
-- ---------------------------------------------------------------------------
DROP TRIGGER IF EXISTS claims_updated_at ON claims;
CREATE TRIGGER claims_updated_at
  BEFORE UPDATE ON claims
  FOR EACH ROW EXECUTE FUNCTION update_updated_at();

-- ---------------------------------------------------------------------------
-- RLS (deny anon/authenticated; service role bypasses)
-- ---------------------------------------------------------------------------
ALTER TABLE claims ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS claims_deny_anon ON claims;
CREATE POLICY claims_deny_anon ON claims
  FOR ALL TO anon, authenticated USING (false);

REVOKE ALL ON claims FROM anon, authenticated;
