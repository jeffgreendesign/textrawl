import { pgQuery } from '../../../db/pg-client.js';
import type { TableStat } from '../types.js';

export async function getTableStats(): Promise<TableStat[]> {
	const { rows } = await pgQuery<{
		schemaname: string;
		relname: string;
		n_live_tup: string;
		n_dead_tup: string;
		reltuples: string;
		total_size: string;
		table_size: string;
		index_size: string;
		toast_size: string;
	}>(`
		SELECT
			s.schemaname,
			s.relname,
			s.n_live_tup,
			s.n_dead_tup,
			c.reltuples,
			pg_size_pretty(pg_total_relation_size(c.oid)) AS total_size,
			pg_size_pretty(pg_relation_size(c.oid)) AS table_size,
			pg_size_pretty(pg_indexes_size(c.oid)) AS index_size,
			pg_size_pretty(
				pg_total_relation_size(c.oid) - pg_indexes_size(c.oid) - pg_relation_size(c.oid)
			) AS toast_size
		FROM pg_stat_user_tables s
		JOIN pg_class c ON c.relname = s.relname
		JOIN pg_namespace n ON n.oid = c.relnamespace AND n.nspname = s.schemaname
		ORDER BY pg_total_relation_size(c.oid) DESC
		LIMIT 500
	`);

	return rows.map((r) => {
		const live = Number(r.n_live_tup);
		const dead = Number(r.n_dead_tup);
		return {
			schema: r.schemaname,
			table: r.relname,
			rowEstimate: Number(r.reltuples),
			totalSize: r.total_size,
			tableSize: r.table_size,
			indexSize: r.index_size,
			toastSize: r.toast_size,
			deadTuples: dead,
			liveTuples: live,
			deadTupleRatio: live + dead > 0 ? dead / (live + dead) : 0,
		};
	});
}
