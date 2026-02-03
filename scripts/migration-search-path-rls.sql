-- =============================================================================
-- Migration: Fix search_path + RLS policy warnings
-- =============================================================================
-- Run this in the Supabase SQL Editor to fix existing databases.
-- Resolves Supabase linter warnings:
--   - function_search_path_mutable (10 functions)
--   - rls_policy_always_true (5+ tables)
--
-- Safe to run multiple times (idempotent).
-- =============================================================================

-- ---------------------------------------------------------------------------
-- 1. Set search_path = 'public', 'extensions' on all functions
-- ---------------------------------------------------------------------------
-- Uses DO blocks to handle missing functions gracefully (users only have one
-- embedding provider configured, so some function signatures won't exist).

-- Base schema functions (OpenAI 1536d)
DO $$ BEGIN
  ALTER FUNCTION public.hybrid_search(TEXT, VECTOR(1536), INT, FLOAT, FLOAT, INT) SET search_path = 'public', 'extensions';
  ALTER FUNCTION public.semantic_search(VECTOR(1536), INT) SET search_path = 'public', 'extensions';
EXCEPTION WHEN undefined_function THEN
  RAISE NOTICE 'OpenAI base functions (1536d) not found - skipping';
END $$;

-- Base schema functions (Ollama 1024d)
DO $$ BEGIN
  ALTER FUNCTION public.hybrid_search(TEXT, VECTOR(1024), INT, FLOAT, FLOAT, INT) SET search_path = 'public', 'extensions';
  ALTER FUNCTION public.semantic_search(VECTOR(1024), INT) SET search_path = 'public', 'extensions';
EXCEPTION WHEN undefined_function THEN
  RAISE NOTICE 'Ollama base functions (1024d) not found - skipping';
END $$;

-- Base schema functions (Ollama v2 768d)
DO $$ BEGIN
  ALTER FUNCTION public.hybrid_search(TEXT, VECTOR(768), INT, FLOAT, FLOAT, INT) SET search_path = 'public', 'extensions';
  ALTER FUNCTION public.semantic_search(VECTOR(768), INT) SET search_path = 'public', 'extensions';
EXCEPTION WHEN undefined_function THEN
  RAISE NOTICE 'Ollama v2 base functions (768d) not found - skipping';
END $$;

-- Shared trigger function
DO $$ BEGIN
  ALTER FUNCTION public.update_updated_at() SET search_path = 'public', 'extensions';
EXCEPTION WHEN undefined_function THEN
  RAISE NOTICE 'update_updated_at not found - skipping';
END $$;

-- Memory functions (shared across providers)
DO $$ BEGIN
  ALTER FUNCTION public.get_entity_context(TEXT, BOOLEAN) SET search_path = 'public', 'extensions';
  ALTER FUNCTION public.cleanup_expired_observations() SET search_path = 'public', 'extensions';
EXCEPTION WHEN undefined_function THEN
  RAISE NOTICE 'Shared memory functions not found - skipping';
END $$;

-- Memory functions (OpenAI 1536d)
DO $$ BEGIN
  ALTER FUNCTION public.memory_semantic_search(VECTOR(1536), INT, TEXT[], BOOLEAN) SET search_path = 'public', 'extensions';
  ALTER FUNCTION public.memory_hybrid_search(TEXT, VECTOR(1536), INT, FLOAT, FLOAT, INT, TEXT[], BOOLEAN) SET search_path = 'public', 'extensions';
EXCEPTION WHEN undefined_function THEN
  RAISE NOTICE 'OpenAI memory functions (1536d) not found - skipping';
END $$;

-- Memory functions (Ollama 1024d)
DO $$ BEGIN
  ALTER FUNCTION public.memory_semantic_search(VECTOR(1024), INT, TEXT[], BOOLEAN) SET search_path = 'public', 'extensions';
  ALTER FUNCTION public.memory_hybrid_search(TEXT, VECTOR(1024), INT, FLOAT, FLOAT, INT, TEXT[], BOOLEAN) SET search_path = 'public', 'extensions';
EXCEPTION WHEN undefined_function THEN
  RAISE NOTICE 'Ollama memory functions (1024d) not found - skipping';
END $$;

-- Insight functions (OpenAI 1536d)
DO $$ BEGIN
  ALTER FUNCTION public.insight_queue_increment(INTEGER) SET search_path = 'public', 'extensions';
  ALTER FUNCTION public.insight_queue_check(INTEGER, INTEGER) SET search_path = 'public', 'extensions';
  ALTER FUNCTION public.insight_semantic_search(VECTOR(1536), INTEGER, TEXT) SET search_path = 'public', 'extensions';
EXCEPTION WHEN undefined_function THEN
  RAISE NOTICE 'OpenAI insight functions (1536d) not found - skipping';
END $$;

-- Insight functions (Ollama 1024d)
DO $$ BEGIN
  ALTER FUNCTION public.insight_semantic_search(VECTOR(1024), INTEGER, TEXT) SET search_path = 'public', 'extensions';
EXCEPTION WHEN undefined_function THEN
  RAISE NOTICE 'Ollama insight functions (1024d) not found - skipping';
END $$;

-- Insight functions (Ollama v2 768d)
DO $$ BEGIN
  ALTER FUNCTION public.insight_semantic_search(VECTOR(768), INTEGER, TEXT) SET search_path = 'public', 'extensions';
EXCEPTION WHEN undefined_function THEN
  RAISE NOTICE 'Ollama v2 insight functions (768d) not found - skipping';
END $$;

-- Conversation functions (shared)
DO $$ BEGIN
  ALTER FUNCTION public.update_session_activity() SET search_path = 'public', 'extensions';
  ALTER FUNCTION public.update_session_activity_on_delete() SET search_path = 'public', 'extensions';
  ALTER FUNCTION public.get_recent_conversations(INT, INT) SET search_path = 'public', 'extensions';
  ALTER FUNCTION public.cleanup_old_conversations(INT) SET search_path = 'public', 'extensions';
EXCEPTION WHEN undefined_function THEN
  RAISE NOTICE 'Shared conversation functions not found - skipping';
END $$;

-- Conversation functions (OpenAI 1536d)
DO $$ BEGIN
  ALTER FUNCTION public.conversation_semantic_search(VECTOR(1536), INT) SET search_path = 'public', 'extensions';
  ALTER FUNCTION public.conversation_hybrid_search(TEXT, VECTOR(1536), INT, FLOAT, FLOAT, INT) SET search_path = 'public', 'extensions';
  ALTER FUNCTION public.conversation_turn_search(TEXT, VECTOR(1536), INT, FLOAT, FLOAT, INT, UUID) SET search_path = 'public', 'extensions';
EXCEPTION WHEN undefined_function THEN
  RAISE NOTICE 'OpenAI conversation functions (1536d) not found - skipping';
END $$;

-- Conversation functions (Ollama 1024d)
DO $$ BEGIN
  ALTER FUNCTION public.conversation_semantic_search(VECTOR(1024), INT) SET search_path = 'public', 'extensions';
  ALTER FUNCTION public.conversation_hybrid_search(TEXT, VECTOR(1024), INT, FLOAT, FLOAT, INT) SET search_path = 'public', 'extensions';
  ALTER FUNCTION public.conversation_turn_search(TEXT, VECTOR(1024), INT, FLOAT, FLOAT, INT, UUID) SET search_path = 'public', 'extensions';
EXCEPTION WHEN undefined_function THEN
  RAISE NOTICE 'Ollama conversation functions (1024d) not found - skipping';
END $$;

-- Conversation functions (Ollama v2 768d)
DO $$ BEGIN
  ALTER FUNCTION public.conversation_semantic_search(VECTOR(768), INT) SET search_path = 'public', 'extensions';
  ALTER FUNCTION public.conversation_hybrid_search(TEXT, VECTOR(768), INT, FLOAT, FLOAT, INT) SET search_path = 'public', 'extensions';
  ALTER FUNCTION public.conversation_turn_search(TEXT, VECTOR(768), INT, FLOAT, FLOAT, INT, UUID) SET search_path = 'public', 'extensions';
EXCEPTION WHEN undefined_function THEN
  RAISE NOTICE 'Ollama v2 conversation functions (768d) not found - skipping';
END $$;

-- ---------------------------------------------------------------------------
-- 2. Replace overly permissive RLS policies with service_role-scoped policies
-- ---------------------------------------------------------------------------

-- Documents table
DO $$ BEGIN
  DROP POLICY IF EXISTS "Allow all access to documents" ON public.documents;
  DROP POLICY IF EXISTS "Service role access to documents" ON public.documents;
  CREATE POLICY "Service role access to documents"
    ON public.documents FOR ALL TO service_role USING (true) WITH CHECK (true);
EXCEPTION WHEN undefined_table THEN
  RAISE NOTICE 'documents table not found - skipping';
END $$;

-- Chunks table
DO $$ BEGIN
  DROP POLICY IF EXISTS "Allow all access to chunks" ON public.chunks;
  DROP POLICY IF EXISTS "Service role access to chunks" ON public.chunks;
  CREATE POLICY "Service role access to chunks"
    ON public.chunks FOR ALL TO service_role USING (true) WITH CHECK (true);
EXCEPTION WHEN undefined_table THEN
  RAISE NOTICE 'chunks table not found - skipping';
END $$;

-- Memory entities table
DO $$ BEGIN
  DROP POLICY IF EXISTS "Allow all access to memory_entities" ON public.memory_entities;
  DROP POLICY IF EXISTS "Service role access to memory_entities" ON public.memory_entities;
  CREATE POLICY "Service role access to memory_entities"
    ON public.memory_entities FOR ALL TO service_role USING (true) WITH CHECK (true);
EXCEPTION WHEN undefined_table THEN
  RAISE NOTICE 'memory_entities table not found - skipping';
END $$;

-- Memory observations table
DO $$ BEGIN
  DROP POLICY IF EXISTS "Allow all access to memory_observations" ON public.memory_observations;
  DROP POLICY IF EXISTS "Service role access to memory_observations" ON public.memory_observations;
  CREATE POLICY "Service role access to memory_observations"
    ON public.memory_observations FOR ALL TO service_role USING (true) WITH CHECK (true);
EXCEPTION WHEN undefined_table THEN
  RAISE NOTICE 'memory_observations table not found - skipping';
END $$;

-- Memory relations table
DO $$ BEGIN
  DROP POLICY IF EXISTS "Allow all access to memory_relations" ON public.memory_relations;
  DROP POLICY IF EXISTS "Service role access to memory_relations" ON public.memory_relations;
  CREATE POLICY "Service role access to memory_relations"
    ON public.memory_relations FOR ALL TO service_role USING (true) WITH CHECK (true);
EXCEPTION WHEN undefined_table THEN
  RAISE NOTICE 'memory_relations table not found - skipping';
END $$;

-- Conversation sessions table
DO $$ BEGIN
  DROP POLICY IF EXISTS "Allow all access to conversation_sessions" ON public.conversation_sessions;
  DROP POLICY IF EXISTS "Service role access to conversation_sessions" ON public.conversation_sessions;
  CREATE POLICY "Service role access to conversation_sessions"
    ON public.conversation_sessions FOR ALL TO service_role USING (true) WITH CHECK (true);
EXCEPTION WHEN undefined_table THEN
  RAISE NOTICE 'conversation_sessions table not found - skipping';
END $$;

-- Conversation turns table
DO $$ BEGIN
  DROP POLICY IF EXISTS "Allow all access to conversation_turns" ON public.conversation_turns;
  DROP POLICY IF EXISTS "Service role access to conversation_turns" ON public.conversation_turns;
  CREATE POLICY "Service role access to conversation_turns"
    ON public.conversation_turns FOR ALL TO service_role USING (true) WITH CHECK (true);
EXCEPTION WHEN undefined_table THEN
  RAISE NOTICE 'conversation_turns table not found - skipping';
END $$;

-- ---------------------------------------------------------------------------
-- 3. Verification
-- ---------------------------------------------------------------------------
-- Check functions have search_path set:
SELECT
  n.nspname AS schema,
  p.proname AS function_name,
  pg_catalog.array_to_string(p.proconfig, ', ') AS config
FROM pg_catalog.pg_proc p
JOIN pg_catalog.pg_namespace n ON n.oid = p.pronamespace
WHERE n.nspname = 'public'
  AND p.proname IN (
    'hybrid_search', 'semantic_search', 'update_updated_at',
    'memory_semantic_search', 'memory_hybrid_search',
    'get_entity_context', 'cleanup_expired_observations',
    'insight_queue_increment', 'insight_queue_check', 'insight_semantic_search',
    'conversation_semantic_search', 'conversation_hybrid_search',
    'conversation_turn_search', 'get_recent_conversations',
    'cleanup_old_conversations', 'update_session_activity',
    'update_session_activity_on_delete'
  )
ORDER BY p.proname;

-- Check RLS policies:
SELECT tablename, policyname, permissive, roles, cmd
FROM pg_policies
WHERE schemaname = 'public'
  AND tablename IN ('documents', 'chunks', 'memory_entities', 'memory_observations', 'memory_relations', 'conversation_sessions', 'conversation_turns')
ORDER BY tablename, policyname;
