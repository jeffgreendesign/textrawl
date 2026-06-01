-- =============================================================================
-- Large Upload Metadata Schema
-- =============================================================================
-- Run this in Supabase SQL Editor (or psql) after setup-db.sql.
--
-- Stores upload session metadata, state, and per-entry results for the
-- GCS-resumable + Cloud Tasks large-upload flow. NO file bytes and NO chunks
-- live here — documents/chunks continue to use the existing tables via
-- createDocument / createChunks. Bytes live in GCS and are streamed during
-- processing.
--
-- Provides:
--   - uploads:        one row per upload session (state machine + GCS metadata)
--   - upload_entries: per-entry results for archives (one row per extracted file)
--
-- Re-running is safe (CREATE TABLE / INDEX IF NOT EXISTS, idempotent trigger).
-- See docs/plans/2026-05-31-large-upload-gcs-resumable-plan.md §5 (state
-- machine) and §6 (schema sketch).
-- =============================================================================

-- ---------------------------------------------------------------------------
-- 1. Upload sessions (metadata + state only — never file bytes)
-- ---------------------------------------------------------------------------
create table if not exists uploads (
  id uuid primary key default gen_random_uuid(),
  owner_token_hash text,                 -- sha256(bearer token) or OAuth sub; NULL if auth disabled (INTERIM binding, not a tenant boundary)
  filename text not null,
  title text,
  declared_mimetype text,
  normalized_type text,                  -- registry handler key, e.g. 'pdf','zip'
  size_bytes bigint not null,
  checksum_algo text default 'sha256',   -- canonical app-level algo
  checksum_expected text,                -- client SHA-256 if provided (else null)
  checksum_computed text,                -- SHA-256 computed by processor stream
  checksum_verified_at timestamptz,
  gcs_crc32c text,                       -- GCS object crc32c captured at complete
  bucket text not null,
  object_key text not null,              -- server-generated; never trusted from client
  object_generation text,                -- GCS generation captured at complete
  object_etag text,
  state text not null default 'initialized'
    check (state in ('initialized','uploading','uploaded','queued','processing',
                     'completed','partial','failed','expired','cancelled')),
  error_code text,
  error_message text,
  entries_total int default 0,
  entries_processed int default 0,
  entries_failed int default 0,
  document_ids uuid[] default '{}',     -- denormalized aggregate for the /status response; the FK-bearing source of truth is upload_entries.document_id (no FK on arrays by design)
  metadata jsonb default '{}',           -- tags, source hints, task name for dedupe
  created_at timestamptz default now(),
  updated_at timestamptz default now(),
  expires_at timestamptz,
  completed_at timestamptz
);

create index if not exists uploads_state_idx on uploads(state);
create index if not exists uploads_owner_idx on uploads(owner_token_hash);
create index if not exists uploads_expires_idx on uploads(expires_at);

-- ---------------------------------------------------------------------------
-- 2. Per-entry results (archives). For single files, one row is optional.
-- ---------------------------------------------------------------------------
create table if not exists upload_entries (
  id uuid primary key default gen_random_uuid(),
  upload_id uuid not null references uploads(id) on delete cascade,
  entry_path text not null,
  normalized_type text,
  size_bytes bigint,
  state text not null default 'pending'
    check (state in ('pending','completed','failed','skipped')),
  document_id uuid references documents(id) on delete set null,
  error_code text,
  error_message text,
  created_at timestamptz default now()
);

create index if not exists upload_entries_upload_idx on upload_entries(upload_id);
create index if not exists upload_entries_state_idx on upload_entries(state);
-- Dedupe extracted entries on retry (Cloud Task retries must not recreate rows):
create unique index if not exists upload_entries_uniq on upload_entries(upload_id, entry_path);

-- ---------------------------------------------------------------------------
-- 3. updated_at trigger (reuses public.update_updated_at() from setup-db.sql)
-- ---------------------------------------------------------------------------
drop trigger if exists uploads_updated_at on uploads;
create trigger uploads_updated_at
  before update on uploads
  for each row execute function update_updated_at();
