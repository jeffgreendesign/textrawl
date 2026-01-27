import { DatabaseError } from '../utils/errors.js';
import { logger } from '../utils/logger.js';
import { getSupabaseClient, isSupabaseConfigured } from './client.js';

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export type InsightType =
	| 'cross_source'
	| 'theme_cluster'
	| 'entity_bridge'
	| 'temporal_pattern'
	| 'outlier';

export type InsightStatus = 'new' | 'seen' | 'dismissed';

export interface ProactiveInsight {
	id: string;
	insight_type: InsightType;
	title: string;
	summary: string;
	evidence: Array<{
		chunkId: string;
		documentId: string;
		documentTitle?: string;
		content: string;
		score: number;
		sourceType?: string;
	}>;
	entities: string[];
	batch_id: string | null;
	status: InsightStatus;
	created_at: string;
	score?: number;
}

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

/** Increment the insight queue counter after chunk inserts */
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

/** Get current queue state */
export async function getInsightQueueState(): Promise<InsightQueueState | null> {
	if (!isSupabaseConfigured()) return null;

	const client = getSupabaseClient();
	const { data, error } = await client
		.from('insight_queue')
		.select('*')
		.eq('id', 1)
		.single();

	if (error) {
		logger.error('Failed to get insight queue state', { error: error.message });
		return null;
	}

	return data as InsightQueueState;
}

/** Check if scan should run (threshold reached + debounce elapsed) */
export async function shouldRunInsightScan(
	threshold: number = 50,
	debounceSeconds: number = 300,
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

/** Mark queue as processing / done */
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

/** Create one or more insights */
export async function createInsights(inputs: CreateInsightInput[]): Promise<ProactiveInsight[]> {
	if (!isSupabaseConfigured()) {
		throw new DatabaseError('Supabase not configured');
	}
	if (inputs.length === 0) return [];

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

	const { data, error } = await client.from('proactive_insights').insert(records).select();

	if (error) {
		logger.error('Failed to create insights', { error: error.message });
		throw new DatabaseError('Failed to create insights');
	}

	logger.info('Created insights', { count: data.length });
	return data as ProactiveInsight[];
}

/** Get insights with optional filters */
export async function getInsights(options: {
	status?: InsightStatus;
	insightType?: InsightType;
	limit?: number;
	offset?: number;
}): Promise<ProactiveInsight[]> {
	if (!isSupabaseConfigured()) {
		throw new DatabaseError('Supabase not configured');
	}

	const { status, insightType, limit = 20, offset = 0 } = options;
	const client = getSupabaseClient();

	let query = client
		.from('proactive_insights')
		.select('*')
		.order('created_at', { ascending: false })
		.range(offset, offset + limit - 1);

	if (status) query = query.eq('status', status);
	if (insightType) query = query.eq('insight_type', insightType);

	const { data, error } = await query;

	if (error) {
		logger.error('Failed to get insights', { error: error.message });
		throw new DatabaseError('Failed to get insights');
	}

	return data as ProactiveInsight[];
}

/** Semantic search over insights */
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
		logger.error('Insight semantic search failed', { error: error.message });
		throw new DatabaseError('Insight search failed');
	}

	return data as ProactiveInsight[];
}

/** Update insight status (new → seen, seen → dismissed) */
export async function updateInsightStatus(
	insightId: string,
	status: InsightStatus,
): Promise<void> {
	if (!isSupabaseConfigured()) {
		throw new DatabaseError('Supabase not configured');
	}

	const client = getSupabaseClient();
	const { error } = await client
		.from('proactive_insights')
		.update({ status })
		.eq('id', insightId);

	if (error) {
		logger.error('Failed to update insight status', { error: error.message });
		throw new DatabaseError('Failed to update insight status');
	}
}

/** Get insight stats */
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

	const [countResult, queueState] = await Promise.all([
		client.from('proactive_insights').select('id, status, insight_type'),
		getInsightQueueState(),
	]);

	if (countResult.error) {
		logger.error('Failed to get insight stats', { error: countResult.error.message });
		throw new DatabaseError('Failed to get insight stats');
	}

	const rows = countResult.data ?? [];
	const stats = {
		total: rows.length,
		new: 0,
		seen: 0,
		dismissed: 0,
		byType: {} as Record<string, number>,
		queueState,
	};

	for (const row of rows) {
		if (row.status === 'new') stats.new++;
		else if (row.status === 'seen') stats.seen++;
		else if (row.status === 'dismissed') stats.dismissed++;

		stats.byType[row.insight_type] = (stats.byType[row.insight_type] || 0) + 1;
	}

	return stats;
}
