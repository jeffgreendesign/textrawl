import type { InsightStatus, InsightType, ProactiveInsight } from '../types/database.js';
import { DatabaseError, NotFoundError } from '../utils/errors.js';
import { logger } from '../utils/logger.js';
import { isDatabaseConfigured, pgQuery, queryCount, queryOne } from './pg-client.js';

// ---------------------------------------------------------------------------
// Types — re-exported from the canonical types module for backward compat
// ---------------------------------------------------------------------------

export type { InsightStatus, InsightType, ProactiveInsight } from '../types/database.js';

export interface CreateInsightInput {
	insightType: InsightType;
	title: string;
	summary: string;
	evidence: ProactiveInsight['evidence'];
	entities?: string[];
	embedding?: number[];
	batchId?: string;
}

export interface InsightQueueState {
	chunks_pending: number;
	last_insert_at: string | null;
	last_scan_at: string | null;
	is_processing: boolean;
}

// ---------------------------------------------------------------------------
// Queue operations
// ---------------------------------------------------------------------------

/**
 * Increment the insight queue counter after chunk inserts. This is called
 * non-blocking after chunk creation to track when a proactive insight scan
 * should be triggered. Silently logs errors without throwing.
 *
 * @param chunkCount - The number of chunks that were just inserted
 * @returns Resolves when the queue counter has been incremented (or on error)
 */
export async function incrementInsightQueue(chunkCount: number): Promise<void> {
	if (!isDatabaseConfigured()) return;

	try {
		await pgQuery('SELECT * FROM insight_queue_increment($1)', [chunkCount]);
	} catch (err) {
		// Non-fatal — don't break chunk insertion for insight tracking
		const message = err instanceof Error ? err.message : String(err);
		logger.error('Failed to increment insight queue', { error: message });
	}
}

/**
 * Get the current state of the insight processing queue, including the number of
 * pending chunks, last insert/scan timestamps, and whether processing is active.
 *
 * @returns The insight queue state, or `null` if the database is not configured or the query fails
 */
export async function getInsightQueueState(): Promise<InsightQueueState | null> {
	if (!isDatabaseConfigured()) return null;

	try {
		const row = await queryOne<{
			chunks_pending: number;
			last_insert_at: Date | string | null;
			last_scan_at: Date | string | null;
			is_processing: boolean;
		}>(
			'SELECT chunks_pending, last_insert_at, last_scan_at, is_processing FROM insight_queue WHERE id = 1',
		);
		if (!row) return null;
		// pg driver returns Date objects for TIMESTAMPTZ — convert at source
		return {
			chunks_pending: row.chunks_pending,
			is_processing: row.is_processing,
			last_insert_at:
				row.last_insert_at instanceof Date
					? row.last_insert_at.toISOString()
					: (row.last_insert_at ?? null),
			last_scan_at:
				row.last_scan_at instanceof Date
					? row.last_scan_at.toISOString()
					: (row.last_scan_at ?? null),
		};
	} catch (err) {
		const message = err instanceof Error ? err.message : String(err);
		logger.error('Failed to get insight queue state', { error: message });
		return null;
	}
}

/**
 * Check whether a proactive insight scan should be triggered based on the number of
 * pending chunks exceeding the threshold and sufficient time having elapsed since the
 * last scan (debounce).
 *
 * @param threshold - Minimum number of pending chunks to trigger a scan (default: 50)
 * @param debounceSeconds - Minimum seconds since last scan before allowing another (default: 300)
 * @returns An object indicating whether to scan and how many chunks are pending
 */
export async function shouldRunInsightScan(
	threshold = 50,
	debounceSeconds = 300,
): Promise<{ shouldScan: boolean; pending: number }> {
	if (!isDatabaseConfigured()) return { shouldScan: false, pending: 0 };

	try {
		const { rows } = await pgQuery<{ should_scan: boolean; pending: number }>(
			'SELECT * FROM insight_queue_check($1, $2)',
			[threshold, debounceSeconds],
		);

		const row = rows[0];
		return {
			shouldScan: row?.should_scan ?? false,
			pending: row?.pending ?? 0,
		};
	} catch (err) {
		const message = err instanceof Error ? err.message : String(err);
		logger.error('Failed to check insight queue', { error: message });
		return { shouldScan: false, pending: 0 };
	}
}

/**
 * Mark the insight queue as actively processing or done. When marking as done
 * (processing=false), the pending chunk count is reset to 0 and the last scan
 * timestamp is updated to now.
 *
 * @param processing - `true` to mark as processing, `false` to mark as done and reset counters
 * @returns Resolves when the queue state has been updated
 */
export async function setInsightQueueProcessing(processing: boolean): Promise<void> {
	if (!isDatabaseConfigured()) return;

	try {
		if (processing) {
			await pgQuery('UPDATE insight_queue SET is_processing = $1 WHERE id = 1', [true]);
		} else {
			await pgQuery(
				'UPDATE insight_queue SET is_processing = $1, chunks_pending = 0, last_scan_at = $2 WHERE id = 1',
				[false, new Date().toISOString()],
			);
		}
	} catch (err) {
		const message = err instanceof Error ? err.message : String(err);
		logger.error('Failed to update insight queue processing state', { error: message });
	}
}

// ---------------------------------------------------------------------------
// Insight CRUD
// ---------------------------------------------------------------------------

/**
 * Create one or more proactive insights in the database. Each insight includes
 * a type, title, summary, supporting evidence, and optional entities and embedding.
 *
 * @param inputs - Array of insight creation data
 * @returns Resolves when all insights have been inserted
 * @throws {DatabaseError} If the database is not configured or the batch insert fails
 */
export async function createInsights(inputs: CreateInsightInput[]): Promise<void> {
	if (!isDatabaseConfigured()) {
		throw new DatabaseError('Database not configured');
	}
	if (inputs.length === 0) return;

	// Build a multi-row INSERT with parameterised values
	const columns = '(insight_type, title, summary, evidence, entities, embedding, batch_id)';
	const params: unknown[] = [];
	const valueClauses: string[] = [];

	for (let i = 0; i < inputs.length; i++) {
		const input = inputs[i];
		const base = i * 7;
		valueClauses.push(
			`($${base + 1}, $${base + 2}, $${base + 3}, $${base + 4}, $${base + 5}, $${base + 6}::vector, $${base + 7})`,
		);
		params.push(
			input.insightType,
			input.title,
			input.summary,
			JSON.stringify(input.evidence),
			input.entities ?? [],
			input.embedding ? JSON.stringify(input.embedding) : null,
			input.batchId ?? null,
		);
	}

	try {
		await pgQuery(
			`INSERT INTO proactive_insights ${columns} VALUES ${valueClauses.join(', ')}`,
			params,
		);
		logger.info('Created insights', { count: inputs.length });
	} catch (err) {
		const message = err instanceof Error ? err.message : String(err);
		logger.error('Failed to create insights', { error: message });
		throw new DatabaseError(`Failed to create insights: ${message}`);
	}
}

/**
 * Retrieve proactive insights with optional filtering by status and/or type,
 * ordered by most recently created first.
 *
 * @param options - Filter and pagination options
 * @param options.status - Optional status filter ('new', 'seen', or 'dismissed')
 * @param options.insightType - Optional insight type filter
 * @param options.limit - Maximum number of insights to return (default: 20)
 * @param options.offset - Number of insights to skip for pagination (default: 0)
 * @returns An array of proactive insight records
 * @throws {DatabaseError} If the database is not configured or the query fails
 */
export async function getInsights(options: {
	status?: InsightStatus;
	insightType?: InsightType;
	limit?: number;
	offset?: number;
}): Promise<ProactiveInsight[]> {
	if (!isDatabaseConfigured()) {
		throw new DatabaseError('Database not configured');
	}

	const { status, insightType } = options;
	const clampedLimit = Math.max(1, options.limit ?? 20);
	const clampedOffset = Math.max(0, options.offset ?? 0);

	const conditions: string[] = [];
	const params: unknown[] = [];
	let paramIndex = 1;

	if (status) {
		conditions.push(`status = $${paramIndex++}`);
		params.push(status);
	}
	if (insightType) {
		conditions.push(`insight_type = $${paramIndex++}`);
		params.push(insightType);
	}

	const whereClause = conditions.length > 0 ? `WHERE ${conditions.join(' AND ')}` : '';
	params.push(clampedLimit, clampedOffset);

	try {
		const { rows } = await pgQuery<ProactiveInsight>(
			`SELECT * FROM proactive_insights ${whereClause}
			ORDER BY created_at DESC
			LIMIT $${paramIndex++} OFFSET $${paramIndex}`,
			params,
		);

		return rows;
	} catch (err) {
		const message = err instanceof Error ? err.message : String(err);
		logger.error('Failed to get insights', { error: message });
		throw new DatabaseError(`Failed to get insights: ${message}`);
	}
}

/**
 * Perform a semantic (vector similarity) search over proactive insights using the
 * `insight_semantic_search` database function.
 *
 * @param queryEmbedding - The vector embedding of the search query
 * @param options - Search configuration options
 * @param options.limit - Maximum number of results to return (default: 10)
 * @param options.status - Optional status filter to restrict results
 * @returns An array of proactive insights ranked by cosine similarity
 * @throws {DatabaseError} If the database is not configured or the search fails
 */
export async function searchInsights(
	queryEmbedding: number[],
	options: { limit?: number; status?: InsightStatus },
): Promise<ProactiveInsight[]> {
	if (!isDatabaseConfigured()) {
		throw new DatabaseError('Database not configured');
	}

	try {
		const { rows } = await pgQuery<ProactiveInsight>(
			'SELECT * FROM insight_semantic_search($1::vector, $2, $3)',
			[JSON.stringify(queryEmbedding), options.limit ?? 10, options.status ?? null],
		);

		return rows;
	} catch (err) {
		const message = err instanceof Error ? err.message : String(err);
		logger.error('Insight semantic search failed', { error: message });
		throw new DatabaseError(`Insight search failed: ${message}`);
	}
}

/**
 * Update the status of a proactive insight (e.g., new -> seen, seen -> dismissed).
 *
 * @param insightId - The UUID of the insight to update
 * @param status - The new status to set ('new', 'seen', or 'dismissed')
 * @returns Resolves when the status has been updated
 * @throws {NotFoundError} If no insight exists with the given ID
 * @throws {DatabaseError} If the database is not configured or the update fails
 */
export async function updateInsightStatus(insightId: string, status: InsightStatus): Promise<void> {
	if (!isDatabaseConfigured()) {
		throw new DatabaseError('Database not configured');
	}

	try {
		const { rowCount } = await pgQuery('UPDATE proactive_insights SET status = $1 WHERE id = $2', [
			status,
			insightId,
		]);

		if (!rowCount || rowCount === 0) {
			throw new NotFoundError(`Insight not found: ${insightId}`);
		}
	} catch (err) {
		if (err instanceof NotFoundError) throw err;
		const message = err instanceof Error ? err.message : String(err);
		logger.error('Failed to update insight status', { error: message });
		throw new DatabaseError(`Failed to update insight status: ${message}`);
	}
}

/**
 * Gather aggregate statistics about proactive insights, including total counts
 * broken down by status and type, plus the current insight queue state.
 *
 * @returns Insight statistics with totals by status, by type, and the queue state
 * @throws {DatabaseError} If the database is not configured or the query fails
 */
export async function getInsightStats(): Promise<{
	total: number;
	new: number;
	seen: number;
	dismissed: number;
	byType: Record<string, number>;
	queueState: InsightQueueState | null;
}> {
	if (!isDatabaseConfigured()) {
		throw new DatabaseError('Database not configured');
	}

	try {
		const [total, newCount, seenCount, dismissedCount, typeResult, queueState] = await Promise.all([
			queryCount('SELECT count(*) FROM proactive_insights'),
			queryCount("SELECT count(*) FROM proactive_insights WHERE status = 'new'"),
			queryCount("SELECT count(*) FROM proactive_insights WHERE status = 'seen'"),
			queryCount("SELECT count(*) FROM proactive_insights WHERE status = 'dismissed'"),
			pgQuery<{ insight_type: string }>('SELECT insight_type FROM proactive_insights'),
			getInsightQueueState(),
		]);

		const byType: Record<string, number> = {};
		for (const row of typeResult.rows) {
			byType[row.insight_type] = (byType[row.insight_type] || 0) + 1;
		}

		return {
			total,
			new: newCount,
			seen: seenCount,
			dismissed: dismissedCount,
			byType,
			queueState,
		};
	} catch (err) {
		if (err instanceof DatabaseError) throw err;
		const message = err instanceof Error ? err.message : String(err);
		logger.error('Failed to get insight stats', { error: message });
		throw new DatabaseError(`Failed to get insight stats: ${message}`);
	}
}

// ---------------------------------------------------------------------------
// Schema validation
// ---------------------------------------------------------------------------

/**
 * Check if the required insight tables (`proactive_insights` and `insight_queue`)
 * exist in the database. Returns validation status and a hint with the SQL scripts
 * to run if tables are missing.
 *
 * @returns Validation result with `valid` flag, list of missing tables, and a setup hint
 */
export async function validateInsightSchema(): Promise<{
	valid: boolean;
	missing: string[];
	hint: string;
}> {
	if (!isDatabaseConfigured()) {
		return { valid: false, missing: [], hint: 'Database not configured' };
	}

	const missing: string[] = [];

	// Check proactive_insights table
	try {
		await pgQuery('SELECT id FROM proactive_insights LIMIT 0');
	} catch {
		missing.push('proactive_insights');
	}

	// Check insight_queue table
	try {
		await pgQuery('SELECT id FROM insight_queue LIMIT 0');
	} catch {
		missing.push('insight_queue');
	}

	if (missing.length > 0) {
		return {
			valid: false,
			missing,
			hint: `Missing table(s): ${missing.join(', ')}. Run the appropriate setup-db-insights SQL script. See scripts/setup-db-insights.sql (OpenAI), scripts/setup-db-insights-ollama.sql (Ollama v1), or scripts/setup-db-insights-ollama-v2.sql (Ollama v2).`,
		};
	}

	return { valid: true, missing: [], hint: '' };
}
