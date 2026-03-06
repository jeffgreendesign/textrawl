import { pgQuery } from '../../../db/pg-client.js';
import { logger } from '../../../utils/logger.js';
import type { QueryStat } from '../types.js';

export async function getQueryPerformance(): Promise<QueryStat[]> {
	// Check if pg_stat_statements is available
	try {
		const extCheck = await pgQuery<{ extname: string }>(
			`SELECT extname FROM pg_extension WHERE extname = 'pg_stat_statements'`,
		);
		if (extCheck.rows.length === 0) {
			logger.info('pg_stat_statements extension not installed — skipping query performance');
			return [];
		}
	} catch {
		logger.info('Could not check pg_stat_statements — skipping query performance');
		return [];
	}

	try {
		const { rows } = await pgQuery<{
			queryid: string;
			query: string;
			calls: string;
			total_exec_time: string;
			mean_exec_time: string;
			min_exec_time: string;
			max_exec_time: string;
			rows: string;
		}>(`
			SELECT
				queryid::text,
				LEFT(query, 300) AS query,
				calls,
				total_exec_time,
				mean_exec_time,
				min_exec_time,
				max_exec_time,
				rows
			FROM pg_stat_statements
			WHERE userid = (SELECT usesysid FROM pg_user WHERE usename = current_user)
			ORDER BY total_exec_time DESC
			LIMIT 20
		`);

		return rows.map((r) => ({
			queryId: r.queryid,
			query: r.query,
			calls: Number(r.calls),
			totalTime: Number(r.total_exec_time),
			meanTime: Number(r.mean_exec_time),
			minTime: Number(r.min_exec_time),
			maxTime: Number(r.max_exec_time),
			rows: Number(r.rows),
		}));
	} catch (err) {
		logger.warn('Failed to query pg_stat_statements', {
			error: err instanceof Error ? err.message : String(err),
		});
		return [];
	}
}
