import type { MemoryRelation } from '../types/database.js';
import { DatabaseError, NotFoundError, ValidationError } from '../utils/errors.js';
import { logger } from '../utils/logger.js';
import { isDatabaseConfigured, pgQuery, queryOne, queryOneOrThrow } from './pg-client.js';

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
	if (!isDatabaseConfigured()) {
		throw new DatabaseError('Database not configured');
	}

	if (input.fromEntityId === input.toEntityId) {
		throw new DatabaseError('Cannot create self-referential relation');
	}

	const normalizedType = input.relationType.toLowerCase().replace(/\s+/g, '_');
	const strength = input.strength ?? 1.0;
	const metadata = input.metadata || {};

	try {
		const data = await queryOneOrThrow<MemoryRelation>(
			`INSERT INTO memory_relations (from_entity_id, to_entity_id, relation_type, strength, metadata)
			 VALUES ($1, $2, $3, $4, $5)
			 RETURNING *`,
			[input.fromEntityId, input.toEntityId, normalizedType, strength, JSON.stringify(metadata)],
			'Relation',
		);

		logger.info('Created memory relation', {
			id: data.id,
			from: input.fromEntityId,
			to: input.toEntityId,
			type: input.relationType,
		});
		return data;
	} catch (err: unknown) {
		// Handle unique constraint violation (relation already exists)
		if (err && typeof err === 'object' && 'code' in err && err.code === '23505') {
			logger.debug('Relation already exists', {
				from: input.fromEntityId,
				to: input.toEntityId,
				type: input.relationType,
			});
			return getRelation(input.fromEntityId, input.toEntityId, input.relationType);
		}
		logger.error('Failed to create relation', {
			error: err instanceof Error ? err.message : String(err),
		});
		throw new DatabaseError('Failed to create relation');
	}
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
 * @throws {DatabaseError} If database is not configured, entities are the same, or the upsert fails
 */
export async function getOrCreateRelation(input: CreateRelationInput): Promise<MemoryRelation> {
	if (!isDatabaseConfigured()) {
		throw new DatabaseError('Database not configured');
	}

	if (input.fromEntityId === input.toEntityId) {
		throw new DatabaseError('Cannot create self-referential relation');
	}

	const normalizedType = input.relationType.toLowerCase().replace(/\s+/g, '_');

	// Build SET clause dynamically — only update strength and metadata when
	// explicitly provided so that existing DB values are preserved for
	// unspecified fields.
	const setClauses: string[] = [];
	if (input.strength !== undefined) {
		setClauses.push('strength = EXCLUDED.strength');
	}
	if (input.metadata !== undefined) {
		setClauses.push('metadata = EXCLUDED.metadata');
	}

	// If nothing to update on conflict, use DO NOTHING and fetch afterward
	const onConflictAction =
		setClauses.length > 0 ? `DO UPDATE SET ${setClauses.join(', ')}` : 'DO NOTHING';

	const params: unknown[] = [
		input.fromEntityId,
		input.toEntityId,
		normalizedType,
		input.strength ?? 1.0,
		JSON.stringify(input.metadata ?? {}),
	];

	try {
		const data = await queryOne<MemoryRelation>(
			`INSERT INTO memory_relations (from_entity_id, to_entity_id, relation_type, strength, metadata)
			 VALUES ($1, $2, $3, $4, $5)
			 ON CONFLICT (from_entity_id, to_entity_id, relation_type) ${onConflictAction}
			 RETURNING *`,
			params,
		);

		if (data) return data;

		// DO NOTHING doesn't return a row, so fetch it
		return await queryOneOrThrow<MemoryRelation>(
			`SELECT * FROM memory_relations
			 WHERE from_entity_id = $1 AND to_entity_id = $2 AND relation_type = $3`,
			[input.fromEntityId, input.toEntityId, normalizedType],
			'Relation',
		);
	} catch (err: unknown) {
		if (err instanceof NotFoundError) throw err;
		logger.error('Failed to upsert relation', {
			error: err instanceof Error ? err.message : String(err),
		});
		throw new DatabaseError('Failed to create or update relation');
	}
}

/**
 * Get a specific relation
 */
export async function getRelation(
	fromEntityId: string,
	toEntityId: string,
	relationType: string,
): Promise<MemoryRelation> {
	if (!isDatabaseConfigured()) {
		throw new DatabaseError('Database not configured');
	}

	const normalizedType = relationType.toLowerCase().replace(/\s+/g, '_');

	try {
		return await queryOneOrThrow<MemoryRelation>(
			`SELECT * FROM memory_relations
			 WHERE from_entity_id = $1 AND to_entity_id = $2 AND relation_type = $3`,
			[fromEntityId, toEntityId, normalizedType],
			'Relation',
		);
	} catch (err: unknown) {
		if (err instanceof NotFoundError) throw err;
		logger.error('Failed to get relation', {
			error: err instanceof Error ? err.message : String(err),
		});
		throw new DatabaseError('Failed to get relation');
	}
}

/**
 * Get outgoing relations from an entity
 */
export async function getOutgoingRelations(
	entityId: string,
	relationType?: string,
): Promise<MemoryRelation[]> {
	if (!isDatabaseConfigured()) {
		throw new DatabaseError('Database not configured');
	}

	try {
		const params: unknown[] = [entityId];
		let sql = 'SELECT * FROM memory_relations WHERE from_entity_id = $1';

		if (relationType) {
			sql += ' AND relation_type = $2';
			params.push(relationType.toLowerCase().replace(/\s+/g, '_'));
		}

		const { rows } = await pgQuery<MemoryRelation>(sql, params);
		return rows;
	} catch (err: unknown) {
		logger.error('Failed to get outgoing relations', {
			error: err instanceof Error ? err.message : String(err),
		});
		throw new DatabaseError('Failed to get relations');
	}
}

/**
 * Get incoming relations to an entity
 */
export async function getIncomingRelations(
	entityId: string,
	relationType?: string,
): Promise<MemoryRelation[]> {
	if (!isDatabaseConfigured()) {
		throw new DatabaseError('Database not configured');
	}

	try {
		const params: unknown[] = [entityId];
		let sql = 'SELECT * FROM memory_relations WHERE to_entity_id = $1';

		if (relationType) {
			sql += ' AND relation_type = $2';
			params.push(relationType.toLowerCase().replace(/\s+/g, '_'));
		}

		const { rows } = await pgQuery<MemoryRelation>(sql, params);
		return rows;
	} catch (err: unknown) {
		logger.error('Failed to get incoming relations', {
			error: err instanceof Error ? err.message : String(err),
		});
		throw new DatabaseError('Failed to get relations');
	}
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
	if (!isDatabaseConfigured()) {
		throw new DatabaseError('Database not configured');
	}

	if (strength < 0 || strength > 1) {
		throw new DatabaseError('Strength must be between 0 and 1');
	}

	try {
		return await queryOneOrThrow<MemoryRelation>(
			'UPDATE memory_relations SET strength = $1 WHERE id = $2 RETURNING *',
			[strength, id],
			'Relation',
		);
	} catch (err: unknown) {
		if (err instanceof NotFoundError) throw err;
		logger.error('Failed to update relation strength', {
			error: err instanceof Error ? err.message : String(err),
		});
		throw new DatabaseError('Failed to update relation');
	}
}

/**
 * Delete a relation
 */
export async function deleteRelation(id: string): Promise<void> {
	if (!isDatabaseConfigured()) {
		throw new DatabaseError('Database not configured');
	}

	try {
		await pgQuery('DELETE FROM memory_relations WHERE id = $1', [id]);
		logger.info('Deleted memory relation', { id });
	} catch (err: unknown) {
		logger.error('Failed to delete relation', {
			error: err instanceof Error ? err.message : String(err),
		});
		throw new DatabaseError('Failed to delete relation');
	}
}

/**
 * List relations in bulk, optionally filtered to a set of entity IDs.
 * Used by the memory graph REST endpoint to fetch all edges in one query.
 */
export async function listRelations(
	options: { entityIds?: string[]; limit?: number } = {},
): Promise<MemoryRelation[]> {
	if (!isDatabaseConfigured()) {
		throw new DatabaseError('Database not configured');
	}

	const { entityIds, limit } = options;
	const params: unknown[] = [];
	let paramIdx = 1;

	let sql = 'SELECT * FROM memory_relations';

	if (entityIds && entityIds.length > 0) {
		sql += ` WHERE (from_entity_id = ANY($${paramIdx}) OR to_entity_id = ANY($${paramIdx}))`;
		params.push(entityIds);
		paramIdx++;
	}

	sql += ' ORDER BY created_at DESC';

	if (limit !== undefined) {
		sql += ` LIMIT $${paramIdx}`;
		params.push(limit);
	}

	try {
		const { rows } = await pgQuery<MemoryRelation>(sql, params);
		return rows;
	} catch (err: unknown) {
		logger.error('Failed to list relations', {
			error: err instanceof Error ? err.message : String(err),
		});
		throw new DatabaseError('Failed to list relations');
	}
}

/**
 * Delete all relations between two entities
 */
export async function deleteRelationsBetween(
	entityId1: string,
	entityId2: string,
): Promise<number> {
	if (!isDatabaseConfigured()) {
		throw new DatabaseError('Database not configured');
	}

	// Validate UUID format before querying to prevent SQL injection
	if (!UUID_REGEX.test(entityId1) || !UUID_REGEX.test(entityId2)) {
		throw new ValidationError('Invalid entity ID format');
	}

	try {
		const { rowCount } = await pgQuery(
			`DELETE FROM memory_relations
			 WHERE (from_entity_id = $1 AND to_entity_id = $2)
			    OR (from_entity_id = $2 AND to_entity_id = $1)`,
			[entityId1, entityId2],
		);

		return rowCount ?? 0;
	} catch (err: unknown) {
		logger.error('Failed to delete relations between entities', {
			error: err instanceof Error ? err.message : String(err),
		});
		throw new DatabaseError('Failed to delete relations');
	}
}
