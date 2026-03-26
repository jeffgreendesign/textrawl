-- Migration: Scheduler state table for autonomous agent tasks (Enhancement 10)
-- Run against your Supabase/PostgreSQL database

CREATE TABLE IF NOT EXISTS scheduler_state (
  task_name text PRIMARY KEY,
  last_run_at timestamptz,
  next_run_at timestamptz,
  status text NOT NULL DEFAULT 'idle' CHECK (status IN ('idle', 'running', 'failed')),
  last_error text,
  run_count integer NOT NULL DEFAULT 0,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

-- Seed default tasks
INSERT INTO scheduler_state (task_name, status) VALUES
  ('auto_insights', 'idle'),
  ('daily_briefing_cache', 'idle'),
  ('staleness_check', 'idle')
ON CONFLICT (task_name) DO NOTHING;
