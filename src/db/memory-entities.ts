import { DatabaseError, NotFoundError } from '../utils/errors.js';
import { logger } from '../utils/logger.js';
import { getSupabaseClient, isSupabaseConfigured } from './client.js';

/**
 * Memory Entity type definition
 */
export interface MemoryEntity {
	id: string;
	name: string;
	entity_type: EntityType;
	description: string | null;
	embedding: number[] | null;
	metadata: Record<string, unknown>;
	created_at: string;
	updated_at: string;
}

export type EntityType =
	| 'person'
	| 'concept'
	| 'project'
	| 'preference'
	| 'fact'
	| 'location'
	| 'organization';

export interface CreateEntityInput {
	name: string;
	entityType: EntityType;
	description?: string;
	embedding?: number[];
	metadata?: Record<string, unknown>;
}

export interface UpdateEntityInput {
	description?: string;
	embedding?: number[];
	metadata?: Record<string, unknown>;
}

/**
 * Create a new memory entity
 */
export async function createEntity(input: CreateEntityInput): Promise<MemoryEntity> {
	if (!isSupabaseConfigured()) {
		throw new DatabaseError('Supabase not configured');
	}

	const client = getSupabaseClient();

	const { data, error } = await client
		.from('memory_entities')
		.insert({
			name: input.name,
			entity_type: input.entityType,
			description: input.description || null,
			embedding: input.embedding || null,
			metadata: input.metadata || {},
		})
		.select()
		.single();

	if (error) {
		// Handle unique constraint violation (entity already exists)
		if (error.code === '23505') {
			logger.debug('Entity already exists, fetching existing', {
				name: input.name,
				type: input.entityType,
			});
			return getEntityByName(input.name, input.entityType);
		}
		logger.error('Failed to create entity', { error: error.message });
		throw new DatabaseError('Failed to create entity');
	}

	logger.info('Created memory entity', {
		id: data.id,
		name: data.name,
		type: data.entity_type,
	});
	return data as MemoryEntity;
}

/**
 * Get or create a memory entity using an upsert on the (name, entity_type) unique constraint.
 * If the entity already exists, it is updated with the provided fields and returned.
 *
 * @param input - Entity creation/update data
 * @param input.name - The entity name (used for conflict detection)
 * @param input.entityType - The entity type (used for conflict detection)
 * @param input.description - Optional description of the entity
 * @param input.embedding - Optional vector embedding for the entity
 * @param input.metadata - Optional metadata key-value pairs
 * @returns The existing or newly created memory entity
 * @throws {DatabaseError} If Supabase is not configured or the upsert fails
 */
export async function getOrCreateEntity(input: CreateEntityInput): Promise<MemoryEntity> {
	if (!isSupabaseConfigured()) {
		throw new DatabaseError('Supabase not configured');
	}

	const client = getSupabaseClient();

	const { data, error } = await client
		.from('memory_entities')
		.upsert(
			{
				name: input.name,
				entity_type: input.entityType,
				description: input.description || null,
				embedding: input.embedding || null,
				metadata: input.metadata || {},
			},
			{
				onConflict: 'name,entity_type',
				ignoreDuplicates: false,
			},
		)
		.select()
		.single();

	if (error) {
		logger.error('Failed to upsert entity', { error: error.message });
		throw new DatabaseError('Failed to create or update entity');
	}

	return data as MemoryEntity;
}

/**
 * Get entity by ID
 */
export async function getEntity(id: string): Promise<MemoryEntity> {
	if (!isSupabaseConfigured()) {
		throw new DatabaseError('Supabase not configured');
	}

	const client = getSupabaseClient();

	const { data, error } = await client.from('memory_entities').select('*').eq('id', id).single();

	if (error) {
		if (error.code === 'PGRST116') {
			throw new NotFoundError(`Entity not found: ${id}`);
		}
		logger.error('Failed to get entity', { error: error.message });
		throw new DatabaseError('Failed to get entity');
	}

	return data as MemoryEntity;
}

/**
 * Get entity by name and type
 */
export async function getEntityByName(name: string, entityType: EntityType): Promise<MemoryEntity> {
	if (!isSupabaseConfigured()) {
		throw new DatabaseError('Supabase not configured');
	}

	const client = getSupabaseClient();

	const { data, error } = await client
		.from('memory_entities')
		.select('*')
		.ilike('name', name)
		.eq('entity_type', entityType)
		.single();

	if (error) {
		if (error.code === 'PGRST116') {
			throw new NotFoundError(`Entity not found: ${name} (${entityType})`);
		}
		logger.error('Failed to get entity by name', { error: error.message });
		throw new DatabaseError('Failed to get entity');
	}

	return data as MemoryEntity;
}

/**
 * Find a memory entity by name using a case-insensitive match across all entity types.
 * Returns `null` if no entity is found rather than throwing.
 *
 * @param name - The entity name to search for (case-insensitive)
 * @returns The matching memory entity, or `null` if not found
 * @throws {DatabaseError} If Supabase is not configured or the query fails
 */
export async function findEntityByName(name: string): Promise<MemoryEntity | null> {
	if (!isSupabaseConfigured()) {
		throw new DatabaseError('Supabase not configured');
	}

	const client = getSupabaseClient();

	const { data, error } = await client
		.from('memory_entities')
		.select('*')
		.ilike('name', name)
		.limit(1)
		.maybeSingle();

	if (error) {
		logger.error('Failed to find entity', { error: error.message });
		throw new DatabaseError('Failed to find entity');
	}

	return data as MemoryEntity | null;
}

/**
 * Update an entity
 */
export async function updateEntity(id: string, input: UpdateEntityInput): Promise<MemoryEntity> {
	if (!isSupabaseConfigured()) {
		throw new DatabaseError('Supabase not configured');
	}

	const client = getSupabaseClient();

	const updates: Record<string, unknown> = {};
	if (input.description !== undefined) {
		updates.description = input.description;
	}
	if (input.embedding !== undefined) {
		updates.embedding = input.embedding;
	}
	if (input.metadata !== undefined) {
		updates.metadata = input.metadata;
	}

	if (Object.keys(updates).length === 0) {
		return getEntity(id);
	}

	const { data, error } = await client
		.from('memory_entities')
		.update(updates)
		.eq('id', id)
		.select()
		.single();

	if (error) {
		if (error.code === 'PGRST116') {
			throw new NotFoundError(`Entity not found: ${id}`);
		}
		logger.error('Failed to update entity', { error: error.message });
		throw new DatabaseError('Failed to update entity');
	}

	logger.info('Updated memory entity', { id, updates: Object.keys(updates) });
	return data as MemoryEntity;
}

/**
 * Delete a memory entity by ID. Deletion cascades to all associated observations
 * and relations via database foreign key constraints.
 *
 * @param id - The UUID of the entity to delete
 * @returns Resolves when the entity has been deleted
 * @throws {DatabaseError} If Supabase is not configured or the delete fails
 */
export async function deleteEntity(id: string): Promise<void> {
	if (!isSupabaseConfigured()) {
		throw new DatabaseError('Supabase not configured');
	}

	const client = getSupabaseClient();

	const { error } = await client.from('memory_entities').delete().eq('id', id);

	if (error) {
		logger.error('Failed to delete entity', { error: error.message });
		throw new DatabaseError('Failed to delete entity');
	}

	logger.info('Deleted memory entity', { id });
}

/**
 * List memory entities with pagination and optional filtering by entity type,
 * ordered by most recently updated first.
 *
 * @param options - Pagination and filter options
 * @param options.entityTypes - Optional array of entity types to filter by
 * @param options.limit - Maximum number of entities to return (default: 50)
 * @param options.offset - Number of entities to skip for pagination (default: 0)
 * @returns An object with the matching entities array and total count for pagination
 * @throws {DatabaseError} If Supabase is not configured or the query fails
 */
export async function listEntities(options: {
	entityTypes?: EntityType[];
	limit?: number;
	offset?: number;
}): Promise<{ entities: MemoryEntity[]; total: number }> {
	if (!isSupabaseConfigured()) {
		throw new DatabaseError('Supabase not configured');
	}

	const { entityTypes, limit = 50, offset = 0 } = options;
	const client = getSupabaseClient();

	let query = client
		.from('memory_entities')
		.select('*', { count: 'exact' })
		.order('updated_at', { ascending: false })
		.range(offset, offset + limit - 1);

	if (entityTypes && entityTypes.length > 0) {
		query = query.in('entity_type', entityTypes);
	}

	const { data, error, count } = await query;

	if (error) {
		logger.error('Failed to list entities', { error: error.message });
		throw new DatabaseError('Failed to list entities');
	}

	return {
		entities: data as MemoryEntity[],
		total: count || 0,
	};
}
