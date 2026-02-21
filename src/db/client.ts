import { type SupabaseClient, createClient } from '@supabase/supabase-js';
import { config } from '../utils/config.js';
import { DatabaseError } from '../utils/errors.js';
import { logger } from '../utils/logger.js';

let supabase: SupabaseClient | null = null;

/**
 * Get the Supabase client instance (singleton pattern)
 */
export function getSupabaseClient(): SupabaseClient {
	if (!config.SUPABASE_URL || !config.SUPABASE_SERVICE_KEY) {
		throw new DatabaseError(
			'Supabase credentials not configured. Set SUPABASE_URL and SUPABASE_SERVICE_KEY.',
		);
	}

	if (!supabase) {
		supabase = createClient(config.SUPABASE_URL, config.SUPABASE_SERVICE_KEY, {
			auth: {
				persistSession: false,
				autoRefreshToken: false,
			},
			global: {
				fetch: (url: URL | RequestInfo, init?: RequestInit) =>
					fetch(url, { ...init, signal: init?.signal ?? AbortSignal.timeout(30_000) }),
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
 *
 * Canonical definitions are in src/types/database.ts.
 * Re-exported here for backward compatibility.
 */
export type { Chunk, Document, SearchResult } from '../types/database.js';
