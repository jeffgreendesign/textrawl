-- Migration: insight queue stale-lock recovery
-- Adds processing_started_at and a stale_seconds-aware insight_queue_check().
-- Idempotent; safe to re-run. Repairs a currently-stuck is_processing flag by
-- making the queue eligible again once the lock is older than stale_seconds.

ALTER TABLE insight_queue ADD COLUMN IF NOT EXISTS processing_started_at TIMESTAMPTZ;

-- Drop the older 2-arg signature so a 2-arg call cannot become ambiguous
-- against the 3-arg version below (both would match via the stale_seconds default).
DROP FUNCTION IF EXISTS public.insight_queue_check(INTEGER, INTEGER);

CREATE OR REPLACE FUNCTION public.insight_queue_check(
  threshold INTEGER DEFAULT 50,
  debounce_seconds INTEGER DEFAULT 300,
  stale_seconds INTEGER DEFAULT 1800
)
RETURNS TABLE (should_scan BOOLEAN, pending INTEGER)
LANGUAGE plpgsql
SET search_path = 'public', 'extensions'
AS $$
BEGIN
  RETURN QUERY
  SELECT
    (q.chunks_pending >= threshold
     AND (q.is_processing = FALSE
          OR q.processing_started_at IS NULL
          OR q.processing_started_at < now() - (stale_seconds || ' seconds')::interval)
     AND (q.last_insert_at IS NULL
          OR q.last_insert_at < now() - (debounce_seconds || ' seconds')::interval)
    ) AS should_scan,
    q.chunks_pending AS pending
  FROM public.insight_queue q
  WHERE q.id = 1;
END;
$$;
