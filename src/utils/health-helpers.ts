import { isDatabaseConfigured, pgQuery } from '../db/pg-client.js';

/** Server process start time (shared across REST and MCP health checks). */
export const serverStartTime = Date.now();

const SAFE_IDENTIFIER = /^[A-Za-z_][A-Za-z0-9_]*$/;

/** Check if a table is accessible (schema exists). */
export async function checkTable(tableName: string): Promise<boolean> {
	if (!isDatabaseConfigured()) return false;
	if (!SAFE_IDENTIFIER.test(tableName)) return false;
	try {
		await pgQuery(`SELECT 1 FROM ${tableName} LIMIT 0`);
		return true;
	} catch {
		return false;
	}
}

/** Time an async operation, return [result, latencyMs]. */
export async function timed<T>(fn: () => Promise<T>): Promise<[T, number]> {
	const start = performance.now();
	const result = await fn();
	return [result, Math.round(performance.now() - start)];
}

/** Format seconds into a human-readable uptime string. */
export function formatUptime(seconds: number): string {
	const d = Math.floor(seconds / 86400);
	const h = Math.floor((seconds % 86400) / 3600);
	const m = Math.floor((seconds % 3600) / 60);
	if (d > 0) return `${d}d ${h}h ${m}m`;
	if (h > 0) return `${h}h ${m}m`;
	return `${m}m ${seconds % 60}s`;
}

/** Estimated row count from pg_class (cheap, no table scan). */
export async function estimateRowCount(tableName: string): Promise<number> {
	if (!isDatabaseConfigured()) return -1;
	if (!SAFE_IDENTIFIER.test(tableName)) return -1;
	try {
		const { rows } = await pgQuery<{ reltuples: string }>(
			`SELECT c.reltuples
			 FROM pg_class c
			 JOIN pg_namespace n ON n.oid = c.relnamespace
			 WHERE c.relname = $1 AND n.nspname = 'public'`,
			[tableName],
		);
		if (!rows[0]) return -1;
		const est = Number(rows[0].reltuples);
		return est < 0 ? 0 : Math.round(est);
	} catch {
		return -1;
	}
}
