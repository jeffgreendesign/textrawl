-- Migration: Applets table for LLM-generated custom UIs (Enhancement 11c)
-- Run against your Supabase/PostgreSQL database

CREATE TABLE IF NOT EXISTS applets (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id text NOT NULL,
  title text NOT NULL,
  description text,
  code text NOT NULL,
  config jsonb DEFAULT '{}',
  version integer NOT NULL DEFAULT 1,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS applets_user_id_idx ON applets (user_id);
CREATE INDEX IF NOT EXISTS applets_updated_at_idx ON applets (updated_at DESC);

-- Version history for applets
CREATE TABLE IF NOT EXISTS applet_versions (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  applet_id uuid NOT NULL REFERENCES applets (id) ON DELETE CASCADE,
  version integer NOT NULL,
  code text NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS applet_versions_applet_id_idx ON applet_versions (applet_id);
