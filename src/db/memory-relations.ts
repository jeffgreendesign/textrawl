import type { MemoryRelation } from '../types/database.js';
import { DatabaseError, NotFoundError, ValidationError } from '../utils/errors.js';
import { logger } from '../utils/logger.js';
import { getSupabaseClient, isSupabaseConfigured } from './client.js';

export type { MemoryRelation } from '../types/database.js';

// UUID format validation regex
const UUID_REGEX = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export interface CreateRelationInput {
	fromEntityId: string;
	toEntityId: string;
	relationType: string;
	strength?: number;
	metadata?: Record<string, unknown>;
}

/**
 * Common relation types for reference. Provides a typed lookup of well-known
 * relation type strings organized by category: people, project, concept, and generic.
 *
 * @example
 * ```typescript
 * import { RELATION_TYPES } from './memory-relations.js';
 * const rel = RELATION_TYPES.WORKS_AT; // 'works_at'
 * ```
 */
export const RELATION_TYPES = {
	// People relations
	WORKS_AT: 'works_at',
	KNOWS: 'knows',
	REPORTS_TO: 'reports_to',
	MANAGES: 'manages',
	FRIEND_OF: 'friend_of',

	// Project relations
	WORKS_ON: 'works_on',
	CREATED: 'created',
	OWNS: 'owns',
	CONTRIBUTES_TO: 'contributes_to',

	// Concept relations
	PREFERS: 'prefers',
	DISLIKES: 'dislikes',
	INTERESTED_IN: 'interested_in',
	EXPERT_IN: 'expert_in',

	// Generic relations
	PART_OF: 'part_of',
	RELATED_TO: 'related_to',
	DEPENDS_ON: 'depends_on',
	SIMILAR_TO: 'similar_to',
	OPPOSITE_OF: 'opposite_of',
	LOCATED_IN: 'located_in',
} as const;

/**
 * Create a new relation between entities
 */
export async function createRelation(input: CreateRelationInput): Promise<MemoryRelation> {
	if (!isSupabaseConfigured()) {
		throw new DatabaseError('Supabase not configured');
	}

	if (input.fromEntityId === input.toEntityId) {
		throw new DatabaseError('Cannot create self-referential relation');
	}

	const client = getSupabaseClient();

	const { data, error } = await client
		.from('memory_relations')
		.insert({
			from_entity_id: input.fromEntityId,
			to_entity_id: input.toEntityId,
			relation_type: input.relationType.toLowerCase().replace(/\s+/g, '_'),
			strength: input.strength ?? 1.0,
			metadata: input.metadata || {},
		})
		.select()
		.single();

	if (error) {
		// Handle unique constraint violation (relation already exists)
		if (error.code === '23505') {
			logger.debug('Relation already exists', {
				from: input.fromEntityId,
				to: input.toEntityId,
				type: input.relationType,
			});
			return getRelation(input.fromEntityId, input.toEntityId, input.relationType);
		}
		logger.error('Failed to create relation', { error: error.message });
		throw new DatabaseError('Failed to create relation');
	}

	logger.info('Created memory relation', {
		id: data.id,
		from: input.fromEntityId,
		to: input.toEntityId,
		type: input.relationType,
	});
	return data as MemoryRelation;
}

/**
 * Get or create a relation between two entities using an upsert on the
 * (from_entity_id, to_entity_id, relation_type) unique constraint. The relation
 * type is normalized to lowercase with underscores.
 *
 * @param input - Relation creation/update data
 * @param input.fromEntityId - UUID of the source entity
 * @param input.toEntityId - UUID of the target entity
 * @param input.relationType - Type of relation (normalized to lowercase with underscores)
 * @param input.strength - Relation strength from 0 to 1 (default: 1.0)
 * @param input.metadata - Optional metadata key-value pairs
 * @returns The existing or newly created relation
 * @throws {DatabaseError} If Supabase is not configured, entities are the same, or the upsert fails
 */
export async function getOrCreateRelation(input: CreateRelationInput): Promise<MemoryRelation> {
	if (!isSupabaseConfigured()) {
		throw new DatabaseError('Supabase not configured');
	}

	if (input.fromEntityId === input.toEntityId) {
		throw new DatabaseError('Cannot create self-referential relation');
	}

	const client = getSupabaseClient();

	const normalizedType = input.relationType.toLowerCase().replace(/\s+/g, '_');

	const { data, error } = await client
		.from('memory_relations')
		.upsert(
			{
				from_entity_id: input.fromEntityId,
				to_entity_id: input.toEntityId,
				relation_type: normalizedType,
				strength: input.strength ?? 1.0,
				metadata: input.metadata || {},
			},
			{
				onConflict: 'from_entity_id,to_entity_id,relation_type',
				ignoreDuplicates: false,
			},
		)
		.select()
		.single();

	if (error) {
		logger.error('Failed to upsert relation', { error: error.message });
		throw new DatabaseError('Failed to create or update relation');
	}

	return data as MemoryRelation;
}

/**
 * Get a specific relation
 */
export async function getRelation(
	fromEntityId: string,
	toEntityId: string,
	relationType: string,
): Promise<MemoryRelation> {
	if (!isSupabaseConfigured()) {
		throw new DatabaseError('Supabase not configured');
	}

	const client = getSupabaseClient();

	const { data, error } = await client
		.from('memory_relations')
		.select('*')
		.eq('from_entity_id', fromEntityId)
		.eq('to_entity_id', toEntityId)
		.eq('relation_type', relationType.toLowerCase().replace(/\s+/g, '_'))
		.single();

	if (error) {
		if (error.code === 'PGRST116') {
			throw new NotFoundError('Relation not found');
		}
		logger.error('Failed to get relation', { error: error.message });
		throw new DatabaseError('Failed to get relation');
	}

	return data as MemoryRelation;
}

/**
 * Get outgoing relations from an entity
 */
export async function getOutgoingRelations(
	entityId: string,
	relationType?: string,
): Promise<MemoryRelation[]> {
	if (!isSupabaseConfigured()) {
		throw new DatabaseError('Supabase not configured');
	}

	const client = getSupabaseClient();

	let query = client.from('memory_relations').select('*').eq('from_entity_id', entityId);

	if (relationType) {
		query = query.eq('relation_type', relationType.toLowerCase().replace(/\s+/g, '_'));
	}

	const { data, error } = await query;

	if (error) {
		logger.error('Failed to get outgoing relations', { error: error.message });
		throw new DatabaseError('Failed to get relations');
	}

	return data as MemoryRelation[];
}

/**
 * Get incoming relations to an entity
 */
export async function getIncomingRelations(
	entityId: string,
	relationType?: string,
): Promise<MemoryRelation[]> {
	if (!isSupabaseConfigured()) {
		throw new DatabaseError('Supabase not configured');
	}

	const client = getSupabaseClient();

	let query = client.from('memory_relations').select('*').eq('to_entity_id', entityId);

	if (relationType) {
		query = query.eq('relation_type', relationType.toLowerCase().replace(/\s+/g, '_'));
	}

	const { data, error } = await query;

	if (error) {
		logger.error('Failed to get incoming relations', { error: error.message });
		throw new DatabaseError('Failed to get relations');
	}

	return data as MemoryRelation[];
}

/**
 * Get all relations for an entity (both directions)
 */
export async function getAllRelationsForEntity(
	entityId: string,
): Promise<{ outgoing: MemoryRelation[]; incoming: MemoryRelation[] }> {
	const [outgoing, incoming] = await Promise.all([
		getOutgoingRelations(entityId),
		getIncomingRelations(entityId),
	]);

	return { outgoing, incoming };
}

/**
 * Update relation strength
 */
export async function updateRelationStrength(
	id: string,
	strength: number,
): Promise<MemoryRelation> {
	if (!isSupabaseConfigured()) {
		throw new DatabaseError('Supabase not configured');
	}

	if (strength < 0 || strength > 1) {
		throw new DatabaseError('Strength must be between 0 and 1');
	}

	const client = getSupabaseClient();

	const { data, error } = await client
		.from('memory_relations')
		.update({ strength })
		.eq('id', id)
		.select()
		.single();

	if (error) {
		if (error.code === 'PGRST116') {
			throw new NotFoundError('Relation not found');
		}
		logger.error('Failed to update relation strength', {
			error: error.message,
		});
		throw new DatabaseError('Failed to update relation');
	}

	return data as MemoryRelation;
}

/**
 * Delete a relation
 */
export async function deleteRelation(id: string): Promise<void> {
	if (!isSupabaseConfigured()) {
		throw new DatabaseError('Supabase not configured');
	}

	const client = getSupabaseClient();

	const { error } = await client.from('memory_relations').delete().eq('id', id);

	if (error) {
		logger.error('Failed to delete relation', { error: error.message });
		throw new DatabaseError('Failed to delete relation');
	}

	logger.info('Deleted memory relation', { id });
}

/**
 * Delete all relations between two entities
 */
export async function deleteRelationsBetween(
	entityId1: string,
	entityId2: string,
): Promise<number> {
	if (!isSupabaseConfigured()) {
		throw new DatabaseError('Supabase not configured');
	}

	// Validate UUID format before querying to prevent SQL injection
	if (!UUID_REGEX.test(entityId1) || !UUID_REGEX.test(entityId2)) {
		throw new ValidationError('Invalid entity ID format');
	}

	const client = getSupabaseClient();

	const { data, error } = await client
		.from('memory_relations')
		.delete()
		.or(
			`and(from_entity_id.eq.${entityId1},to_entity_id.eq.${entityId2}),and(from_entity_id.eq.${entityId2},to_entity_id.eq.${entityId1})`,
		)
		.select('id');

	if (error) {
		logger.error('Failed to delete relations between entities', {
			error: error.message,
		});
		throw new DatabaseError('Failed to delete relations');
	}

	return data?.length || 0;
}
