import type { MemoryObservation, ObservationSource } from '../types/database.js';
import { DatabaseError, NotFoundError } from '../utils/errors.js';
import { logger } from '../utils/logger.js';
import { isDatabaseConfigured, pgQuery, queryOne, queryOneOrThrow } from './pg-client.js';

export type { MemoryObservation, ObservationSource };

export interface CreateObservationInput {
	entityId: string;
	content: string;
	source?: ObservationSource;
	confidence?: number;
	validUntil?: string | null;
	embedding?: number[];
	metadata?: Record<string, unknown>;
}

export interface CreateObservationBatchInput {
	entityId: string;
	observations: Array<{
		content: string;
		source?: ObservationSource;
		confidence?: number;
		validUntil?: string | null;
		embedding?: number[];
		metadata?: Record<string, unknown>;
	}>;
}

/**
 * Create a new observation (atomic fact) associated with a memory entity.
 *
 * @param input - Observation creation data
 * @param input.entityId - The UUID of the parent entity
 * @param input.content - The text content of the observation
 * @param input.source - Source of the observation (default: 'conversation')
 * @param input.confidence - Confidence score from 0 to 1 (default: 1.0)
 * @param input.validUntil - Optional ISO date string after which the observation expires
 * @param input.embedding - Optional vector embedding for semantic search
 * @param input.metadata - Optional metadata key-value pairs
 * @returns The newly created memory observation record
 * @throws {DatabaseError} If the database is not configured or the insert fails
 */
export async function createObservation(input: CreateObservationInput): Promise<MemoryObservation> {
	if (!isDatabaseConfigured()) {
		throw new DatabaseError('Supabase not configured');
	}

	try {
		const obs = await queryOneOrThrow<MemoryObservation>(
			`INSERT INTO memory_observations (entity_id, content, source, confidence, valid_until, embedding, metadata)
			 VALUES ($1, $2, $3, $4, $5, $6::vector, $7)
			 RETURNING *`,
			[
				input.entityId,
				input.content,
				input.source || 'conversation',
				input.confidence ?? 1.0,
				input.validUntil || null,
				input.embedding ? JSON.stringify(input.embedding) : null,
				JSON.stringify(input.metadata || {}),
			],
			'Observation',
		);

		logger.info('Created memory observation', {
			id: obs.id,
			entityId: input.entityId,
			contentLength: input.content.length,
		});
		return obs;
	} catch (error) {
		if (error instanceof NotFoundError) {
			throw new DatabaseError('Failed to create observation: no row returned');
		}
		const message = error instanceof Error ? error.message : String(error);
		logger.error('Failed to create observation', { error: message });
		throw new DatabaseError('Failed to create observation');
	}
}

/**
 * Create multiple observations in batch
 */
export async function createObservations(input: CreateObservationBatchInput): Promise<void> {
	if (!isDatabaseConfigured()) {
		throw new DatabaseError('Supabase not configured');
	}

	if (input.observations.length === 0) {
		return;
	}

	try {
		// Build a multi-row INSERT with parameterized values
		const values: string[] = [];
		const params: unknown[] = [];
		let paramIndex = 1;

		for (const obs of input.observations) {
			values.push(
				`($${paramIndex++}, $${paramIndex++}, $${paramIndex++}, $${paramIndex++}, $${paramIndex++}, $${paramIndex++}::vector, $${paramIndex++})`,
			);
			params.push(
				input.entityId,
				obs.content,
				obs.source || 'conversation',
				obs.confidence ?? 1.0,
				obs.validUntil || null,
				obs.embedding ? JSON.stringify(obs.embedding) : null,
				JSON.stringify(obs.metadata || {}),
			);
		}

		await pgQuery(
			`INSERT INTO memory_observations (entity_id, content, source, confidence, valid_until, embedding, metadata)
			 VALUES ${values.join(', ')}`,
			params,
		);

		logger.info('Created memory observations batch', {
			entityId: input.entityId,
			count: input.observations.length,
		});
	} catch (error) {
		const message = error instanceof Error ? error.message : String(error);
		logger.error('Failed to create observations batch', { error: message });
		throw new DatabaseError('Failed to create observations');
	}
}

/**
 * Get observation by ID
 */
export async function getObservation(id: string): Promise<MemoryObservation> {
	if (!isDatabaseConfigured()) {
		throw new DatabaseError('Supabase not configured');
	}

	try {
		return await queryOneOrThrow<MemoryObservation>(
			'SELECT * FROM memory_observations WHERE id = $1',
			[id],
			`Observation not found: ${id}`,
		);
	} catch (error) {
		if (error instanceof NotFoundError) throw error;
		const message = error instanceof Error ? error.message : String(error);
		logger.error('Failed to get observation', { error: message });
		throw new DatabaseError('Failed to get observation');
	}
}

/**
 * Get all observations for an entity
 */
export async function getObservationsForEntity(
	entityId: string,
	options: {
		includeExpired?: boolean;
		limit?: number;
	} = {},
): Promise<MemoryObservation[]> {
	if (!isDatabaseConfigured()) {
		throw new DatabaseError('Supabase not configured');
	}

	const { includeExpired = false, limit = 100 } = options;

	try {
		let expiryClause = '';
		if (!includeExpired) {
			expiryClause = 'AND (valid_until IS NULL OR valid_until > now())';
		}

		const { rows } = await pgQuery<MemoryObservation>(
			`SELECT * FROM memory_observations
			 WHERE entity_id = $1 ${expiryClause}
			 ORDER BY created_at DESC
			 LIMIT $2`,
			[entityId, limit],
		);

		return rows;
	} catch (error) {
		const message = error instanceof Error ? error.message : String(error);
		logger.error('Failed to get observations for entity', { error: message });
		throw new DatabaseError('Failed to get observations');
	}
}

/**
 * Update observation embedding
 */
export async function updateObservationEmbedding(
	id: string,
	embedding: number[],
): Promise<MemoryObservation> {
	if (!isDatabaseConfigured()) {
		throw new DatabaseError('Supabase not configured');
	}

	try {
		return await queryOneOrThrow<MemoryObservation>(
			'UPDATE memory_observations SET embedding = $1::vector WHERE id = $2 RETURNING *',
			[JSON.stringify(embedding), id],
			`Observation not found: ${id}`,
		);
	} catch (error) {
		if (error instanceof NotFoundError) throw error;
		const message = error instanceof Error ? error.message : String(error);
		logger.error('Failed to update observation embedding', { error: message });
		throw new DatabaseError('Failed to update observation');
	}
}

/**
 * Delete an observation
 */
export async function deleteObservation(id: string): Promise<void> {
	if (!isDatabaseConfigured()) {
		throw new DatabaseError('Supabase not configured');
	}

	try {
		await pgQuery('DELETE FROM memory_observations WHERE id = $1', [id]);
		logger.info('Deleted memory observation', { id });
	} catch (error) {
		const message = error instanceof Error ? error.message : String(error);
		logger.error('Failed to delete observation', { error: message });
		throw new DatabaseError('Failed to delete observation');
	}
}

/**
 * Delete observations by content match (for deduplication)
 */
export async function deleteObservationByContent(
	entityId: string,
	content: string,
): Promise<number> {
	if (!isDatabaseConfigured()) {
		throw new DatabaseError('Supabase not configured');
	}

	try {
		const { rows } = await pgQuery<{ id: string }>(
			'DELETE FROM memory_observations WHERE entity_id = $1 AND content = $2 RETURNING id',
			[entityId, content],
		);

		return rows.length;
	} catch (error) {
		const message = error instanceof Error ? error.message : String(error);
		logger.error('Failed to delete observation by content', { error: message });
		throw new DatabaseError('Failed to delete observation');
	}
}

/**
 * Check if a similar observation already exists for deduplication purposes.
 *
 * Two-stage check:
 *  1. Exact string match (fast, no embedding needed)
 *  2. Semantic similarity via embedding (requires `embedding` param)
 *     Calls the memory_semantic_search() Postgres function with top-10 matches,
 *     then filters by entity_id and checks against `similarityThreshold` (default 0.95).
 *
 * @param entityId - The UUID of the entity to check observations for
 * @param content - The observation text to check for duplicates
 * @param similarityThreshold - Minimum cosine similarity to consider a semantic duplicate (default: 0.95)
 * @param embedding - Optional vector embedding to enable semantic similarity checking
 * @returns The existing duplicate observation if found, or `null` if no duplicate exists
 * @throws {DatabaseError} If the database is not configured or the exact-match query fails
 */
export async function findSimilarObservation(
	entityId: string,
	content: string,
	similarityThreshold = 0.95,
	embedding?: number[],
): Promise<MemoryObservation | null> {
	if (!isDatabaseConfigured()) {
		throw new DatabaseError('Supabase not configured');
	}

	try {
		// Stage 1: Exact string match (fast path)
		const exactMatch = await queryOne<MemoryObservation>(
			'SELECT * FROM memory_observations WHERE entity_id = $1 AND content = $2 LIMIT 1',
			[entityId, content],
		);

		if (exactMatch) {
			return exactMatch;
		}

		// Stage 2: Semantic similarity check via embedding
		if (embedding) {
			try {
				const { rows: semanticMatches } = await pgQuery<Record<string, unknown>>(
					'SELECT * FROM memory_semantic_search($1::vector, $2, $3, $4)',
					[JSON.stringify(embedding), 10, null, false],
				);

				for (const row of semanticMatches) {
					if (
						row.entity_id === entityId &&
						typeof row.similarity === 'number' &&
						row.similarity >= similarityThreshold
					) {
						logger.debug('Semantic duplicate found', {
							entityId,
							observationId: row.observation_id,
							similarity: row.similarity,
							threshold: similarityThreshold,
						});
						return {
							id: row.observation_id as string,
							entity_id: row.entity_id as string,
							content: row.observation_content as string,
							source: row.source as ObservationSource,
							confidence: (row.confidence as number) ?? 1.0,
							valid_from: '',
							valid_until: null,
							embedding: null,
							metadata: {},
							created_at: '',
						};
					}
				}
			} catch (semanticError) {
				// Non-fatal: log and fall through to return null
				const message =
					semanticError instanceof Error ? semanticError.message : String(semanticError);
				logger.warn('Semantic dedup search failed, falling back to exact match only', {
					error: message,
				});
				return null;
			}
		}

		return null;
	} catch (error) {
		const message = error instanceof Error ? error.message : String(error);
		logger.error('Failed to find similar observation', { error: message });
		throw new DatabaseError('Failed to find observation');
	}
}

/**
 * Expire an observation (set valid_until to now)
 */
export async function expireObservation(id: string): Promise<void> {
	if (!isDatabaseConfigured()) {
		throw new DatabaseError('Supabase not configured');
	}

	try {
		await pgQuery('UPDATE memory_observations SET valid_until = $1 WHERE id = $2', [
			new Date().toISOString(),
			id,
		]);
		logger.info('Expired memory observation', { id });
	} catch (error) {
		const message = error instanceof Error ? error.message : String(error);
		logger.error('Failed to expire observation', { error: message });
		throw new DatabaseError('Failed to expire observation');
	}
}
