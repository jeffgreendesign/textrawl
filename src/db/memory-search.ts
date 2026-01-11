import { getSupabaseClient, isSupabaseConfigured } from './client.js';
import { logger } from '../utils/logger.js';
import { DatabaseError } from '../utils/errors.js';
import { EntityType } from './memory-entities.js';
import { ObservationSource } from './memory-observations.js';

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
 * Semantic search across memory observations
 */
export async function semanticMemorySearch(
  queryEmbedding: number[],
  options: {
    limit?: number;
    entityTypes?: EntityType[];
    includeExpired?: boolean;
  } = {}
): Promise<MemorySearchResult[]> {
  if (!isSupabaseConfigured()) {
    throw new DatabaseError('Supabase not configured');
  }

  const { limit = 10, entityTypes, includeExpired = false } = options;
  const client = getSupabaseClient();

  const { data, error } = await client.rpc('memory_semantic_search', {
    query_embedding: queryEmbedding,
    match_count: limit,
    entity_types: entityTypes || null,
    include_expired: includeExpired,
  });

  if (error) {
    logger.error('Semantic memory search failed', { error: error.message });
    throw new DatabaseError('Memory search failed');
  }

  return (data || []).map((row: Record<string, unknown>) => ({
    entity_id: row.entity_id as string,
    entity_name: row.entity_name as string,
    entity_type: row.entity_type as EntityType,
    observation_id: row.observation_id as string,
    observation_content: row.observation_content as string,
    source: row.source as ObservationSource,
    confidence: row.confidence as number,
    score: row.similarity as number,
  }));
}

/**
 * Hybrid search across memory observations (FTS + semantic)
 */
export async function hybridMemorySearch(
  queryText: string,
  queryEmbedding: number[],
  options: {
    limit?: number;
    entityTypes?: EntityType[];
    fullTextWeight?: number;
    semanticWeight?: number;
  } = {}
): Promise<MemorySearchResult[]> {
  if (!isSupabaseConfigured()) {
    throw new DatabaseError('Supabase not configured');
  }

  const {
    limit = 10,
    entityTypes,
    fullTextWeight = 1.0,
    semanticWeight = 1.0,
  } = options;
  const client = getSupabaseClient();

  const { data, error } = await client.rpc('memory_hybrid_search', {
    query_text: queryText,
    query_embedding: queryEmbedding,
    match_count: limit,
    full_text_weight: fullTextWeight,
    semantic_weight: semanticWeight,
    rrf_k: 60,
    entity_types: entityTypes || null,
  });

  if (error) {
    logger.error('Hybrid memory search failed', { error: error.message });
    throw new DatabaseError('Memory search failed');
  }

  return (data || []).map((row: Record<string, unknown>) => ({
    entity_id: row.entity_id as string,
    entity_name: row.entity_name as string,
    entity_type: row.entity_type as EntityType,
    observation_id: row.observation_id as string,
    observation_content: row.observation_content as string,
    source: row.source as ObservationSource,
    confidence: row.confidence as number,
    score: row.score as number,
  }));
}

/**
 * Get full context for an entity including observations and relations
 */
export async function getEntityContext(
  entityName: string,
  includeRelated: boolean = true
): Promise<EntityContext | null> {
  if (!isSupabaseConfigured()) {
    throw new DatabaseError('Supabase not configured');
  }

  const client = getSupabaseClient();

  const { data, error } = await client.rpc('get_entity_context', {
    target_entity_name: entityName,
    include_related: includeRelated,
    relation_depth: 1,
  });

  if (error) {
    logger.error('Get entity context failed', { error: error.message });
    throw new DatabaseError('Failed to get entity context');
  }

  if (!data || data.length === 0) {
    return null;
  }

  const row = data[0];
  return {
    entity_id: row.entity_id,
    entity_name: row.entity_name,
    entity_type: row.entity_type as EntityType,
    entity_description: row.entity_description,
    observations: row.observations || [],
    outgoing_relations: row.outgoing_relations || [],
    incoming_relations: row.incoming_relations || [],
  };
}

/**
 * Search entities by name (partial match)
 */
export async function searchEntitiesByName(
  nameQuery: string,
  options: {
    entityTypes?: EntityType[];
    limit?: number;
  } = {}
): Promise<
  Array<{
    id: string;
    name: string;
    entity_type: EntityType;
    description: string | null;
  }>
> {
  if (!isSupabaseConfigured()) {
    throw new DatabaseError('Supabase not configured');
  }

  const { entityTypes, limit = 20 } = options;
  const client = getSupabaseClient();

  let query = client
    .from('memory_entities')
    .select('id, name, entity_type, description')
    .ilike('name', `%${nameQuery}%`)
    .order('updated_at', { ascending: false })
    .limit(limit);

  if (entityTypes && entityTypes.length > 0) {
    query = query.in('entity_type', entityTypes);
  }

  const { data, error } = await query;

  if (error) {
    logger.error('Search entities by name failed', { error: error.message });
    throw new DatabaseError('Failed to search entities');
  }

  return data as Array<{
    id: string;
    name: string;
    entity_type: EntityType;
    description: string | null;
  }>;
}

/**
 * Get recent memories (most recently created observations)
 */
export async function getRecentMemories(
  options: {
    limit?: number;
    entityTypes?: EntityType[];
    sources?: ObservationSource[];
  } = {}
): Promise<MemorySearchResult[]> {
  if (!isSupabaseConfigured()) {
    throw new DatabaseError('Supabase not configured');
  }

  const { limit = 20, entityTypes, sources } = options;
  const client = getSupabaseClient();

  let query = client
    .from('memory_observations')
    .select(
      `
      id,
      content,
      source,
      confidence,
      created_at,
      entity:memory_entities!inner(
        id,
        name,
        entity_type
      )
    `
    )
    .or('valid_until.is.null,valid_until.gt.now()')
    .order('created_at', { ascending: false })
    .limit(limit);

  if (entityTypes && entityTypes.length > 0) {
    query = query.in('entity.entity_type', entityTypes);
  }

  if (sources && sources.length > 0) {
    query = query.in('source', sources);
  }

  const { data, error } = await query;

  if (error) {
    logger.error('Get recent memories failed', { error: error.message });
    throw new DatabaseError('Failed to get recent memories');
  }

  return (data || []).map((row: Record<string, unknown>) => {
    const entity = row.entity as Record<string, unknown>;
    return {
      entity_id: entity.id as string,
      entity_name: entity.name as string,
      entity_type: entity.entity_type as EntityType,
      observation_id: row.id as string,
      observation_content: row.content as string,
      source: row.source as ObservationSource,
      confidence: row.confidence as number,
      score: 1.0, // Recent memories don't have a search score
    };
  });
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
  if (!isSupabaseConfigured()) {
    throw new DatabaseError('Supabase not configured');
  }

  const client = getSupabaseClient();

  // Run counts in parallel
  const [entitiesResult, observationsResult, relationsResult, typeCountsResult] =
    await Promise.all([
      client
        .from('memory_entities')
        .select('*', { count: 'exact', head: true }),
      client
        .from('memory_observations')
        .select('*', { count: 'exact', head: true }),
      client
        .from('memory_relations')
        .select('*', { count: 'exact', head: true }),
      client.from('memory_entities').select('entity_type'),
    ]);

  // Count by entity type
  const entityTypeCounts: Record<string, number> = {};
  if (typeCountsResult.data) {
    for (const row of typeCountsResult.data) {
      const type = row.entity_type as string;
      entityTypeCounts[type] = (entityTypeCounts[type] || 0) + 1;
    }
  }

  return {
    totalEntities: entitiesResult.count || 0,
    totalObservations: observationsResult.count || 0,
    totalRelations: relationsResult.count || 0,
    entityTypeCounts,
  };
}
