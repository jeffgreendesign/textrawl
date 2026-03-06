import { pgQuery } from '../../../db/pg-client.js';
import type { ConnectionStat } from '../types.js';

/** Redact string literals from SQL to avoid leaking sensitive values in reports. */
function redactLiterals(sql: string): string {
	return sql.replace(/'[^']*'/g, "'***'");
}

export async function getConnectionStats(): Promise<ConnectionStat> {
	const [activityResult, maxResult] = await Promise.all([
		pgQuery<{
			state: string | null;
			count: string;
		}>(`
			SELECT state, COUNT(*) as count
			FROM pg_stat_activity
			WHERE backend_type = 'client backend'
			GROUP BY state
		`),
		pgQuery<{ setting: string }>(`
			SELECT setting FROM pg_settings WHERE name = 'max_connections'
		`),
	]);

	const maxConnections = Number(maxResult.rows[0]?.setting ?? 100);
	let total = 0;
	let active = 0;
	let idle = 0;
	let idleInTransaction = 0;

	for (const row of activityResult.rows) {
		const count = Number(row.count);
		total += count;
		if (row.state === 'active') active = count;
		else if (row.state === 'idle') idle = count;
		else if (row.state === 'idle in transaction') idleInTransaction = count;
	}

	// Long-running queries (>30 seconds)
	const longRunning = await pgQuery<{
		pid: number;
		duration: string;
		state: string;
		query: string;
	}>(`
		SELECT
			pid,
			now() - pg_stat_activity.query_start AS duration,
			state,
			LEFT(query, 200) AS query
		FROM pg_stat_activity
		WHERE state != 'idle'
			AND query NOT ILIKE '%pg_stat_activity%'
			AND now() - pg_stat_activity.query_start > interval '30 seconds'
		ORDER BY duration DESC
		LIMIT 10
	`);

	return {
		totalConnections: total,
		activeConnections: active,
		idleConnections: idle,
		idleInTransaction,
		maxConnections,
		connectionUsagePercent: (total / maxConnections) * 100,
		longRunningQueries: longRunning.rows.map((r) => ({
			pid: r.pid,
			duration: String(r.duration),
			state: r.state,
			query: redactLiterals(r.query),
		})),
	};
}
