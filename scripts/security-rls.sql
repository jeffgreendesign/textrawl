-- =============================================================================
-- Textrawl Security: Row Level Security + Access Control
-- =============================================================================
-- This script enables RLS with defense-in-depth policies:
-- - Permissive policy for general access (service role bypasses RLS anyway)
-- - Restrictive policies blocking anon/authenticated roles
-- - Explicit REVOKE of permissions from anon/authenticated
--
-- Run this AFTER setup-db.sql (or setup-db-ollama.sql) in Supabase SQL Editor.
-- See docs/SECURITY.md for full security documentation.
-- =============================================================================

-- -----------------------------------------------------------------------------
-- Enable Row Level Security
-- -----------------------------------------------------------------------------
ALTER TABLE public.documents ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.chunks ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.memory_entities ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.memory_observations ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.memory_relations ENABLE ROW LEVEL SECURITY;

-- Force RLS for table owners (prevents bypassing by postgres role)
-- Note: service_role still bypasses RLS; this affects the owner role only
ALTER TABLE public.documents FORCE ROW LEVEL SECURITY;
ALTER TABLE public.chunks FORCE ROW LEVEL SECURITY;
ALTER TABLE public.memory_entities FORCE ROW LEVEL SECURITY;
ALTER TABLE public.memory_observations FORCE ROW LEVEL SECURITY;
ALTER TABLE public.memory_relations FORCE ROW LEVEL SECURITY;

-- -----------------------------------------------------------------------------
-- Policies for documents table
-- -----------------------------------------------------------------------------

-- Permissive policy (service_role bypasses RLS anyway, but explicit is clearer)
CREATE POLICY "Allow all access to documents"
  ON public.documents
  FOR ALL
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

-- Permissive policy
CREATE POLICY "Allow all access to chunks"
  ON public.chunks
  FOR ALL
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
-- Policies for memory tables
-- -----------------------------------------------------------------------------

-- memory_entities
CREATE POLICY "Allow all access to memory_entities"
  ON public.memory_entities FOR ALL USING (true) WITH CHECK (true);

CREATE POLICY "Deny anon access to memory_entities"
  ON public.memory_entities AS RESTRICTIVE FOR ALL TO anon USING (false);

CREATE POLICY "Deny authenticated access to memory_entities"
  ON public.memory_entities AS RESTRICTIVE FOR ALL TO authenticated USING (false);

-- memory_observations
CREATE POLICY "Allow all access to memory_observations"
  ON public.memory_observations FOR ALL USING (true) WITH CHECK (true);

CREATE POLICY "Deny anon access to memory_observations"
  ON public.memory_observations AS RESTRICTIVE FOR ALL TO anon USING (false);

CREATE POLICY "Deny authenticated access to memory_observations"
  ON public.memory_observations AS RESTRICTIVE FOR ALL TO authenticated USING (false);

-- memory_relations
CREATE POLICY "Allow all access to memory_relations"
  ON public.memory_relations FOR ALL USING (true) WITH CHECK (true);

CREATE POLICY "Deny anon access to memory_relations"
  ON public.memory_relations AS RESTRICTIVE FOR ALL TO anon USING (false);

CREATE POLICY "Deny authenticated access to memory_relations"
  ON public.memory_relations AS RESTRICTIVE FOR ALL TO authenticated USING (false);

-- -----------------------------------------------------------------------------
-- Revoke permissions (belt + suspenders)
-- -----------------------------------------------------------------------------
REVOKE ALL ON TABLE public.documents FROM anon, authenticated;
REVOKE ALL ON TABLE public.chunks FROM anon, authenticated;
REVOKE ALL ON TABLE public.memory_entities FROM anon, authenticated;
REVOKE ALL ON TABLE public.memory_observations FROM anon, authenticated;
REVOKE ALL ON TABLE public.memory_relations FROM anon, authenticated;

-- Revoke function execution from anon/authenticated
REVOKE EXECUTE ON FUNCTION public.hybrid_search FROM anon, authenticated;
REVOKE EXECUTE ON FUNCTION public.semantic_search FROM anon, authenticated;
REVOKE EXECUTE ON FUNCTION public.memory_hybrid_search FROM anon, authenticated;
REVOKE EXECUTE ON FUNCTION public.memory_semantic_search FROM anon, authenticated;
REVOKE EXECUTE ON FUNCTION public.get_entity_context FROM anon, authenticated;

-- -----------------------------------------------------------------------------
-- Explicit service_role grants (should already have, but be explicit)
-- -----------------------------------------------------------------------------
GRANT ALL ON TABLE public.documents TO service_role;
GRANT ALL ON TABLE public.chunks TO service_role;
GRANT ALL ON TABLE public.memory_entities TO service_role;
GRANT ALL ON TABLE public.memory_observations TO service_role;
GRANT ALL ON TABLE public.memory_relations TO service_role;

GRANT EXECUTE ON FUNCTION public.hybrid_search TO service_role;
GRANT EXECUTE ON FUNCTION public.semantic_search TO service_role;
GRANT EXECUTE ON FUNCTION public.memory_hybrid_search TO service_role;
GRANT EXECUTE ON FUNCTION public.memory_semantic_search TO service_role;
GRANT EXECUTE ON FUNCTION public.get_entity_context TO service_role;

-- -----------------------------------------------------------------------------
-- Verification queries (run these to confirm setup)
-- -----------------------------------------------------------------------------
-- Check RLS is enabled:
SELECT schemaname, tablename, rowsecurity
FROM pg_tables
WHERE schemaname = 'public'
  AND tablename IN ('documents', 'chunks', 'memory_entities', 'memory_observations', 'memory_relations');

-- Check policies exist:
SELECT tablename, policyname, permissive, roles, cmd
FROM pg_policies
WHERE schemaname = 'public'
ORDER BY tablename, policyname;
