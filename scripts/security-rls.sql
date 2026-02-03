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
CREATE POLICY "Service role access to documents"
  ON public.documents
  FOR ALL
  TO service_role
  USING (true)
  WITH CHECK (true);

-- Restrictive policies to block anon and authenticated roles
CREATE POLICY "Deny anon access to documents"
  ON public.documents AS RESTRICTIVE
  FOR ALL
  TO anon
  USING (false);

CREATE POLICY "Deny authenticated access to documents"
  ON public.documents AS RESTRICTIVE
  FOR ALL
  TO authenticated
  USING (false);

-- -----------------------------------------------------------------------------
-- Policies for chunks table
-- -----------------------------------------------------------------------------

-- Permissive policy scoped to service_role
CREATE POLICY "Service role access to chunks"
  ON public.chunks
  FOR ALL
  TO service_role
  USING (true)
  WITH CHECK (true);

-- Restrictive policies to block anon and authenticated roles
CREATE POLICY "Deny anon access to chunks"
  ON public.chunks AS RESTRICTIVE
  FOR ALL
  TO anon
  USING (false);

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
-- Verification queries (run these to confirm setup)
-- -----------------------------------------------------------------------------
-- Check RLS is enabled:
SELECT schemaname, tablename, rowsecurity
FROM pg_tables
WHERE schemaname = 'public' AND tablename IN ('documents', 'chunks');

-- Check policies exist:
SELECT tablename, policyname, permissive, roles, cmd
FROM pg_policies
WHERE schemaname = 'public' AND tablename IN ('documents', 'chunks')
ORDER BY tablename, policyname;

-- NOTE: If upgrading from an older installation, run migration-search-path-rls.sql
-- to fix existing functions and policies on your live database.
