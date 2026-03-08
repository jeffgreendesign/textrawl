import pg from 'pg';
import { logger } from '../utils/logger.js';

const { Pool } = pg;

let pool: pg.Pool | null = null;

/**
 * Get or create a direct Postgres connection pool.
 * Independent of the Supabase client — uses DATABASE_URL.
 */
export function getPgPool(connectionString?: string): pg.Pool {
	if (pool) return pool;

	const connStr = connectionString ?? process.env.DATABASE_URL;
	if (!connStr) {
		throw new Error('DATABASE_URL is required for direct Postgres access');
	}

	pool = new Pool({
		connectionString: connStr,
		max: 5,
		idleTimeoutMillis: 30_000,
		connectionTimeoutMillis: 10_000,
	});

	pool.on('error', (err) => {
		logger.error('Unexpected pg pool error', { error: err.message });
	});

	return pool;
}

/**
 * Run a query against the direct Postgres pool.
 */
export async function pgQuery<T extends pg.QueryResultRow = pg.QueryResultRow>(
	text: string,
	params?: unknown[],
): Promise<pg.QueryResult<T>> {
	const p = getPgPool();
	return p.query<T>(text, params);
}

/**
 * Check if DATABASE_URL is configured.
 */
export function isPgConfigured(): boolean {
	return !!process.env.DATABASE_URL;
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
