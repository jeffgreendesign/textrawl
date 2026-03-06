import { pgQuery } from '../../../db/pg-client.js';
import type { IndexStat } from '../types.js';

export async function getIndexHealth(): Promise<IndexStat[]> {
	const { rows } = await pgQuery<{
		schemaname: string;
		relname: string;
		indexrelname: string;
		index_size: string;
		idx_scan: string;
		idx_tup_read: string;
		idx_tup_fetch: string;
		indexdef: string;
	}>(`
		SELECT
			s.schemaname,
			s.relname,
			s.indexrelname,
			pg_size_pretty(pg_relation_size(i.indexrelid)) AS index_size,
			s.idx_scan,
			s.idx_tup_read,
			s.idx_tup_fetch,
			pg_get_indexdef(i.indexrelid) AS indexdef
		FROM pg_stat_user_indexes s
		JOIN pg_index i ON i.indexrelid = s.indexrelid
		ORDER BY pg_relation_size(i.indexrelid) DESC
	`);

	return rows.map((r) => ({
		schema: r.schemaname,
		table: r.relname,
		index: r.indexrelname,
		size: r.index_size,
		scans: Number(r.idx_scan),
		tuplesRead: Number(r.idx_tup_read),
		tuplesFetched: Number(r.idx_tup_fetch),
		indexDef: r.indexdef,
	}));
}
