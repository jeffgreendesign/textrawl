import { pgQuery } from '../../../db/pg-client.js';
import type { VacuumStat } from '../types.js';

export async function getVacuumStats(): Promise<VacuumStat[]> {
	const { rows } = await pgQuery<{
		schemaname: string;
		relname: string;
		last_vacuum: string | null;
		last_autovacuum: string | null;
		last_analyze: string | null;
		last_autoanalyze: string | null;
		n_dead_tup: string;
		n_live_tup: string;
		vacuum_count: string;
		autovacuum_count: string;
	}>(`
		SELECT
			schemaname,
			relname,
			last_vacuum::text,
			last_autovacuum::text,
			last_analyze::text,
			last_autoanalyze::text,
			n_dead_tup,
			n_live_tup,
			vacuum_count,
			autovacuum_count
		FROM pg_stat_user_tables
		ORDER BY n_dead_tup DESC
	`);

	return rows.map((r) => ({
		schema: r.schemaname,
		table: r.relname,
		lastVacuum: r.last_vacuum,
		lastAutovacuum: r.last_autovacuum,
		lastAnalyze: r.last_analyze,
		lastAutoanalyze: r.last_autoanalyze,
		deadTuples: Number(r.n_dead_tup),
		liveTuples: Number(r.n_live_tup),
		vacuumCount: Number(r.vacuum_count),
		autovacuumCount: Number(r.autovacuum_count),
	}));
}
