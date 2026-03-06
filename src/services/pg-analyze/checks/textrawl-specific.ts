import { pgQuery } from '../../../db/pg-client.js';
import { logger } from '../../../utils/logger.js';
import type { TextrawlCheck } from '../types.js';

const TEXTRAWL_TABLES = [
	'documents',
	'chunks',
	'memory_entities',
	'memory_observations',
	'memory_relations',
	'conversation_sessions',
	'conversation_turns',
	'insight_queue',
	'proactive_insights',
];

const EXPECTED_HNSW_INDEXES = [
	{ table: 'chunks', column: 'embedding' },
	{ table: 'memory_entities', column: 'embedding' },
	{ table: 'memory_observations', column: 'embedding' },
	{ table: 'conversation_sessions', column: 'summary_embedding' },
	{ table: 'conversation_turns', column: 'embedding' },
	{ table: 'proactive_insights', column: 'embedding' },
];

const EXPECTED_FTS_INDEXES = [
	{ table: 'documents', column: 'fts' },
	{ table: 'memory_observations', column: 'fts' },
	{ table: 'conversation_sessions', column: 'summary_fts' },
	{ table: 'conversation_turns', column: 'fts' },
];

export async function getTextrawlChecks(): Promise<TextrawlCheck[]> {
	const checks: TextrawlCheck[] = [];

	// Check which Textrawl tables exist
	const { rows: existingTables } = await pgQuery<{ tablename: string }>(
		`
		SELECT tablename FROM pg_tables
		WHERE schemaname = 'public' AND tablename = ANY($1)
	`,
		[TEXTRAWL_TABLES],
	);
	const tableSet = new Set(existingTables.map((r) => r.tablename));

	for (const table of TEXTRAWL_TABLES) {
		if (!tableSet.has(table)) {
			checks.push({
				name: `table:${table}`,
				status: 'missing',
				detail: `Table "${table}" does not exist — feature may not be initialized`,
			});
		}
	}

	// Check HNSW vector indexes
	for (const { table, column } of EXPECTED_HNSW_INDEXES) {
		if (!tableSet.has(table)) continue;
		try {
			const { rows } = await pgQuery<{ indexdef: string }>(
				`
				SELECT pg_get_indexdef(i.indexrelid) AS indexdef
				FROM pg_index i
				JOIN pg_class c ON c.oid = i.indrelid
				JOIN pg_namespace n ON n.oid = c.relnamespace
				JOIN pg_class ic ON ic.oid = i.indexrelid
				WHERE n.nspname = 'public'
					AND c.relname = $1
					AND pg_get_indexdef(i.indexrelid) ILIKE $2
			`,
				[table, `%${column}%`],
			);

			const hasHnsw = rows.some((r) => r.indexdef.toLowerCase().includes('hnsw'));
			checks.push({
				name: `hnsw:${table}.${column}`,
				status: hasHnsw ? 'ok' : 'warning',
				detail: hasHnsw
					? `HNSW index exists on ${table}.${column}`
					: `No HNSW index on ${table}.${column} — vector searches will be slow`,
			});
		} catch (err) {
			checks.push({
				name: `hnsw:${table}.${column}`,
				status: 'error',
				detail: `Error checking index: ${err instanceof Error ? err.message : String(err)}`,
			});
		}
	}

	// Check GIN FTS indexes
	for (const { table, column } of EXPECTED_FTS_INDEXES) {
		if (!tableSet.has(table)) continue;
		try {
			const { rows } = await pgQuery<{ indexdef: string }>(
				`
				SELECT pg_get_indexdef(i.indexrelid) AS indexdef
				FROM pg_index i
				JOIN pg_class c ON c.oid = i.indrelid
				JOIN pg_namespace n ON n.oid = c.relnamespace
				WHERE n.nspname = 'public'
					AND c.relname = $1
					AND pg_get_indexdef(i.indexrelid) ILIKE $2
			`,
				[table, `%${column}%`],
			);

			const hasGin = rows.some((r) => r.indexdef.toLowerCase().includes('gin'));
			checks.push({
				name: `fts:${table}.${column}`,
				status: hasGin ? 'ok' : 'warning',
				detail: hasGin
					? `GIN FTS index exists on ${table}.${column}`
					: `No GIN index on ${table}.${column} — full-text search will be slow`,
			});
		} catch (err) {
			checks.push({
				name: `fts:${table}.${column}`,
				status: 'error',
				detail: `Error checking index: ${err instanceof Error ? err.message : String(err)}`,
			});
		}
	}

	// Check for orphaned chunks
	if (tableSet.has('chunks') && tableSet.has('documents')) {
		try {
			const { rows } = await pgQuery<{ orphaned: string }>(`
				SELECT COUNT(*) AS orphaned
				FROM chunks c
				LEFT JOIN documents d ON d.id = c.document_id
				WHERE d.id IS NULL
			`);
			const orphaned = Number(rows[0]?.orphaned ?? 0);
			checks.push({
				name: 'orphaned-chunks',
				status: orphaned > 0 ? 'warning' : 'ok',
				detail:
					orphaned > 0
						? `${orphaned} orphaned chunks found (no matching document)`
						: 'No orphaned chunks',
			});
		} catch (err) {
			logger.warn('Orphaned chunk check failed', {
				error: err instanceof Error ? err.message : String(err),
			});
		}
	}

	// Check insight_queue state
	if (tableSet.has('insight_queue')) {
		try {
			const { rows } = await pgQuery<{
				is_processing: boolean;
				chunks_pending: string;
				last_scan_at: string | null;
			}>(
				'SELECT is_processing, chunks_pending, last_scan_at::text FROM insight_queue WHERE id = 1',
			);

			if (rows.length > 0) {
				const q = rows[0];
				const isStuck = q.is_processing;
				checks.push({
					name: 'insight-queue',
					status: isStuck ? 'warning' : 'ok',
					detail: isStuck
						? `Insight queue is_processing=true (may be stuck). Pending: ${q.chunks_pending}`
						: `Insight queue healthy. Pending: ${q.chunks_pending}`,
				});
			}
		} catch (err) {
			logger.warn('Insight queue check failed', {
				error: err instanceof Error ? err.message : String(err),
			});
		}
	}

	// Check RLS on Textrawl tables
	for (const table of TEXTRAWL_TABLES) {
		if (!tableSet.has(table)) continue;
		try {
			const { rows } = await pgQuery<{ rowsecurity: boolean }>(
				`
				SELECT relrowsecurity AS rowsecurity
				FROM pg_class c
				JOIN pg_namespace n ON n.oid = c.relnamespace
				WHERE n.nspname = 'public' AND c.relname = $1
			`,
				[table],
			);

			if (rows.length > 0) {
				checks.push({
					name: `rls:${table}`,
					status: rows[0].rowsecurity ? 'ok' : 'warning',
					detail: rows[0].rowsecurity
						? `RLS enabled on ${table}`
						: `RLS NOT enabled on ${table} — run security-rls.sql`,
				});
			}
		} catch (err) {
			logger.warn(`RLS check failed for ${table}`, {
				error: err instanceof Error ? err.message : String(err),
			});
		}
	}

	return checks;
}
