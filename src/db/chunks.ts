import { DatabaseError } from '../utils/errors.js';
import { logger } from '../utils/logger.js';
import { type Chunk, getSupabaseClient, isSupabaseConfigured } from './client.js';
import { incrementInsightQueue } from './insights.js';

export interface CreateChunkInput {
	documentId: string;
	content: string;
	chunkIndex: number;
	startOffset?: number;
	endOffset?: number;
	embedding?: number[];
	metadata?: Record<string, unknown>;
}

/** Default max chunks per INSERT to avoid Supabase statement timeouts on large documents */
const DEFAULT_CHUNK_INSERT_BATCH_SIZE = 50;

/**
 * Create chunks for a document in batch
 * @param batchSize - Override chunk insert batch size (default: 50). Lower values reduce per-INSERT
 *   HNSW index maintenance cost, which helps avoid timeouts during bulk uploads.
 */
export async function createChunks(
	chunks: CreateChunkInput[],
	batchSize = DEFAULT_CHUNK_INSERT_BATCH_SIZE,
): Promise<void> {
	if (!isSupabaseConfigured()) {
		throw new DatabaseError('Supabase not configured');
	}

	if (chunks.length === 0) {
		return;
	}

	const client = getSupabaseClient();

	const records = chunks.map((chunk) => ({
		document_id: chunk.documentId,
		content: chunk.content,
		chunk_index: chunk.chunkIndex,
		start_offset: chunk.startOffset ?? null,
		end_offset: chunk.endOffset ?? null,
		embedding: chunk.embedding ?? null,
		metadata: chunk.metadata ?? {},
	}));

	for (let i = 0; i < records.length; i += batchSize) {
		const batch = records.slice(i, i + batchSize);
		const { error } = await client.from('chunks').insert(batch);

		if (error) {
			logger.error('Failed to create chunks', { error: error.message });
			throw new DatabaseError(`Failed to create chunks: ${error.message}`);
		}
	}

	logger.info('Created chunks', {
		documentId: chunks[0].documentId,
		count: chunks.length,
	});

	// Track chunk insertion for proactive insight queue (non-blocking)
	incrementInsightQueue(chunks.length).catch(() => {});
}

/**
 * Get chunks for a document
 */
export async function getChunksForDocument(documentId: string): Promise<Chunk[]> {
	if (!isSupabaseConfigured()) {
		throw new DatabaseError('Supabase not configured');
	}

	const client = getSupabaseClient();

	const { data, error } = await client
		.from('chunks')
		.select('*')
		.eq('document_id', documentId)
		.order('chunk_index', { ascending: true });

	if (error) {
		logger.error('Failed to get chunks', { error: error.message });
		throw new DatabaseError('Failed to get chunks');
	}

	return data as Chunk[];
}
