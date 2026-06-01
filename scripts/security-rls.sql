-- =============================================================================
-- Textrawl Security: Row Level Security + Access Control
-- =============================================================================
-- This script enables RLS with defense-in-depth policies:
-- - Permissive policy for general access (service role bypasses RLS anyway)
-- - Restrictive policies blocking anon/authenticated roles
-- - Explicit REVOKE of permissions from anon/authenticated
--
-- Run this AFTER setup-db.sql (or setup-db-ollama.sql) in Supabase SQL Editor.
-- For memory tables, run security-rls-memory.sql after setup-db-memory.sql.
-- See docs/guides/security-hardening.mdx for full security documentation.
-- =============================================================================

-- -----------------------------------------------------------------------------
-- Enable Row Level Security
-- -----------------------------------------------------------------------------
ALTER TABLE public.documents ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.chunks ENABLE ROW LEVEL SECURITY;

-- Force RLS for table owners (prevents bypassing by postgres role)
-- Note: service_role still bypasses RLS; this affects the owner role only
ALTER TABLE public.documents FORCE ROW LEVEL SECURITY;
ALTER TABLE public.chunks FORCE ROW LEVEL SECURITY;

-- -----------------------------------------------------------------------------
-- Policies for documents table
-- -----------------------------------------------------------------------------

-- Permissive policy scoped to service_role
DROP POLICY IF EXISTS "Service role access to documents" ON public.documents;
CREATE POLICY "Service role access to documents"
  ON public.documents
  FOR ALL
  TO service_role
  USING (true)
  WITH CHECK (true);

-- Restrictive policies to block anon and authenticated roles
DROP POLICY IF EXISTS "Deny anon access to documents" ON public.documents;
CREATE POLICY "Deny anon access to documents"
  ON public.documents AS RESTRICTIVE
  FOR ALL
  TO anon
  USING (false);

DROP POLICY IF EXISTS "Deny authenticated access to documents" ON public.documents;
CREATE POLICY "Deny authenticated access to documents"
  ON public.documents AS RESTRICTIVE
  FOR ALL
  TO authenticated
  USING (false);

-- -----------------------------------------------------------------------------
-- Policies for chunks table
-- -----------------------------------------------------------------------------

-- Permissive policy scoped to service_role
DROP POLICY IF EXISTS "Service role access to chunks" ON public.chunks;
CREATE POLICY "Service role access to chunks"
  ON public.chunks
  FOR ALL
  TO service_role
  USING (true)
  WITH CHECK (true);

-- Restrictive policies to block anon and authenticated roles
DROP POLICY IF EXISTS "Deny anon access to chunks" ON public.chunks;
CREATE POLICY "Deny anon access to chunks"
  ON public.chunks AS RESTRICTIVE
  FOR ALL
  TO anon
  USING (false);

DROP POLICY IF EXISTS "Deny authenticated access to chunks" ON public.chunks;
CREATE POLICY "Deny authenticated access to chunks"
  ON public.chunks AS RESTRICTIVE
  FOR ALL
  TO authenticated
  USING (false);

-- -----------------------------------------------------------------------------
-- Revoke permissions (belt + suspenders)
-- -----------------------------------------------------------------------------
REVOKE ALL ON TABLE public.documents FROM anon, authenticated;
REVOKE ALL ON TABLE public.chunks FROM anon, authenticated;

-- Revoke function execution from anon/authenticated
REVOKE EXECUTE ON FUNCTION public.hybrid_search FROM anon, authenticated;
REVOKE EXECUTE ON FUNCTION public.semantic_search FROM anon, authenticated;

-- -----------------------------------------------------------------------------
-- Explicit service_role grants (should already have, but be explicit)
-- -----------------------------------------------------------------------------
GRANT ALL ON TABLE public.documents TO service_role;
GRANT ALL ON TABLE public.chunks TO service_role;
GRANT EXECUTE ON FUNCTION public.hybrid_search TO service_role;
GRANT EXECUTE ON FUNCTION public.semantic_search TO service_role;

-- -----------------------------------------------------------------------------
-- Upload metadata tables (run AFTER setup-db-uploads.sql)
-- -----------------------------------------------------------------------------
-- These hold upload-session metadata/state only (no file bytes). Same
-- defense-in-depth as documents/chunks: service_role only, anon/authenticated
-- denied. owner_token_hash is an INTERIM binding, not a multi-tenant boundary.
ALTER TABLE public.uploads ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.upload_entries ENABLE ROW LEVEL SECURITY;

ALTER TABLE public.uploads FORCE ROW LEVEL SECURITY;
ALTER TABLE public.upload_entries FORCE ROW LEVEL SECURITY;

-- Policies for uploads table
DROP POLICY IF EXISTS "Service role access to uploads" ON public.uploads;
CREATE POLICY "Service role access to uploads"
  ON public.uploads
  FOR ALL
  TO service_role
  USING (true)
  WITH CHECK (true);

DROP POLICY IF EXISTS "Deny anon access to uploads" ON public.uploads;
CREATE POLICY "Deny anon access to uploads"
  ON public.uploads AS RESTRICTIVE
  FOR ALL
  TO anon
  USING (false);

DROP POLICY IF EXISTS "Deny authenticated access to uploads" ON public.uploads;
CREATE POLICY "Deny authenticated access to uploads"
  ON public.uploads AS RESTRICTIVE
  FOR ALL
  TO authenticated
  USING (false);

-- Policies for upload_entries table
DROP POLICY IF EXISTS "Service role access to upload_entries" ON public.upload_entries;
CREATE POLICY "Service role access to upload_entries"
  ON public.upload_entries
  FOR ALL
  TO service_role
  USING (true)
  WITH CHECK (true);

DROP POLICY IF EXISTS "Deny anon access to upload_entries" ON public.upload_entries;
CREATE POLICY "Deny anon access to upload_entries"
  ON public.upload_entries AS RESTRICTIVE
  FOR ALL
  TO anon
  USING (false);

DROP POLICY IF EXISTS "Deny authenticated access to upload_entries" ON public.upload_entries;
CREATE POLICY "Deny authenticated access to upload_entries"
  ON public.upload_entries AS RESTRICTIVE
  FOR ALL
  TO authenticated
  USING (false);

REVOKE ALL ON TABLE public.uploads FROM anon, authenticated;
REVOKE ALL ON TABLE public.upload_entries FROM anon, authenticated;

GRANT ALL ON TABLE public.uploads TO service_role;
GRANT ALL ON TABLE public.upload_entries TO service_role;

-- -----------------------------------------------------------------------------
-- Verification queries (run these to confirm setup)
-- -----------------------------------------------------------------------------
-- Check RLS is enabled:
SELECT schemaname, tablename, rowsecurity
FROM pg_tables
WHERE schemaname = 'public' AND tablename IN ('documents', 'chunks', 'uploads', 'upload_entries');

-- Check policies exist:
SELECT tablename, policyname, permissive, roles, cmd
FROM pg_policies
WHERE schemaname = 'public' AND tablename IN ('documents', 'chunks', 'uploads', 'upload_entries')
ORDER BY tablename, policyname;

-- NOTE: If upgrading from an older installation, run migration-search-path-rls.sql
-- to fix existing functions and policies on your live database.
