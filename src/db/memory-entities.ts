import type { EntityType, MemoryEntity } from '../types/database.js';
import { DatabaseError, NotFoundError } from '../utils/errors.js';
import { logger } from '../utils/logger.js';
import {
	isDatabaseConfigured,
	pgQuery,
	queryCount,
	queryOne,
	queryOneOrThrow,
} from './pg-client.js';

export type { EntityType, MemoryEntity };

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
	if (!isDatabaseConfigured()) {
		throw new DatabaseError('Supabase not configured');
	}

	try {
		const entity = await queryOneOrThrow<MemoryEntity>(
			`INSERT INTO memory_entities (name, entity_type, description, embedding, metadata)
			 VALUES ($1, $2, $3, $4::vector, $5)
			 RETURNING *`,
			[
				input.name,
				input.entityType,
				input.description || null,
				input.embedding ? JSON.stringify(input.embedding) : null,
				JSON.stringify(input.metadata || {}),
			],
			'Entity',
		);

		logger.info('Created memory entity', {
			id: entity.id,
			name: entity.name,
			type: entity.entity_type,
		});
		return entity;
	} catch (error) {
		// Handle unique constraint violation (entity already exists)
		if (error instanceof Error && 'code' in error && (error as { code: string }).code === '23505') {
			logger.debug('Entity already exists, fetching existing', {
				name: input.name,
				type: input.entityType,
			});
			return getEntityByName(input.name, input.entityType);
		}
		if (error instanceof NotFoundError) {
			throw new DatabaseError('Failed to create entity: no row returned');
		}
		const message = error instanceof Error ? error.message : String(error);
		logger.error('Failed to create entity', { error: message });
		throw new DatabaseError('Failed to create entity');
	}
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
 * @throws {DatabaseError} If the database is not configured or the upsert fails
 */
export async function getOrCreateEntity(input: CreateEntityInput): Promise<MemoryEntity> {
	if (!isDatabaseConfigured()) {
		throw new DatabaseError('Supabase not configured');
	}

	try {
		return await queryOneOrThrow<MemoryEntity>(
			`INSERT INTO memory_entities (name, entity_type, description, embedding, metadata)
			 VALUES ($1, $2, $3, $4::vector, $5)
			 ON CONFLICT (name, entity_type) DO UPDATE SET
			   description = COALESCE(EXCLUDED.description, memory_entities.description),
			   embedding = COALESCE(EXCLUDED.embedding, memory_entities.embedding),
			   metadata = COALESCE(EXCLUDED.metadata, memory_entities.metadata)
			 RETURNING *`,
			[
				input.name,
				input.entityType,
				input.description || null,
				input.embedding ? JSON.stringify(input.embedding) : null,
				JSON.stringify(input.metadata || {}),
			],
			'Entity',
		);
	} catch (error) {
		if (error instanceof NotFoundError) {
			throw new DatabaseError('Failed to create or update entity: no row returned');
		}
		const message = error instanceof Error ? error.message : String(error);
		logger.error('Failed to upsert entity', { error: message });
		throw new DatabaseError('Failed to create or update entity');
	}
}

/**
 * Get entity by ID
 */
export async function getEntity(id: string): Promise<MemoryEntity> {
	if (!isDatabaseConfigured()) {
		throw new DatabaseError('Supabase not configured');
	}

	try {
		return await queryOneOrThrow<MemoryEntity>(
			'SELECT * FROM memory_entities WHERE id = $1',
			[id],
			`Entity not found: ${id}`,
		);
	} catch (error) {
		if (error instanceof NotFoundError) throw error;
		const message = error instanceof Error ? error.message : String(error);
		logger.error('Failed to get entity', { error: message });
		throw new DatabaseError('Failed to get entity');
	}
}

/**
 * Get entity by name and type
 */
export async function getEntityByName(name: string, entityType: EntityType): Promise<MemoryEntity> {
	if (!isDatabaseConfigured()) {
		throw new DatabaseError('Supabase not configured');
	}

	try {
		return await queryOneOrThrow<MemoryEntity>(
			'SELECT * FROM memory_entities WHERE name ILIKE $1 AND entity_type = $2',
			[name, entityType],
			`Entity not found: ${name} (${entityType})`,
		);
	} catch (error) {
		if (error instanceof NotFoundError) throw error;
		const message = error instanceof Error ? error.message : String(error);
		logger.error('Failed to get entity by name', { error: message });
		throw new DatabaseError('Failed to get entity');
	}
}

/**
 * Find a memory entity by name using a case-insensitive match across all entity types.
 * Returns `null` if no entity is found rather than throwing.
 *
 * @param name - The entity name to search for (case-insensitive)
 * @returns The matching memory entity, or `null` if not found
 * @throws {DatabaseError} If the database is not configured or the query fails
 */
export async function findEntityByName(name: string): Promise<MemoryEntity | null> {
	if (!isDatabaseConfigured()) {
		throw new DatabaseError('Supabase not configured');
	}

	try {
		return await queryOne<MemoryEntity>(
			'SELECT * FROM memory_entities WHERE name ILIKE $1 LIMIT 1',
			[name],
		);
	} catch (error) {
		const message = error instanceof Error ? error.message : String(error);
		logger.error('Failed to find entity', { error: message });
		throw new DatabaseError('Failed to find entity');
	}
}

/**
 * Update an entity
 */
export async function updateEntity(id: string, input: UpdateEntityInput): Promise<MemoryEntity> {
	if (!isDatabaseConfigured()) {
		throw new DatabaseError('Supabase not configured');
	}

	const setClauses: string[] = [];
	const params: unknown[] = [];
	let paramIndex = 1;

	if (input.description !== undefined) {
		setClauses.push(`description = $${paramIndex++}`);
		params.push(input.description);
	}
	if (input.embedding !== undefined) {
		setClauses.push(`embedding = $${paramIndex++}::vector`);
		params.push(JSON.stringify(input.embedding));
	}
	if (input.metadata !== undefined) {
		setClauses.push(`metadata = $${paramIndex++}`);
		params.push(JSON.stringify(input.metadata));
	}

	if (setClauses.length === 0) {
		return getEntity(id);
	}

	params.push(id);

	try {
		const entity = await queryOneOrThrow<MemoryEntity>(
			`UPDATE memory_entities SET ${setClauses.join(', ')} WHERE id = $${paramIndex} RETURNING *`,
			params,
			`Entity not found: ${id}`,
		);

		logger.info('Updated memory entity', { id, updates: Object.keys(input) });
		return entity;
	} catch (error) {
		if (error instanceof NotFoundError) throw error;
		const message = error instanceof Error ? error.message : String(error);
		logger.error('Failed to update entity', { error: message });
		throw new DatabaseError('Failed to update entity');
	}
}

/**
 * Delete a memory entity by ID. Deletion cascades to all associated observations
 * and relations via database foreign key constraints.
 *
 * @param id - The UUID of the entity to delete
 * @returns Resolves when the entity has been deleted
 * @throws {DatabaseError} If the database is not configured or the delete fails
 */
export async function deleteEntity(id: string): Promise<void> {
	if (!isDatabaseConfigured()) {
		throw new DatabaseError('Supabase not configured');
	}

	try {
		await pgQuery('DELETE FROM memory_entities WHERE id = $1', [id]);
		logger.info('Deleted memory entity', { id });
	} catch (error) {
		const message = error instanceof Error ? error.message : String(error);
		logger.error('Failed to delete entity', { error: message });
		throw new DatabaseError('Failed to delete entity');
	}
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
 * @throws {DatabaseError} If the database is not configured or the query fails
 */
export async function listEntities(options: {
	entityTypes?: EntityType[];
	limit?: number;
	offset?: number;
}): Promise<{ entities: MemoryEntity[]; total: number }> {
	if (!isDatabaseConfigured()) {
		throw new DatabaseError('Supabase not configured');
	}

	const { entityTypes, limit = 50, offset = 0 } = options;

	try {
		let whereClause = '';
		const params: unknown[] = [];
		let paramIndex = 1;

		if (entityTypes && entityTypes.length > 0) {
			whereClause = `WHERE entity_type = ANY($${paramIndex++})`;
			params.push(entityTypes);
		}

		const countResult = await queryCount(
			`SELECT count(*) FROM memory_entities ${whereClause}`,
			params,
		);

		const dataParams = [...params, limit, offset];
		const { rows } = await pgQuery<MemoryEntity>(
			`SELECT * FROM memory_entities ${whereClause}
			 ORDER BY updated_at DESC
			 LIMIT $${paramIndex++} OFFSET $${paramIndex}`,
			dataParams,
		);

		return {
			entities: rows,
			total: countResult,
		};
	} catch (error) {
		const message = error instanceof Error ? error.message : String(error);
		logger.error('Failed to list entities', { error: message });
		throw new DatabaseError('Failed to list entities');
	}
}
