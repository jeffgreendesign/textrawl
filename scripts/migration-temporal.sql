-- Migration: Add content_date column for temporal intelligence (Enhancement 7)
-- Run against your Supabase/PostgreSQL database

ALTER TABLE documents ADD COLUMN IF NOT EXISTS content_date timestamptz;

CREATE INDEX IF NOT EXISTS documents_content_date_idx ON documents (content_date)
WHERE content_date IS NOT NULL;

COMMENT ON COLUMN documents.content_date IS 'The date the content was originally created/published (distinct from created_at which is ingestion time)';
