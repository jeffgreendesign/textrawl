import { pgQuery } from '../../../db/pg-client.js';
import { logger } from '../../../utils/logger.js';
import type { BloatEstimate } from '../types.js';

/**
 * Estimate table bloat using pg_class + pg_stats heuristics.
 * This does not require pgstattuple extension.
 */
export async function getBloatEstimates(): Promise<BloatEstimate[]> {
	try {
		const { rows } = await pgQuery<{
			schemaname: string;
			tablename: string;
			type: string;
			current_size: string;
			bloat_size: string;
			bloat_ratio: string;
		}>(`
			WITH table_bloat AS (
				SELECT
					schemaname,
					tablename,
					'table' AS type,
					pg_size_pretty(pg_relation_size(schemaname || '.' || tablename)) AS current_size,
					CASE
						WHEN pg_relation_size(schemaname || '.' || tablename) > 0
						THEN pg_size_pretty(
							GREATEST(
								pg_relation_size(schemaname || '.' || tablename)
								- (c.reltuples * (
									SELECT SUM(avg_width) FROM pg_stats
									WHERE schemaname = s.schemaname AND tablename = s.tablename
								))::bigint,
								0
							)
						)
						ELSE '0 bytes'
					END AS bloat_size,
					CASE
						WHEN pg_relation_size(schemaname || '.' || tablename) > 0
							AND c.reltuples > 0
						THEN ROUND(
							(1.0 - (c.reltuples * COALESCE(
								(SELECT SUM(avg_width) FROM pg_stats
								 WHERE schemaname = s.schemaname AND tablename = s.tablename),
								0
							)) / pg_relation_size(schemaname || '.' || tablename))::numeric
							* 100, 1
						)
						ELSE 0
					END AS bloat_ratio
				FROM pg_stat_user_tables s
				JOIN pg_class c ON c.relname = s.relname
				JOIN pg_namespace n ON n.oid = c.relnamespace AND n.nspname = s.schemaname
				WHERE pg_relation_size(schemaname || '.' || tablename) > 8192
			)
			SELECT * FROM table_bloat
			WHERE bloat_ratio > 20
			ORDER BY bloat_ratio DESC
			LIMIT 20
		`);

		return rows.map((r) => ({
			schema: r.schemaname,
			table: r.tablename,
			type: 'table' as const,
			currentSize: r.current_size,
			estimatedBloat: r.bloat_size,
			bloatRatio: Number(r.bloat_ratio),
		}));
	} catch (err) {
		logger.warn('Bloat estimation failed', {
			error: err instanceof Error ? err.message : String(err),
		});
		return [];
	}
}
