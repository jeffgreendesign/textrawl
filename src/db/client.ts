import { createClient, SupabaseClient } from '@supabase/supabase-js';
import { config } from '../utils/config.js';
import { logger } from '../utils/logger.js';
import { DatabaseError } from '../utils/errors.js';

let supabase: SupabaseClient | null = null;

/**
 * Get the Supabase client instance (singleton pattern)
 */
export function getSupabaseClient(): SupabaseClient {
  if (!config.SUPABASE_URL || !config.SUPABASE_SERVICE_KEY) {
    throw new DatabaseError(
      'Supabase credentials not configured. Set SUPABASE_URL and SUPABASE_SERVICE_KEY.'
    );
  }

  if (!supabase) {
    supabase = createClient(config.SUPABASE_URL, config.SUPABASE_SERVICE_KEY, {
      auth: {
        persistSession: false,
        autoRefreshToken: false,
      },
    });
    logger.info('Supabase client initialized');
  }

  return supabase;
}

/**
 * Check if Supabase is configured
 */
export function isSupabaseConfigured(): boolean {
  return !!(config.SUPABASE_URL && config.SUPABASE_SERVICE_KEY);
}

/**
 * Check database connectivity
 */
export async function checkDatabaseConnection(): Promise<boolean> {
  if (!isSupabaseConfigured()) {
    return false;
  }

  try {
    const client = getSupabaseClient();
    const { error } = await client.from('documents').select('id').limit(1);
    return !error;
  } catch (error) {
    logger.error('Database connection check failed', {
      error: error instanceof Error ? error.message : String(error),
    });
    return false;
  }
}

/**
 * Database types for TypeScript
 */
export interface Document {
  id: string;
  title: string;
  source_type: 'note' | 'file' | 'url';
  source_url: string | null;
  file_path: string | null;
  raw_content: string;
  metadata: Record<string, unknown>;
  created_at: string;
  updated_at: string;
}

export interface Chunk {
  id: string;
  document_id: string;
  content: string;
  chunk_index: number;
  start_offset: number | null;
  end_offset: number | null;
  embedding: number[] | null;
  metadata: Record<string, unknown>;
  created_at: string;
}

export interface SearchResult {
  chunk_id: string;
  document_id: string;
  content: string;
  document_title: string;
  source_type: 'note' | 'file' | 'url';
  document_metadata: Record<string, unknown> | null;
  score: number;
}
