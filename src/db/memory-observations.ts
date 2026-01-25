import { DatabaseError, NotFoundError } from '../utils/errors.js';
import { logger } from '../utils/logger.js';
import { getSupabaseClient, isSupabaseConfigured } from './client.js';

/**
 * Memory Observation type definition
 */
export interface MemoryObservation {
	id: string;
	entity_id: string;
	content: string;
	source: ObservationSource;
	confidence: number;
	valid_from: string;
	valid_until: string | null;
	embedding: number[] | null;
	metadata: Record<string, unknown>;
	created_at: string;
}

export type ObservationSource = 'conversation' | 'note' | 'document' | 'manual' | 'extraction';

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
 * Create a new observation for an entity
 */
export async function createObservation(input: CreateObservationInput): Promise<MemoryObservation> {
	if (!isSupabaseConfigured()) {
		throw new DatabaseError('Supabase not configured');
	}

	const client = getSupabaseClient();

	const { data, error } = await client
		.from('memory_observations')
		.insert({
			entity_id: input.entityId,
			content: input.content,
			source: input.source || 'conversation',
			confidence: input.confidence ?? 1.0,
			valid_until: input.validUntil || null,
			embedding: input.embedding || null,
			metadata: input.metadata || {},
		})
		.select()
		.single();

	if (error) {
		logger.error('Failed to create observation', { error: error.message });
		throw new DatabaseError('Failed to create observation');
	}

	logger.info('Created memory observation', {
		id: data.id,
		entityId: input.entityId,
		contentLength: input.content.length,
	});
	return data as MemoryObservation;
}

/**
 * Create multiple observations in batch
 */
export async function createObservations(
	input: CreateObservationBatchInput,
): Promise<MemoryObservation[]> {
	if (!isSupabaseConfigured()) {
		throw new DatabaseError('Supabase not configured');
	}

	if (input.observations.length === 0) {
		return [];
	}

	const client = getSupabaseClient();

	const rows = input.observations.map((obs) => ({
		entity_id: input.entityId,
		content: obs.content,
		source: obs.source || 'conversation',
		confidence: obs.confidence ?? 1.0,
		valid_until: obs.validUntil || null,
		embedding: obs.embedding || null,
		metadata: obs.metadata || {},
	}));

	const { data, error } = await client.from('memory_observations').insert(rows).select();

	if (error) {
		logger.error('Failed to create observations batch', {
			error: error.message,
		});
		throw new DatabaseError('Failed to create observations');
	}

	logger.info('Created memory observations batch', {
		entityId: input.entityId,
		count: data.length,
	});
	return data as MemoryObservation[];
}

/**
 * Get observation by ID
 */
export async function getObservation(id: string): Promise<MemoryObservation> {
	if (!isSupabaseConfigured()) {
		throw new DatabaseError('Supabase not configured');
	}

	const client = getSupabaseClient();

	const { data, error } = await client
		.from('memory_observations')
		.select('*')
		.eq('id', id)
		.single();

	if (error) {
		if (error.code === 'PGRST116') {
			throw new NotFoundError(`Observation not found: ${id}`);
		}
		logger.error('Failed to get observation', { error: error.message });
		throw new DatabaseError('Failed to get observation');
	}

	return data as MemoryObservation;
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
	if (!isSupabaseConfigured()) {
		throw new DatabaseError('Supabase not configured');
	}

	const { includeExpired = false, limit = 100 } = options;
	const client = getSupabaseClient();

	let query = client
		.from('memory_observations')
		.select('*')
		.eq('entity_id', entityId)
		.order('created_at', { ascending: false })
		.limit(limit);

	if (!includeExpired) {
		// Filter out expired observations
		query = query.or('valid_until.is.null,valid_until.gt.now()');
	}

	const { data, error } = await query;

	if (error) {
		logger.error('Failed to get observations for entity', {
			error: error.message,
		});
		throw new DatabaseError('Failed to get observations');
	}

	return data as MemoryObservation[];
}

/**
 * Update observation embedding
 */
export async function updateObservationEmbedding(
	id: string,
	embedding: number[],
): Promise<MemoryObservation> {
	if (!isSupabaseConfigured()) {
		throw new DatabaseError('Supabase not configured');
	}

	const client = getSupabaseClient();

	const { data, error } = await client
		.from('memory_observations')
		.update({ embedding })
		.eq('id', id)
		.select()
		.single();

	if (error) {
		logger.error('Failed to update observation embedding', {
			error: error.message,
		});
		throw new DatabaseError('Failed to update observation');
	}

	return data as MemoryObservation;
}

/**
 * Delete an observation
 */
export async function deleteObservation(id: string): Promise<void> {
	if (!isSupabaseConfigured()) {
		throw new DatabaseError('Supabase not configured');
	}

	const client = getSupabaseClient();

	const { error } = await client.from('memory_observations').delete().eq('id', id);

	if (error) {
		logger.error('Failed to delete observation', { error: error.message });
		throw new DatabaseError('Failed to delete observation');
	}

	logger.info('Deleted memory observation', { id });
}

/**
 * Delete observations by content match (for deduplication)
 */
export async function deleteObservationByContent(
	entityId: string,
	content: string,
): Promise<number> {
	if (!isSupabaseConfigured()) {
		throw new DatabaseError('Supabase not configured');
	}

	const client = getSupabaseClient();

	const { data, error } = await client
		.from('memory_observations')
		.delete()
		.eq('entity_id', entityId)
		.eq('content', content)
		.select('id');

	if (error) {
		logger.error('Failed to delete observation by content', {
			error: error.message,
		});
		throw new DatabaseError('Failed to delete observation');
	}

	return data?.length || 0;
}

/**
 * Check if a similar observation already exists (for deduplication)
 */
export async function findSimilarObservation(
	entityId: string,
	content: string,
	similarityThreshold = 0.95,
): Promise<MemoryObservation | null> {
	if (!isSupabaseConfigured()) {
		throw new DatabaseError('Supabase not configured');
	}

	const client = getSupabaseClient();

	// First try exact match
	const { data: exactMatch, error: exactError } = await client
		.from('memory_observations')
		.select('*')
		.eq('entity_id', entityId)
		.eq('content', content)
		.limit(1)
		.maybeSingle();

	if (exactError) {
		logger.error('Failed to find similar observation', {
			error: exactError.message,
		});
		throw new DatabaseError('Failed to find observation');
	}

	if (exactMatch) {
		return exactMatch as MemoryObservation;
	}

	// TODO: If needed, implement vector similarity check using embedding
	// This would require the observation to already have an embedding

	return null;
}

/**
 * Expire an observation (set valid_until to now)
 */
export async function expireObservation(id: string): Promise<void> {
	if (!isSupabaseConfigured()) {
		throw new DatabaseError('Supabase not configured');
	}

	const client = getSupabaseClient();

	const { error } = await client
		.from('memory_observations')
		.update({ valid_until: new Date().toISOString() })
		.eq('id', id);

	if (error) {
		logger.error('Failed to expire observation', { error: error.message });
		throw new DatabaseError('Failed to expire observation');
	}

	logger.info('Expired memory observation', { id });
}
