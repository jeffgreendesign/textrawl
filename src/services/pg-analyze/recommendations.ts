import type {
	AnalysisReport,
	BloatEstimate,
	ConnectionStat,
	IndexStat,
	Recommendation,
	TableStat,
	TextrawlCheck,
	VacuumStat,
} from './types.js';

/** Quote a SQL identifier to prevent injection in suggestion strings. */
function quoteIdent(name: string): string {
	return `"${name.replace(/"/g, '""')}"`;
}

export function generateRecommendations(
	report: Omit<AnalysisReport, 'recommendations'>,
): Recommendation[] {
	const recs: Recommendation[] = [];

	recs.push(...checkMaintenance(report.vacuum, report.tables));
	recs.push(
		...checkPerformance(report.indexes, report.queries.length, report.pgStatStatementsAvailable),
	);
	recs.push(...checkStorage(report.bloat));
	recs.push(...checkConnections(report.connections));
	recs.push(...checkTextrawl(report.textrawl));

	// Sort: critical first, then warning, then info
	const order = { critical: 0, warning: 1, info: 2 };
	recs.sort((a, b) => order[a.severity] - order[b.severity]);

	return recs;
}

function checkMaintenance(vacuum: VacuumStat[], tables: TableStat[]): Recommendation[] {
	const recs: Recommendation[] = [];

	for (const v of vacuum) {
		const hasAnyVacuum = v.lastVacuum || v.lastAutovacuum;
		if (!hasAnyVacuum && v.liveTuples > 1000) {
			recs.push({
				severity: 'warning',
				category: 'maintenance',
				title: `Table "${v.table}" has never been vacuumed`,
				description: `${v.liveTuples} live rows and no vacuum history. Dead tuples may accumulate.`,
				suggestion: `VACUUM ANALYZE ${quoteIdent(v.schema)}.${quoteIdent(v.table)};`,
				reference: 'https://www.postgresql.org/docs/current/routine-vacuuming.html',
			});
		}
	}

	for (const t of tables) {
		if (t.deadTupleRatio > 0.2 && t.deadTuples > 1000) {
			recs.push({
				severity: t.deadTupleRatio > 0.5 ? 'critical' : 'warning',
				category: 'maintenance',
				title: `High dead tuple ratio on "${t.table}"`,
				description: `${(t.deadTupleRatio * 100).toFixed(1)}% dead tuples (${t.deadTuples} dead / ${t.liveTuples} live). Table bloat increasing.`,
				suggestion: `VACUUM (VERBOSE) ${quoteIdent(t.schema)}.${quoteIdent(t.table)};`,
				reference: 'https://www.postgresql.org/docs/current/routine-vacuuming.html',
			});
		}
	}

	// Check for tables with no recent analyze
	for (const v of vacuum) {
		if (!v.lastAnalyze && !v.lastAutoanalyze && v.liveTuples > 5000) {
			recs.push({
				severity: 'warning',
				category: 'maintenance',
				title: `Table "${v.table}" has never been analyzed`,
				description: 'Query planner statistics are missing — queries may use suboptimal plans.',
				suggestion: `ANALYZE ${quoteIdent(v.schema)}.${quoteIdent(v.table)};`,
				reference: 'https://www.postgresql.org/docs/current/sql-analyze.html',
			});
		}
	}

	return recs;
}

function checkPerformance(
	indexes: IndexStat[],
	queryCount: number,
	pgStatStatementsAvailable: boolean,
): Recommendation[] {
	const recs: Recommendation[] = [];

	// Unused indexes (>0 size, 0 scans, not unique/primary)
	const unused = indexes.filter(
		(i) =>
			i.scans === 0 &&
			!i.indexDef.includes('UNIQUE') &&
			!i.indexDef.includes('PRIMARY') &&
			!i.index.endsWith('_pkey'),
	);

	if (unused.length > 0) {
		const names = unused.slice(0, 5).map((i) => i.index);
		recs.push({
			severity: 'info',
			category: 'performance',
			title: `${unused.length} unused index${unused.length > 1 ? 'es' : ''} found`,
			description: `Indexes with 0 scans since last stats reset: ${names.join(', ')}${unused.length > 5 ? ` (+${unused.length - 5} more)` : ''}. These consume storage and slow writes.`,
			suggestion: unused
				.slice(0, 3)
				.map((i) => `DROP INDEX IF EXISTS ${quoteIdent(i.schema)}.${quoteIdent(i.index)};`)
				.join('\n'),
			reference: 'https://www.postgresql.org/docs/current/indexes-examine.html',
		});
	}

	// Duplicate indexes (same table, same definition pattern)
	const byTable = new Map<string, IndexStat[]>();
	for (const idx of indexes) {
		const key = `${idx.schema}.${idx.table}`;
		if (!byTable.has(key)) byTable.set(key, []);
		byTable.get(key)?.push(idx);
	}
	for (const [table, tableIndexes] of byTable) {
		const defs = new Map<string, { name: string; schema: string }[]>();
		for (const idx of tableIndexes) {
			// Normalize: strip index name to compare definitions
			const normalized = idx.indexDef.replace(/INDEX\s+\S+\s+ON/, 'INDEX _ ON');
			if (!defs.has(normalized)) defs.set(normalized, []);
			defs.get(normalized)?.push({ name: idx.index, schema: idx.schema });
		}
		for (const [, entries] of defs) {
			if (entries.length > 1) {
				const dup = entries[1];
				recs.push({
					severity: 'warning',
					category: 'performance',
					title: `Duplicate indexes on "${table}"`,
					description: `Indexes appear equivalent: ${entries.map((e) => e.name).join(', ')}. Remove duplicates to save storage and write overhead.`,
					suggestion: `-- Review and drop duplicate:\nDROP INDEX IF EXISTS ${quoteIdent(dup.schema)}.${quoteIdent(dup.name)};`,
				});
			}
		}
	}

	if (!pgStatStatementsAvailable) {
		recs.push({
			severity: 'info',
			category: 'performance',
			title: 'pg_stat_statements not available',
			description: 'Install pg_stat_statements for query performance insights.',
			suggestion: 'CREATE EXTENSION IF NOT EXISTS pg_stat_statements;',
			reference: 'https://www.postgresql.org/docs/current/pgstatstatements.html',
		});
	}

	return recs;
}

function checkStorage(bloat: BloatEstimate[]): Recommendation[] {
	const recs: Recommendation[] = [];

	const highBloat = bloat.filter((b) => b.bloatRatio > 50);
	if (highBloat.length > 0) {
		for (const b of highBloat.slice(0, 3)) {
			recs.push({
				severity: b.bloatRatio > 75 ? 'critical' : 'warning',
				category: 'storage',
				title: `High bloat on ${b.type} "${b.table}"`,
				description: `Estimated ${b.bloatRatio}% bloat (${b.estimatedBloat} wasted of ${b.currentSize}).`,
				suggestion:
					b.type === 'table'
						? `VACUUM FULL ${quoteIdent(b.schema)}.${quoteIdent(b.table)}; -- Requires ACCESS EXCLUSIVE lock`
						: `REINDEX INDEX CONCURRENTLY ${quoteIdent(b.schema)}.${quoteIdent(b.table)};`,
				reference: 'https://www.postgresql.org/docs/current/routine-vacuuming.html',
			});
		}
	}

	return recs;
}

function checkConnections(conn: ConnectionStat): Recommendation[] {
	const recs: Recommendation[] = [];

	if (conn.connectionUsagePercent > 80) {
		recs.push({
			severity: conn.connectionUsagePercent > 95 ? 'critical' : 'warning',
			category: 'performance',
			title: 'High connection usage',
			description: `${conn.totalConnections}/${conn.maxConnections} connections in use (${conn.connectionUsagePercent.toFixed(1)}%).`,
			suggestion: 'Consider using connection pooling (PgBouncer) or increasing max_connections.',
			reference: 'https://www.postgresql.org/docs/current/runtime-config-connection.html',
		});
	}

	if (conn.idleInTransaction > 3) {
		recs.push({
			severity: 'warning',
			category: 'performance',
			title: 'Idle-in-transaction connections',
			description: `${conn.idleInTransaction} connections are idle in transaction, holding locks and preventing vacuum.`,
			suggestion: `SET idle_in_transaction_session_timeout = '5min';`,
			reference: 'https://www.postgresql.org/docs/current/runtime-config-client.html',
		});
	}

	if (conn.longRunningQueries.length > 0) {
		recs.push({
			severity: 'warning',
			category: 'performance',
			title: `${conn.longRunningQueries.length} long-running quer${conn.longRunningQueries.length > 1 ? 'ies' : 'y'}`,
			description: `Queries running >30s. Longest: ${conn.longRunningQueries[0].duration}.`,
			suggestion:
				'Review and optimize long-running queries. Cancel with: SELECT pg_cancel_backend(<pid>);',
		});
	}

	return recs;
}

function checkTextrawl(checks: TextrawlCheck[]): Recommendation[] {
	const recs: Recommendation[] = [];

	for (const c of checks) {
		if (c.status === 'warning' && c.name.startsWith('hnsw:')) {
			recs.push({
				severity: 'critical',
				category: 'textrawl',
				title: 'Missing HNSW vector index',
				description: c.detail,
				suggestion:
					'Run the appropriate setup-db SQL script to create HNSW indexes for your embedding provider.',
			});
		}

		if (c.status === 'warning' && c.name.startsWith('fts:')) {
			recs.push({
				severity: 'warning',
				category: 'textrawl',
				title: 'Missing FTS index',
				description: c.detail,
				suggestion:
					'Run the appropriate setup-db SQL script to create GIN indexes for full-text search.',
			});
		}

		if (c.status === 'warning' && c.name === 'orphaned-chunks') {
			recs.push({
				severity: 'warning',
				category: 'textrawl',
				title: 'Orphaned chunks detected',
				description: c.detail,
				suggestion: 'DELETE FROM chunks WHERE document_id NOT IN (SELECT id FROM documents);',
			});
		}

		if (c.status === 'warning' && c.name === 'insight-queue') {
			recs.push({
				severity: 'warning',
				category: 'textrawl',
				title: 'Insight queue may be stuck',
				description: c.detail,
				suggestion: 'UPDATE insight_queue SET is_processing = false WHERE id = 1;',
			});
		}

		if (c.status === 'warning' && c.name.startsWith('rls:')) {
			recs.push({
				severity: 'critical',
				category: 'security',
				title: 'Row-Level Security not enabled',
				description: c.detail,
				suggestion:
					'Run scripts/security-rls.sql and scripts/security-rls-memory.sql to enable RLS.',
			});
		}
	}

	return recs;
}
