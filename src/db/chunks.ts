import type { Chunk } from '../types/database.js';
import { DatabaseError } from '../utils/errors.js';
import { logger } from '../utils/logger.js';
import { incrementInsightQueue } from './insights.js';
import { isDatabaseConfigured, pgQuery } from './pg-client.js';

export interface CreateChunkInput {
	documentId: string;
	content: string;
	chunkIndex: number;
	startOffset?: number;
	endOffset?: number;
	embedding?: number[];
	metadata?: Record<string, unknown>;
}

/** Default max chunks per INSERT to avoid statement timeouts on large documents */
const DEFAULT_CHUNK_INSERT_BATCH_SIZE = 50;

/** Column count per row for the chunks INSERT */
const COLS_PER_ROW = 7;

/**
 * Create chunks for a document in batch
 * @param batchSize - Override chunk insert batch size (default: 50). Lower values reduce per-INSERT
 *   HNSW index maintenance cost, which helps avoid timeouts during bulk uploads.
 */
export async function createChunks(
	chunks: CreateChunkInput[],
	batchSize = DEFAULT_CHUNK_INSERT_BATCH_SIZE,
): Promise<void> {
	if (!isDatabaseConfigured()) {
		throw new DatabaseError('Supabase not configured');
	}

	if (chunks.length === 0) {
		return;
	}

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

		// Build parameterized multi-row INSERT
		const params: unknown[] = [];
		const valueClauses: string[] = [];

		for (let j = 0; j < batch.length; j++) {
			const base = j * COLS_PER_ROW + 1;
			const row = batch[j];
			valueClauses.push(
				`($${base}, $${base + 1}, $${base + 2}, $${base + 3}, $${base + 4}, $${base + 5}::vector, $${base + 6})`,
			);
			params.push(
				row.document_id,
				row.content,
				row.chunk_index,
				row.start_offset,
				row.end_offset,
				row.embedding ? JSON.stringify(row.embedding) : null,
				JSON.stringify(row.metadata),
			);
		}

		try {
			await pgQuery(
				`INSERT INTO chunks (document_id, content, chunk_index, start_offset, end_offset, embedding, metadata)
				 VALUES ${valueClauses.join(', ')}`,
				params,
			);
		} catch (error) {
			const message = error instanceof Error ? error.message : String(error);
			logger.error('Failed to create chunks', { error: message });
			throw new DatabaseError(`Failed to create chunks: ${message}`);
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
 * Retrieve all chunks belonging to a document, ordered by chunk index.
 *
 * @param documentId - The UUID of the parent document
 * @returns An array of chunks sorted by `chunk_index` in ascending order
 * @throws {DatabaseError} If Supabase is not configured or the query fails
 */
export async function getChunksForDocument(documentId: string): Promise<Chunk[]> {
	if (!isDatabaseConfigured()) {
		throw new DatabaseError('Supabase not configured');
	}

	try {
		const result = await pgQuery<Chunk>(
			'SELECT * FROM chunks WHERE document_id = $1 ORDER BY chunk_index ASC',
			[documentId],
		);

		return result.rows;
	} catch (error) {
		const message = error instanceof Error ? error.message : String(error);
		logger.error('Failed to get chunks', { error: message });
		throw new DatabaseError('Failed to get chunks');
	}
}
