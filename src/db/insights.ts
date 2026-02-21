import type { InsightStatus, InsightType, ProactiveInsight } from '../types/database.js';
import { DatabaseError, NotFoundError } from '../utils/errors.js';
import { logger } from '../utils/logger.js';
import { getSupabaseClient, isSupabaseConfigured } from './client.js';

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
	if (!isSupabaseConfigured()) return;

	const client = getSupabaseClient();
	const { error } = await client.rpc('insight_queue_increment', {
		chunk_count: chunkCount,
	});

	if (error) {
		// Non-fatal — don't break chunk insertion for insight tracking
		logger.error('Failed to increment insight queue', { error: error.message });
	}
}

/**
 * Get the current state of the insight processing queue, including the number of
 * pending chunks, last insert/scan timestamps, and whether processing is active.
 *
 * @returns The insight queue state, or `null` if Supabase is not configured or the query fails
 */
export async function getInsightQueueState(): Promise<InsightQueueState | null> {
	if (!isSupabaseConfigured()) return null;

	const client = getSupabaseClient();
	const { data, error } = await client.from('insight_queue').select('*').eq('id', 1).single();

	if (error) {
		logger.error('Failed to get insight queue state', {
			error: error.message,
			code: error.code,
			details: error.details,
			hint: error.hint,
		});
		return null;
	}

	return data as InsightQueueState;
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
	if (!isSupabaseConfigured()) return { shouldScan: false, pending: 0 };

	const client = getSupabaseClient();
	const { data, error } = await client.rpc('insight_queue_check', {
		threshold,
		debounce_seconds: debounceSeconds,
	});

	if (error) {
		logger.error('Failed to check insight queue', { error: error.message });
		return { shouldScan: false, pending: 0 };
	}

	const row = data?.[0];
	return {
		shouldScan: row?.should_scan ?? false,
		pending: row?.pending ?? 0,
	};
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
	if (!isSupabaseConfigured()) return;

	const client = getSupabaseClient();
	const update: Record<string, unknown> = { is_processing: processing };
	if (!processing) {
		update.chunks_pending = 0;
		update.last_scan_at = new Date().toISOString();
	}

	const { error } = await client.from('insight_queue').update(update).eq('id', 1);

	if (error) {
		logger.error('Failed to update insight queue processing state', { error: error.message });
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
 * @throws {DatabaseError} If Supabase is not configured or the batch insert fails
 */
export async function createInsights(inputs: CreateInsightInput[]): Promise<void> {
	if (!isSupabaseConfigured()) {
		throw new DatabaseError('Supabase not configured');
	}
	if (inputs.length === 0) return;

	const client = getSupabaseClient();

	const records = inputs.map((input) => ({
		insight_type: input.insightType,
		title: input.title,
		summary: input.summary,
		evidence: input.evidence,
		entities: input.entities ?? [],
		embedding: input.embedding ?? null,
		batch_id: input.batchId ?? null,
	}));

	const { error } = await client.from('proactive_insights').insert(records);

	if (error) {
		logger.error('Failed to create insights', {
			error: error.message,
			code: error.code,
			details: error.details,
			hint: error.hint,
		});
		throw new DatabaseError(`Failed to create insights: ${error.message}`);
	}

	logger.info('Created insights', { count: records.length });
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
 * @throws {DatabaseError} If Supabase is not configured or the query fails
 */
export async function getInsights(options: {
	status?: InsightStatus;
	insightType?: InsightType;
	limit?: number;
	offset?: number;
}): Promise<ProactiveInsight[]> {
	if (!isSupabaseConfigured()) {
		throw new DatabaseError('Supabase not configured');
	}

	const { status, insightType } = options;
	const clampedLimit = Math.max(1, options.limit ?? 20);
	const clampedOffset = Math.max(0, options.offset ?? 0);
	const client = getSupabaseClient();

	let query = client
		.from('proactive_insights')
		.select('*')
		.order('created_at', { ascending: false })
		.range(clampedOffset, clampedOffset + clampedLimit - 1);

	if (status) query = query.eq('status', status);
	if (insightType) query = query.eq('insight_type', insightType);

	const { data, error } = await query;

	if (error) {
		logger.error('Failed to get insights', {
			error: error.message,
			code: error.code,
			details: error.details,
			hint: error.hint,
		});
		throw new DatabaseError(`Failed to get insights: ${error.message}`);
	}

	return data as ProactiveInsight[];
}

/**
 * Perform a semantic (vector similarity) search over proactive insights using the
 * `insight_semantic_search` Supabase RPC.
 *
 * @param queryEmbedding - The vector embedding of the search query
 * @param options - Search configuration options
 * @param options.limit - Maximum number of results to return (default: 10)
 * @param options.status - Optional status filter to restrict results
 * @returns An array of proactive insights ranked by cosine similarity
 * @throws {DatabaseError} If Supabase is not configured or the search RPC fails
 */
export async function searchInsights(
	queryEmbedding: number[],
	options: { limit?: number; status?: InsightStatus },
): Promise<ProactiveInsight[]> {
	if (!isSupabaseConfigured()) {
		throw new DatabaseError('Supabase not configured');
	}

	const client = getSupabaseClient();
	const { data, error } = await client.rpc('insight_semantic_search', {
		query_embedding: queryEmbedding,
		match_count: options.limit ?? 10,
		status_filter: options.status ?? null,
	});

	if (error) {
		logger.error('Insight semantic search failed', {
			error: error.message,
			code: error.code,
			details: error.details,
			hint: error.hint,
		});
		throw new DatabaseError(`Insight search failed: ${error.message}`);
	}

	return data as ProactiveInsight[];
}

/**
 * Update the status of a proactive insight (e.g., new -> seen, seen -> dismissed).
 *
 * @param insightId - The UUID of the insight to update
 * @param status - The new status to set ('new', 'seen', or 'dismissed')
 * @returns Resolves when the status has been updated
 * @throws {NotFoundError} If no insight exists with the given ID
 * @throws {DatabaseError} If Supabase is not configured or the update fails
 */
export async function updateInsightStatus(insightId: string, status: InsightStatus): Promise<void> {
	if (!isSupabaseConfigured()) {
		throw new DatabaseError('Supabase not configured');
	}

	const client = getSupabaseClient();
	const { data, error } = await client
		.from('proactive_insights')
		.update({ status })
		.eq('id', insightId)
		.select('id');

	if (error) {
		logger.error('Failed to update insight status', {
			error: error.message,
			code: error.code,
			details: error.details,
			hint: error.hint,
		});
		throw new DatabaseError(`Failed to update insight status: ${error.message}`);
	}

	if (!data || data.length === 0) {
		throw new NotFoundError(`Insight not found: ${insightId}`);
	}
}

/**
 * Gather aggregate statistics about proactive insights, including total counts
 * broken down by status and type, plus the current insight queue state.
 *
 * @returns Insight statistics with totals by status, by type, and the queue state
 * @throws {DatabaseError} If Supabase is not configured or the query fails
 */
export async function getInsightStats(): Promise<{
	total: number;
	new: number;
	seen: number;
	dismissed: number;
	byType: Record<string, number>;
	queueState: InsightQueueState | null;
}> {
	if (!isSupabaseConfigured()) {
		throw new DatabaseError('Supabase not configured');
	}

	const client = getSupabaseClient();

	// Use efficient count queries instead of fetching all rows.
	// Status counts use head:true (no data returned), byType still needs rows
	// but selects only insight_type to minimise transfer.
	const [totalResult, newResult, seenResult, dismissedResult, typeResult, queueState] =
		await Promise.all([
			client.from('proactive_insights').select('*', { count: 'exact', head: true }),
			client
				.from('proactive_insights')
				.select('*', { count: 'exact', head: true })
				.eq('status', 'new'),
			client
				.from('proactive_insights')
				.select('*', { count: 'exact', head: true })
				.eq('status', 'seen'),
			client
				.from('proactive_insights')
				.select('*', { count: 'exact', head: true })
				.eq('status', 'dismissed'),
			client.from('proactive_insights').select('insight_type'),
			getInsightQueueState(),
		]);

	// Validate every query result — any single failure should surface immediately
	for (const [name, result] of [
		['totalResult', totalResult],
		['newResult', newResult],
		['seenResult', seenResult],
		['dismissedResult', dismissedResult],
		['typeResult', typeResult],
	] as const) {
		if (result.error) {
			logger.error(`Failed to get insight stats (${name})`, {
				error: result.error.message,
				code: result.error.code,
				details: result.error.details,
				hint: result.error.hint,
			});
			throw new DatabaseError(`Failed to get insight stats (${name}): ${result.error.message}`);
		}
	}

	const byType: Record<string, number> = {};
	for (const row of typeResult.data ?? []) {
		byType[row.insight_type] = (byType[row.insight_type] || 0) + 1;
	}

	return {
		total: totalResult.count || 0,
		new: newResult.count || 0,
		seen: seenResult.count || 0,
		dismissed: dismissedResult.count || 0,
		byType,
		queueState,
	};
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
	if (!isSupabaseConfigured()) {
		return { valid: false, missing: [], hint: 'Supabase not configured' };
	}

	const client = getSupabaseClient();
	const missing: string[] = [];

	// Check proactive_insights table
	const { error: insightsError } = await client.from('proactive_insights').select('id').limit(0);
	if (insightsError) {
		missing.push('proactive_insights');
	}

	// Check insight_queue table
	const { error: queueError } = await client.from('insight_queue').select('id').limit(0);
	if (queueError) {
		missing.push('insight_queue');
	}

	if (missing.length > 0) {
		return {
			valid: false,
			missing,
			hint: `Missing table(s): ${missing.join(', ')}. Run the appropriate setup-db-insights SQL script in your Supabase SQL Editor. See scripts/setup-db-insights.sql (OpenAI), scripts/setup-db-insights-ollama.sql (Ollama v1), or scripts/setup-db-insights-ollama-v2.sql (Ollama v2).`,
		};
	}

	return { valid: true, missing: [], hint: '' };
}
