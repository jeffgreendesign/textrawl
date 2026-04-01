import { DatabaseError } from '../utils/errors.js';
import { logger } from '../utils/logger.js';
import type { EntityType } from './memory-entities.js';
import type { ObservationSource } from './memory-observations.js';
import { isDatabaseConfigured, pgQuery, queryCount } from './pg-client.js';

/**
 * Memory search result from semantic/hybrid search
 */
export interface MemorySearchResult {
	entity_id: string;
	entity_name: string;
	entity_type: EntityType;
	observation_id: string;
	observation_content: string;
	source: ObservationSource;
	confidence: number;
	score: number; // similarity or RRF score
}

/**
 * Entity context with observations and relations
 */
export interface EntityContext {
	entity_id: string;
	entity_name: string;
	entity_type: EntityType;
	entity_description: string | null;
	observations: Array<{
		id: string;
		content: string;
		source: ObservationSource;
		confidence: number;
		created_at: string;
	}>;
	outgoing_relations: Array<{
		relation_type: string;
		to_entity: string;
		to_entity_type: EntityType;
		strength: number;
	}>;
	incoming_relations: Array<{
		relation_type: string;
		from_entity: string;
		from_entity_type: EntityType;
		strength: number;
	}>;
}

/**
 * Perform a pure semantic (vector similarity) search across memory observations
 * using the `memory_semantic_search` database function.
 *
 * @param queryEmbedding - The vector embedding of the search query
 * @param options - Search configuration options
 * @param options.limit - Maximum number of results to return (default: 10)
 * @param options.entityTypes - Optional array of entity types to filter by
 * @param options.includeExpired - Whether to include expired observations (default: false)
 * @returns An array of memory search results ranked by cosine similarity
 * @throws {DatabaseError} If database is not configured or the search fails
 */
export async function semanticMemorySearch(
	queryEmbedding: number[],
	options: {
		limit?: number;
		entityTypes?: EntityType[];
		includeExpired?: boolean;
	} = {},
): Promise<MemorySearchResult[]> {
	if (!isDatabaseConfigured()) {
		throw new DatabaseError('Database not configured');
	}

	const { limit = 10, entityTypes, includeExpired = false } = options;

	try {
		const { rows } = await pgQuery<Record<string, unknown>>(
			'SELECT * FROM memory_semantic_search($1::vector, $2, $3, $4)',
			[JSON.stringify(queryEmbedding), limit, entityTypes || null, includeExpired],
		);

		return rows.map((row) => ({
			entity_id: row.entity_id as string,
			entity_name: row.entity_name as string,
			entity_type: row.entity_type as EntityType,
			observation_id: row.observation_id as string,
			observation_content: row.observation_content as string,
			source: row.source as ObservationSource,
			confidence: row.confidence as number,
			score: row.similarity as number,
		}));
	} catch (err: unknown) {
		logger.error('Semantic memory search failed', {
			error: err instanceof Error ? err.message : String(err),
		});
		throw new DatabaseError('Memory search failed');
	}
}

/**
 * Perform a hybrid search across memory observations combining full-text search
 * and vector similarity using Reciprocal Rank Fusion (RRF) via the
 * `memory_hybrid_search` database function.
 *
 * @param queryText - The raw text query used for full-text search
 * @param queryEmbedding - The vector embedding of the query for semantic search
 * @param options - Search configuration options
 * @param options.limit - Maximum number of results to return (default: 10)
 * @param options.entityTypes - Optional array of entity types to filter by
 * @param options.fullTextWeight - Weight applied to full-text search scores in RRF (default: 1.0)
 * @param options.semanticWeight - Weight applied to semantic search scores in RRF (default: 1.0)
 * @returns An array of memory search results ranked by fused RRF score
 * @throws {DatabaseError} If database is not configured or the search fails
 */
export async function hybridMemorySearch(
	queryText: string,
	queryEmbedding: number[],
	options: {
		limit?: number;
		entityTypes?: EntityType[];
		fullTextWeight?: number;
		semanticWeight?: number;
	} = {},
): Promise<MemorySearchResult[]> {
	if (!isDatabaseConfigured()) {
		throw new DatabaseError('Database not configured');
	}

	const { limit = 10, entityTypes, fullTextWeight = 1.0, semanticWeight = 1.0 } = options;

	try {
		const { rows } = await pgQuery<Record<string, unknown>>(
			'SELECT * FROM memory_hybrid_search($1, $2::vector, $3, $4, $5, $6, $7)',
			[
				queryText,
				JSON.stringify(queryEmbedding),
				limit,
				fullTextWeight,
				semanticWeight,
				60, // rrf_k
				entityTypes || null,
			],
		);

		return rows.map((row) => ({
			entity_id: row.entity_id as string,
			entity_name: row.entity_name as string,
			entity_type: row.entity_type as EntityType,
			observation_id: row.observation_id as string,
			observation_content: row.observation_content as string,
			source: row.source as ObservationSource,
			confidence: row.confidence as number,
			score: row.score as number,
		}));
	} catch (err: unknown) {
		logger.error('Hybrid memory search failed', {
			error: err instanceof Error ? err.message : String(err),
		});
		throw new DatabaseError('Memory search failed');
	}
}

/**
 * Retrieve the full context for a named entity, including its observations,
 * outgoing relations, and incoming relations, via the `get_entity_context` database function.
 *
 * @param entityName - The name of the entity to look up (case-sensitive in the function)
 * @param includeRelated - Whether to include related entity relations (default: true)
 * @returns The entity context with observations and relations, or `null` if the entity is not found
 * @throws {DatabaseError} If database is not configured or the function call fails
 */
export async function getEntityContext(
	entityName: string,
	includeRelated = true,
): Promise<EntityContext | null> {
	if (!isDatabaseConfigured()) {
		throw new DatabaseError('Database not configured');
	}

	try {
		const { rows } = await pgQuery<Record<string, unknown>>(
			'SELECT * FROM get_entity_context($1, $2)',
			[entityName, includeRelated],
		);

		if (rows.length === 0) {
			return null;
		}

		const row = rows[0];
		return {
			entity_id: row.entity_id as string,
			entity_name: row.entity_name as string,
			entity_type: row.entity_type as EntityType,
			entity_description: row.entity_description as string | null,
			observations: (row.observations as EntityContext['observations']) || [],
			outgoing_relations: (row.outgoing_relations as EntityContext['outgoing_relations']) || [],
			incoming_relations: (row.incoming_relations as EntityContext['incoming_relations']) || [],
		};
	} catch (err: unknown) {
		logger.error('Get entity context failed', {
			error: err instanceof Error ? err.message : String(err),
		});
		throw new DatabaseError('Failed to get entity context');
	}
}

/**
 * Search entities by name (partial match)
 */
export async function searchEntitiesByName(
	nameQuery: string,
	options: {
		entityTypes?: EntityType[];
		limit?: number;
	} = {},
): Promise<
	Array<{
		id: string;
		name: string;
		entity_type: EntityType;
		description: string | null;
	}>
> {
	if (!isDatabaseConfigured()) {
		throw new DatabaseError('Database not configured');
	}

	const { entityTypes, limit = 20 } = options;

	try {
		const params: unknown[] = [`%${nameQuery}%`, limit];
		let sql = `SELECT id, name, entity_type, description
			 FROM memory_entities
			 WHERE name ILIKE $1`;

		if (entityTypes && entityTypes.length > 0) {
			sql += ' AND entity_type = ANY($3)';
			params.push(entityTypes);
		}

		sql += ' ORDER BY updated_at DESC LIMIT $2';

		const { rows } = await pgQuery<{
			id: string;
			name: string;
			entity_type: EntityType;
			description: string | null;
		}>(sql, params);

		return rows;
	} catch (err: unknown) {
		logger.error('Search entities by name failed', {
			error: err instanceof Error ? err.message : String(err),
		});
		throw new DatabaseError('Failed to search entities');
	}
}

/**
 * Get recent memories (most recently created observations)
 */
export async function getRecentMemories(
	options: {
		limit?: number;
		entityTypes?: EntityType[];
		sources?: ObservationSource[];
	} = {},
): Promise<MemorySearchResult[]> {
	if (!isDatabaseConfigured()) {
		throw new DatabaseError('Database not configured');
	}

	const { limit = 20, entityTypes, sources } = options;

	try {
		const params: unknown[] = [limit];
		let paramIdx = 2;

		let sql = `SELECT
				mo.id AS observation_id,
				mo.content,
				mo.source,
				mo.confidence,
				mo.created_at,
				me.id AS entity_id,
				me.name AS entity_name,
				me.entity_type
			 FROM memory_observations mo
			 JOIN memory_entities me ON mo.entity_id = me.id
			 WHERE (mo.valid_until IS NULL OR mo.valid_until > now())`;

		if (entityTypes && entityTypes.length > 0) {
			sql += ` AND me.entity_type = ANY($${paramIdx})`;
			params.push(entityTypes);
			paramIdx++;
		}

		if (sources && sources.length > 0) {
			sql += ` AND mo.source = ANY($${paramIdx})`;
			params.push(sources);
			paramIdx++;
		}

		sql += ' ORDER BY mo.created_at DESC LIMIT $1';

		const { rows } = await pgQuery<Record<string, unknown>>(sql, params);

		return rows.map((row) => ({
			entity_id: row.entity_id as string,
			entity_name: row.entity_name as string,
			entity_type: row.entity_type as EntityType,
			observation_id: row.observation_id as string,
			observation_content: row.content as string,
			source: row.source as ObservationSource,
			confidence: row.confidence as number,
			score: 1.0, // Recent memories don't have a search score
		}));
	} catch (err: unknown) {
		logger.error('Get recent memories failed', {
			error: err instanceof Error ? err.message : String(err),
		});
		throw new DatabaseError('Failed to get recent memories');
	}
}

/**
 * Get memory statistics
 */
export async function getMemoryStats(): Promise<{
	totalEntities: number;
	totalObservations: number;
	totalRelations: number;
	entityTypeCounts: Record<string, number>;
}> {
	if (!isDatabaseConfigured()) {
		throw new DatabaseError('Database not configured');
	}

	try {
		// Run counts in parallel
		const [totalEntities, totalObservations, totalRelations, typeCountsResult] = await Promise.all([
			queryCount('SELECT count(*) FROM memory_entities'),
			queryCount('SELECT count(*) FROM memory_observations'),
			queryCount('SELECT count(*) FROM memory_relations'),
			pgQuery<{ entity_type: string; cnt: string }>(
				'SELECT entity_type, count(*) AS cnt FROM memory_entities GROUP BY entity_type',
			),
		]);

		const entityTypeCounts: Record<string, number> = {};
		for (const row of typeCountsResult.rows) {
			entityTypeCounts[row.entity_type] = parseInt(row.cnt, 10);
		}

		return {
			totalEntities,
			totalObservations,
			totalRelations,
			entityTypeCounts,
		};
	} catch (err: unknown) {
		logger.error('Get memory stats failed', {
			error: err instanceof Error ? err.message : String(err),
		});
		throw new DatabaseError('Failed to get memory statistics');
	}
}
