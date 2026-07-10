import { Pool, type PoolClient, type QueryResultRow, neonConfig } from '@neondatabase/serverless';
import { DatabaseError, NotFoundError } from '../utils/errors.js';
import { logger } from '../utils/logger.js';

// Use WebSocket transport in serverless/edge environments
// In Node.js (Cloud Run), the driver uses standard TCP automatically
neonConfig.useSecureWebSocket = true;

let pool: Pool | null = null;

/**
 * Get or create a Neon Postgres connection pool.
 * Uses DATABASE_URL from environment.
 */
export function getPgPool(connectionString?: string): Pool {
	if (pool) return pool;

	const connStr = connectionString ?? process.env.DATABASE_URL;
	if (!connStr) {
		throw new DatabaseError('DATABASE_URL is required for database access');
	}

	pool = new Pool({
		connectionString: connStr,
		max: 5,
		idleTimeoutMillis: 30_000,
		connectionTimeoutMillis: 10_000,
	});

	pool.on('error', (err: Error) => {
		logger.error('Unexpected pg pool error', { error: err.message });
	});

	// Enable pgvector 0.8 iterative index scans per connection so that filtered
	// vector searches (hybrid_search's pushed-down predicates, memory search's
	// entity_types) keep scanning the HNSW graph until the LIMIT is satisfied
	// instead of silently under-returning. Wrapped in an exception-guarded DO
	// block so older pgvector (which lacks this GUC) still connects cleanly.
	pool.on('connect', (client: PoolClient) => {
		client
			.query(
				"DO $$ BEGIN PERFORM set_config('hnsw.iterative_scan', 'relaxed_order', false); EXCEPTION WHEN others THEN NULL; END $$;",
			)
			.catch((err: Error) => {
				logger.debug('Could not set hnsw.iterative_scan (pgvector < 0.8?)', {
					error: err.message,
				});
			});
	});

	return pool;
}

/**
 * Run a query against the Postgres pool.
 */
export async function pgQuery<T extends QueryResultRow = Record<string, unknown>>(
	text: string,
	params?: unknown[],
): Promise<{ rows: T[]; rowCount: number | null }> {
	const p = getPgPool();
	return p.query<T>(text, params);
}

/**
 * Return the first row or null.
 * Replaces Supabase .maybeSingle().
 */
export async function queryOne<T extends QueryResultRow = Record<string, unknown>>(
	text: string,
	params?: unknown[],
): Promise<T | null> {
	const result = await pgQuery<T>(text, params);
	return result.rows[0] ?? null;
}

/**
 * Return the first row or throw NotFoundError.
 * Replaces Supabase .single().
 */
export async function queryOneOrThrow<T extends QueryResultRow = Record<string, unknown>>(
	text: string,
	params?: unknown[],
	entityName = 'Record',
): Promise<T> {
	const row = await queryOne<T>(text, params);
	if (!row) {
		throw new NotFoundError(`${entityName} not found`);
	}
	return row;
}

/**
 * Return a count from a SELECT count(*) query.
 */
export async function queryCount(text: string, params?: unknown[]): Promise<number> {
	const result = await pgQuery<{ count: string }>(text, params);
	return parseInt(result.rows[0]?.count ?? '0', 10);
}

/**
 * Check if DATABASE_URL is configured.
 */
export function isDatabaseConfigured(): boolean {
	return !!process.env.DATABASE_URL;
}

/** @deprecated Use isDatabaseConfigured */
export const isPgConfigured = isDatabaseConfigured;

/**
 * Check database connectivity.
 */
export async function checkDatabaseConnection(): Promise<boolean> {
	if (!isDatabaseConfigured()) {
		return false;
	}

	try {
		await pgQuery('SELECT 1');
		return true;
	} catch (error) {
		logger.error('Database connection check failed', {
			error: error instanceof Error ? error.message : String(error),
		});
		return false;
	}
}

/**
 * Close the pool (for CLI cleanup).
 */
export async function closePgPool(): Promise<void> {
	if (pool) {
		await pool.end();
		pool = null;
	}
}

/**
 * Database types for TypeScript
 *
 * Canonical definitions are in src/types/database.ts.
 * Re-exported here for backward compatibility.
 */
export type { Chunk, Document, SearchResult } from '../types/database.js';
