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

CREATE UNIQUE INDEX IF NOT EXISTS applet_versions_applet_version_idx ON applet_versions (applet_id, version);
CREATE INDEX IF NOT EXISTS applet_versions_applet_id_idx ON applet_versions (applet_id);

-- Auto-update updated_at on applet modifications
CREATE OR REPLACE FUNCTION set_updated_at()
RETURNS TRIGGER AS $$
BEGIN
  NEW.updated_at = now();
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS applets_set_updated_at ON applets;
CREATE TRIGGER applets_set_updated_at
  BEFORE UPDATE ON applets
  FOR EACH ROW
  EXECUTE FUNCTION set_updated_at();

-- ---------------------------------------------------------------------------
-- Row Level Security (matches pattern from security-rls.sql)
-- ---------------------------------------------------------------------------

-- Enable RLS on both tables
ALTER TABLE public.applets ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.applets FORCE ROW LEVEL SECURITY;

ALTER TABLE public.applet_versions ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.applet_versions FORCE ROW LEVEL SECURITY;

-- Drop existing policies for idempotency
DROP POLICY IF EXISTS "Service role access to applets" ON public.applets;
DROP POLICY IF EXISTS "Deny anon access to applets" ON public.applets;
DROP POLICY IF EXISTS "Deny authenticated access to applets" ON public.applets;

DROP POLICY IF EXISTS "Service role access to applet_versions" ON public.applet_versions;
DROP POLICY IF EXISTS "Deny anon access to applet_versions" ON public.applet_versions;
DROP POLICY IF EXISTS "Deny authenticated access to applet_versions" ON public.applet_versions;

-- Permissive: allow service_role full access
CREATE POLICY "Service role access to applets"
  ON public.applets
  FOR ALL
  TO service_role
  USING (true)
  WITH CHECK (true);

CREATE POLICY "Service role access to applet_versions"
  ON public.applet_versions
  FOR ALL
  TO service_role
  USING (true)
  WITH CHECK (true);

-- Restrictive: deny anon and authenticated
CREATE POLICY "Deny anon access to applets"
  ON public.applets AS RESTRICTIVE
  FOR ALL
  TO anon
  USING (false);

CREATE POLICY "Deny authenticated access to applets"
  ON public.applets AS RESTRICTIVE
  FOR ALL
  TO authenticated
  USING (false);

CREATE POLICY "Deny anon access to applet_versions"
  ON public.applet_versions AS RESTRICTIVE
  FOR ALL
  TO anon
  USING (false);

CREATE POLICY "Deny authenticated access to applet_versions"
  ON public.applet_versions AS RESTRICTIVE
  FOR ALL
  TO authenticated
  USING (false);

-- Revoke direct table access from non-service roles
REVOKE ALL ON TABLE public.applets FROM anon, authenticated;
REVOKE ALL ON TABLE public.applet_versions FROM anon, authenticated;
