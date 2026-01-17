-- =============================================================================
-- Textrawl Security: Row Level Security for Memory Tables
-- =============================================================================
-- This script enables RLS for persistent memory tables with defense-in-depth:
-- - Permissive policy for general access (service role bypasses RLS anyway)
-- - Restrictive policies blocking anon/authenticated roles
-- - Explicit REVOKE of permissions from anon/authenticated
--
-- Run this AFTER setup-db-memory.sql (or setup-db-memory-ollama.sql).
-- Run security-rls.sql first for base document/chunk security.
-- See docs/guides/security-hardening.mdx for full documentation.
-- =============================================================================

-- -----------------------------------------------------------------------------
-- Enable Row Level Security for memory tables
-- -----------------------------------------------------------------------------
ALTER TABLE public.memory_entities ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.memory_observations ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.memory_relations ENABLE ROW LEVEL SECURITY;

-- Force RLS for table owners
ALTER TABLE public.memory_entities FORCE ROW LEVEL SECURITY;
ALTER TABLE public.memory_observations FORCE ROW LEVEL SECURITY;
ALTER TABLE public.memory_relations FORCE ROW LEVEL SECURITY;

-- -----------------------------------------------------------------------------
-- Policies for memory_entities table
-- -----------------------------------------------------------------------------
CREATE POLICY "Allow all access to memory_entities"
  ON public.memory_entities
  FOR ALL
  USING (true)
  WITH CHECK (true);

CREATE POLICY "Deny anon access to memory_entities"
  ON public.memory_entities AS RESTRICTIVE
  FOR ALL
  TO anon
  USING (false);

CREATE POLICY "Deny authenticated access to memory_entities"
  ON public.memory_entities AS RESTRICTIVE
  FOR ALL
  TO authenticated
  USING (false);

-- -----------------------------------------------------------------------------
-- Policies for memory_observations table
-- -----------------------------------------------------------------------------
CREATE POLICY "Allow all access to memory_observations"
  ON public.memory_observations
  FOR ALL
  USING (true)
  WITH CHECK (true);

CREATE POLICY "Deny anon access to memory_observations"
  ON public.memory_observations AS RESTRICTIVE
  FOR ALL
  TO anon
  USING (false);

CREATE POLICY "Deny authenticated access to memory_observations"
  ON public.memory_observations AS RESTRICTIVE
  FOR ALL
  TO authenticated
  USING (false);

-- -----------------------------------------------------------------------------
-- Policies for memory_relations table
-- -----------------------------------------------------------------------------
CREATE POLICY "Allow all access to memory_relations"
  ON public.memory_relations
  FOR ALL
  USING (true)
  WITH CHECK (true);

CREATE POLICY "Deny anon access to memory_relations"
  ON public.memory_relations AS RESTRICTIVE
  FOR ALL
  TO anon
  USING (false);

CREATE POLICY "Deny authenticated access to memory_relations"
  ON public.memory_relations AS RESTRICTIVE
  FOR ALL
  TO authenticated
  USING (false);

-- -----------------------------------------------------------------------------
-- Revoke permissions from anon/authenticated for memory tables
-- -----------------------------------------------------------------------------
REVOKE ALL ON TABLE public.memory_entities FROM anon, authenticated;
REVOKE ALL ON TABLE public.memory_observations FROM anon, authenticated;
REVOKE ALL ON TABLE public.memory_relations FROM anon, authenticated;

-- Revoke memory function execution from anon/authenticated
-- Note: Using full signatures to avoid ambiguity if multiple overloads exist
-- OpenAI version (1536 dimensions):
REVOKE EXECUTE ON FUNCTION public.memory_semantic_search(VECTOR(1536), INT, TEXT[], BOOLEAN) FROM anon, authenticated;
REVOKE EXECUTE ON FUNCTION public.memory_hybrid_search(TEXT, VECTOR(1536), INT, FLOAT, FLOAT, INT, TEXT[], BOOLEAN) FROM anon, authenticated;
-- Ollama version (1024 dimensions):
REVOKE EXECUTE ON FUNCTION public.memory_semantic_search(VECTOR(1024), INT, TEXT[], BOOLEAN) FROM anon, authenticated;
REVOKE EXECUTE ON FUNCTION public.memory_hybrid_search(TEXT, VECTOR(1024), INT, FLOAT, FLOAT, INT, TEXT[], BOOLEAN) FROM anon, authenticated;
-- Shared functions (same signature for both):
REVOKE EXECUTE ON FUNCTION public.get_entity_context(TEXT, BOOLEAN) FROM anon, authenticated;
REVOKE EXECUTE ON FUNCTION public.cleanup_expired_observations() FROM anon, authenticated;

-- -----------------------------------------------------------------------------
-- Explicit service_role grants for memory tables
-- -----------------------------------------------------------------------------
GRANT ALL ON TABLE public.memory_entities TO service_role;
GRANT ALL ON TABLE public.memory_observations TO service_role;
GRANT ALL ON TABLE public.memory_relations TO service_role;

-- Grant memory function execution to service_role
-- OpenAI version (1536 dimensions):
GRANT EXECUTE ON FUNCTION public.memory_semantic_search(VECTOR(1536), INT, TEXT[], BOOLEAN) TO service_role;
GRANT EXECUTE ON FUNCTION public.memory_hybrid_search(TEXT, VECTOR(1536), INT, FLOAT, FLOAT, INT, TEXT[], BOOLEAN) TO service_role;
-- Ollama version (1024 dimensions):
GRANT EXECUTE ON FUNCTION public.memory_semantic_search(VECTOR(1024), INT, TEXT[], BOOLEAN) TO service_role;
GRANT EXECUTE ON FUNCTION public.memory_hybrid_search(TEXT, VECTOR(1024), INT, FLOAT, FLOAT, INT, TEXT[], BOOLEAN) TO service_role;
-- Shared functions (same signature for both):
GRANT EXECUTE ON FUNCTION public.get_entity_context(TEXT, BOOLEAN) TO service_role;
GRANT EXECUTE ON FUNCTION public.cleanup_expired_observations() TO service_role;

-- -----------------------------------------------------------------------------
-- Verification queries (run these to confirm setup)
-- -----------------------------------------------------------------------------
-- Check RLS is enabled for memory tables:
SELECT schemaname, tablename, rowsecurity
FROM pg_tables
WHERE schemaname = 'public' AND tablename IN ('memory_entities', 'memory_observations', 'memory_relations');

-- Check policies exist:
SELECT tablename, policyname, permissive, roles, cmd
FROM pg_policies
WHERE schemaname = 'public' AND tablename LIKE 'memory_%'
ORDER BY tablename, policyname;
