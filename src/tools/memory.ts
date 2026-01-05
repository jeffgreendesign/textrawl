import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { z } from 'zod';
import { logger } from '../utils/logger.js';
import { isSupabaseConfigured } from '../db/client.js';
import {
  getOrCreateEntity,
  findEntityByName,
  listEntities,
  deleteEntity,
  type EntityType,
} from '../db/memory-entities.js';
import {
  createObservation,
  findSimilarObservation,
  deleteObservation,
} from '../db/memory-observations.js';
import { getOrCreateRelation, RELATION_TYPES } from '../db/memory-relations.js';
import {
  hybridMemorySearch,
  semanticMemorySearch,
  getEntityContext,
  getRecentMemories,
  getMemoryStats,
} from '../db/memory-search.js';
import {
  generateEmbedding,
  isOpenAIConfigured,
} from '../services/embeddings.js';

const EntityTypeSchema = z.enum([
  'person',
  'concept',
  'project',
  'preference',
  'fact',
  'location',
  'organization',
]);

/**
 * Register all memory-related MCP tools
 */
export function registerMemoryTools(server: McpServer): void {
  // ============================================
  // Tool: remember_fact
  // ============================================
  server.tool(
    'remember_fact',
    {
      entityName: z
        .string()
        .min(1)
        .max(200)
        .describe(
          'Name of the entity to remember about (e.g., "Jeff", "Project Alpha", "TypeScript")'
        ),
      entityType: EntityTypeSchema.describe(
        'Type of entity: person, concept, project, preference, fact, location, organization'
      ),
      observation: z
        .string()
        .min(1)
        .max(2000)
        .describe(
          'The fact or observation to remember about this entity. Should be a single, atomic fact.'
        ),
      source: z
        .enum(['conversation', 'note', 'document', 'manual'])
        .optional()
        .default('conversation')
        .describe('Source of this memory'),
      validUntil: z
        .string()
        .optional()
        .describe(
          'ISO date string if this fact expires (e.g., "2026-12-31"). Leave empty for permanent facts.'
        ),
    },
    async ({ entityName, entityType, observation, source, validUntil }) => {
      logger.info('remember_fact called', {
        entityName,
        entityType,
        observationLength: observation.length,
      });

      if (!isSupabaseConfigured()) {
        return {
          content: [
            {
              type: 'text' as const,
              text: JSON.stringify(
                {
                  error: 'Database not configured',
                  message:
                    'Set SUPABASE_URL and SUPABASE_SERVICE_KEY to enable memory storage.',
                },
                null,
                2
              ),
            },
          ],
        };
      }

      if (!isOpenAIConfigured()) {
        return {
          content: [
            {
              type: 'text' as const,
              text: JSON.stringify(
                {
                  error: 'Embedding service not configured',
                  message:
                    'Set OPENAI_API_KEY or configure Ollama for semantic memory search.',
                },
                null,
                2
              ),
            },
          ],
        };
      }

      try {
        // Get or create the entity
        const entity = await getOrCreateEntity({
          name: entityName,
          entityType: entityType as EntityType,
        });

        // Check for duplicate observation
        const existing = await findSimilarObservation(entity.id, observation);
        if (existing) {
          logger.debug('Duplicate observation skipped', {
            entityId: entity.id,
            observationId: existing.id,
          });
          return {
            content: [
              {
                type: 'text' as const,
                text: JSON.stringify(
                  {
                    success: true,
                    duplicate: true,
                    message: 'This fact was already remembered.',
                    entityId: entity.id,
                    entityName: entity.name,
                    observationId: existing.id,
                  },
                  null,
                  2
                ),
              },
            ],
          };
        }

        // Generate embedding for the observation
        const embedding = await generateEmbedding(observation);

        // Create the observation
        const obs = await createObservation({
          entityId: entity.id,
          content: observation,
          source,
          embedding,
          validUntil: validUntil || null,
        });

        logger.info('Fact remembered', {
          entityId: entity.id,
          observationId: obs.id,
        });

        return {
          content: [
            {
              type: 'text' as const,
              text: JSON.stringify(
                {
                  success: true,
                  message: `Remembered: "${observation}" about ${entityName}`,
                  entityId: entity.id,
                  entityName: entity.name,
                  entityType: entity.entity_type,
                  observationId: obs.id,
                },
                null,
                2
              ),
            },
          ],
        };
      } catch (error) {
        logger.error('remember_fact failed', {
          error: error instanceof Error ? error.message : String(error),
        });

        return {
          content: [
            {
              type: 'text' as const,
              text: JSON.stringify(
                {
                  success: false,
                  error: 'Failed to remember fact',
                  message:
                    error instanceof Error ? error.message : 'Unknown error',
                },
                null,
                2
              ),
            },
          ],
        };
      }
    }
  );

  logger.debug('Registered tool: remember_fact');

  // ============================================
  // Tool: recall_memories
  // ============================================
  server.tool(
    'recall_memories',
    {
      query: z
        .string()
        .min(1)
        .max(1000)
        .describe(
          'What to search for in memories. Can be a question or topic.'
        ),
      entityTypes: z
        .array(EntityTypeSchema)
        .optional()
        .describe('Filter by entity types (e.g., ["person", "project"])'),
      limit: z
        .number()
        .int()
        .min(1)
        .max(50)
        .default(10)
        .describe('Maximum number of memories to return'),
      searchMode: z
        .enum(['hybrid', 'semantic'])
        .default('hybrid')
        .describe('Search mode: hybrid (keyword + semantic) or semantic only'),
    },
    async ({ query, entityTypes, limit, searchMode }) => {
      logger.info('recall_memories called', {
        query,
        entityTypes,
        limit,
        searchMode,
      });

      if (!isSupabaseConfigured()) {
        return {
          content: [
            {
              type: 'text' as const,
              text: JSON.stringify(
                {
                  error: 'Database not configured',
                  message: 'Memory storage is not available.',
                },
                null,
                2
              ),
            },
          ],
        };
      }

      if (!isOpenAIConfigured()) {
        return {
          content: [
            {
              type: 'text' as const,
              text: JSON.stringify(
                {
                  error: 'Embedding service not configured',
                  message: 'Semantic search requires embedding configuration.',
                },
                null,
                2
              ),
            },
          ],
        };
      }

      try {
        // Generate embedding for the query
        const queryEmbedding = await generateEmbedding(query);

        // Search memories
        const results =
          searchMode === 'semantic'
            ? await semanticMemorySearch(queryEmbedding, {
                limit,
                entityTypes: entityTypes as EntityType[] | undefined,
              })
            : await hybridMemorySearch(query, queryEmbedding, {
                limit,
                entityTypes: entityTypes as EntityType[] | undefined,
              });

        // Group results by entity for better readability
        const groupedByEntity = new Map<
          string,
          {
            entityName: string;
            entityType: string;
            memories: Array<{
              content: string;
              source: string;
              confidence: number;
              score: number;
            }>;
          }
        >();

        for (const result of results) {
          const key = result.entity_id;
          if (!groupedByEntity.has(key)) {
            groupedByEntity.set(key, {
              entityName: result.entity_name,
              entityType: result.entity_type,
              memories: [],
            });
          }
          groupedByEntity.get(key)!.memories.push({
            content: result.observation_content,
            source: result.source,
            confidence: result.confidence,
            score: result.score,
          });
        }

        const groupedResults = Array.from(groupedByEntity.values());

        logger.info('recall_memories completed', {
          resultCount: results.length,
          entityCount: groupedResults.length,
        });

        return {
          content: [
            {
              type: 'text' as const,
              text: JSON.stringify(
                {
                  query,
                  totalMemories: results.length,
                  entities: groupedResults,
                },
                null,
                2
              ),
            },
          ],
        };
      } catch (error) {
        logger.error('recall_memories failed', {
          error: error instanceof Error ? error.message : String(error),
        });

        return {
          content: [
            {
              type: 'text' as const,
              text: JSON.stringify(
                {
                  success: false,
                  error: 'Failed to recall memories',
                  message:
                    error instanceof Error ? error.message : 'Unknown error',
                },
                null,
                2
              ),
            },
          ],
        };
      }
    }
  );

  logger.debug('Registered tool: recall_memories');

  // ============================================
  // Tool: relate_entities
  // ============================================
  server.tool(
    'relate_entities',
    {
      fromEntity: z
        .string()
        .min(1)
        .max(200)
        .describe('The source entity name'),
      relation: z
        .string()
        .min(1)
        .max(100)
        .describe(
          `Relation type in active voice (e.g., "${RELATION_TYPES.WORKS_AT}", "${RELATION_TYPES.PREFERS}", "${RELATION_TYPES.KNOWS}")`
        ),
      toEntity: z
        .string()
        .min(1)
        .max(200)
        .describe('The target entity name'),
      fromEntityType: EntityTypeSchema.optional().describe(
        'Type of the source entity (will be inferred if entity exists)'
      ),
      toEntityType: EntityTypeSchema.optional().describe(
        'Type of the target entity (will be inferred if entity exists)'
      ),
    },
    async ({
      fromEntity,
      relation,
      toEntity,
      fromEntityType,
      toEntityType,
    }) => {
      logger.info('relate_entities called', {
        fromEntity,
        relation,
        toEntity,
      });

      if (!isSupabaseConfigured()) {
        return {
          content: [
            {
              type: 'text' as const,
              text: JSON.stringify(
                {
                  error: 'Database not configured',
                  message: 'Memory storage is not available.',
                },
                null,
                2
              ),
            },
          ],
        };
      }

      try {
        // Get or create entities
        const fromEntityObj = await getOrCreateEntity({
          name: fromEntity,
          entityType:
            (fromEntityType as EntityType) ||
            (await findEntityByName(fromEntity))?.entity_type ||
            'concept',
        });

        const toEntityObj = await getOrCreateEntity({
          name: toEntity,
          entityType:
            (toEntityType as EntityType) ||
            (await findEntityByName(toEntity))?.entity_type ||
            'concept',
        });

        // Create the relation
        const rel = await getOrCreateRelation({
          fromEntityId: fromEntityObj.id,
          toEntityId: toEntityObj.id,
          relationType: relation,
        });

        logger.info('Relation created', {
          relationId: rel.id,
          from: fromEntity,
          to: toEntity,
          type: relation,
        });

        return {
          content: [
            {
              type: 'text' as const,
              text: JSON.stringify(
                {
                  success: true,
                  message: `Created relation: ${fromEntity} ${relation} ${toEntity}`,
                  relationId: rel.id,
                  fromEntity: {
                    id: fromEntityObj.id,
                    name: fromEntityObj.name,
                    type: fromEntityObj.entity_type,
                  },
                  toEntity: {
                    id: toEntityObj.id,
                    name: toEntityObj.name,
                    type: toEntityObj.entity_type,
                  },
                },
                null,
                2
              ),
            },
          ],
        };
      } catch (error) {
        logger.error('relate_entities failed', {
          error: error instanceof Error ? error.message : String(error),
        });

        return {
          content: [
            {
              type: 'text' as const,
              text: JSON.stringify(
                {
                  success: false,
                  error: 'Failed to create relation',
                  message:
                    error instanceof Error ? error.message : 'Unknown error',
                },
                null,
                2
              ),
            },
          ],
        };
      }
    }
  );

  logger.debug('Registered tool: relate_entities');

  // ============================================
  // Tool: get_entity_context
  // ============================================
  server.tool(
    'get_entity_context',
    {
      entityName: z
        .string()
        .min(1)
        .max(200)
        .describe('Name of the entity to get context for'),
      includeRelated: z
        .boolean()
        .default(true)
        .describe('Include related entities and their relations'),
    },
    async ({ entityName, includeRelated }) => {
      logger.info('get_entity_context called', { entityName, includeRelated });

      if (!isSupabaseConfigured()) {
        return {
          content: [
            {
              type: 'text' as const,
              text: JSON.stringify(
                {
                  error: 'Database not configured',
                  message: 'Memory storage is not available.',
                },
                null,
                2
              ),
            },
          ],
        };
      }

      try {
        const context = await getEntityContext(entityName, includeRelated);

        if (!context) {
          return {
            content: [
              {
                type: 'text' as const,
                text: JSON.stringify(
                  {
                    found: false,
                    message: `No entity found with name: ${entityName}`,
                  },
                  null,
                  2
                ),
              },
            ],
          };
        }

        logger.info('Entity context retrieved', {
          entityId: context.entity_id,
          observationCount: context.observations.length,
        });

        return {
          content: [
            {
              type: 'text' as const,
              text: JSON.stringify(
                {
                  found: true,
                  entity: {
                    id: context.entity_id,
                    name: context.entity_name,
                    type: context.entity_type,
                    description: context.entity_description,
                  },
                  observations: context.observations,
                  relations: {
                    outgoing: context.outgoing_relations,
                    incoming: context.incoming_relations,
                  },
                },
                null,
                2
              ),
            },
          ],
        };
      } catch (error) {
        logger.error('get_entity_context failed', {
          error: error instanceof Error ? error.message : String(error),
        });

        return {
          content: [
            {
              type: 'text' as const,
              text: JSON.stringify(
                {
                  success: false,
                  error: 'Failed to get entity context',
                  message:
                    error instanceof Error ? error.message : 'Unknown error',
                },
                null,
                2
              ),
            },
          ],
        };
      }
    }
  );

  logger.debug('Registered tool: get_entity_context');

  // ============================================
  // Tool: list_entities
  // ============================================
  server.tool(
    'list_entities',
    {
      entityTypes: z
        .array(EntityTypeSchema)
        .optional()
        .describe('Filter by entity types'),
      limit: z
        .number()
        .int()
        .min(1)
        .max(100)
        .default(50)
        .describe('Maximum number of entities to return'),
      offset: z
        .number()
        .int()
        .min(0)
        .default(0)
        .describe('Pagination offset'),
    },
    async ({ entityTypes, limit, offset }) => {
      logger.info('list_entities called', { entityTypes, limit, offset });

      if (!isSupabaseConfigured()) {
        return {
          content: [
            {
              type: 'text' as const,
              text: JSON.stringify(
                {
                  error: 'Database not configured',
                  message: 'Memory storage is not available.',
                },
                null,
                2
              ),
            },
          ],
        };
      }

      try {
        const { entities, total } = await listEntities({
          entityTypes: entityTypes as EntityType[] | undefined,
          limit,
          offset,
        });

        return {
          content: [
            {
              type: 'text' as const,
              text: JSON.stringify(
                {
                  total,
                  returned: entities.length,
                  offset,
                  entities: entities.map((e) => ({
                    id: e.id,
                    name: e.name,
                    type: e.entity_type,
                    description: e.description,
                    updatedAt: e.updated_at,
                  })),
                },
                null,
                2
              ),
            },
          ],
        };
      } catch (error) {
        logger.error('list_entities failed', {
          error: error instanceof Error ? error.message : String(error),
        });

        return {
          content: [
            {
              type: 'text' as const,
              text: JSON.stringify(
                {
                  success: false,
                  error: 'Failed to list entities',
                  message:
                    error instanceof Error ? error.message : 'Unknown error',
                },
                null,
                2
              ),
            },
          ],
        };
      }
    }
  );

  logger.debug('Registered tool: list_entities');

  // ============================================
  // Tool: forget_entity
  // ============================================
  server.tool(
    'forget_entity',
    {
      entityName: z
        .string()
        .min(1)
        .max(200)
        .describe('Name of the entity to forget'),
      confirm: z
        .boolean()
        .describe(
          'Must be true to confirm deletion. This will delete all observations and relations.'
        ),
    },
    async ({ entityName, confirm }) => {
      logger.info('forget_entity called', { entityName, confirm });

      if (!confirm) {
        return {
          content: [
            {
              type: 'text' as const,
              text: JSON.stringify(
                {
                  success: false,
                  error: 'Confirmation required',
                  message:
                    'Set confirm=true to delete this entity and all its memories.',
                },
                null,
                2
              ),
            },
          ],
        };
      }

      if (!isSupabaseConfigured()) {
        return {
          content: [
            {
              type: 'text' as const,
              text: JSON.stringify(
                {
                  error: 'Database not configured',
                  message: 'Memory storage is not available.',
                },
                null,
                2
              ),
            },
          ],
        };
      }

      try {
        const entity = await findEntityByName(entityName);

        if (!entity) {
          return {
            content: [
              {
                type: 'text' as const,
                text: JSON.stringify(
                  {
                    success: false,
                    error: 'Entity not found',
                    message: `No entity found with name: ${entityName}`,
                  },
                  null,
                  2
                ),
              },
            ],
          };
        }

        await deleteEntity(entity.id);

        logger.info('Entity forgotten', { entityId: entity.id, entityName });

        return {
          content: [
            {
              type: 'text' as const,
              text: JSON.stringify(
                {
                  success: true,
                  message: `Forgotten: ${entityName} and all associated memories`,
                  deletedEntityId: entity.id,
                },
                null,
                2
              ),
            },
          ],
        };
      } catch (error) {
        logger.error('forget_entity failed', {
          error: error instanceof Error ? error.message : String(error),
        });

        return {
          content: [
            {
              type: 'text' as const,
              text: JSON.stringify(
                {
                  success: false,
                  error: 'Failed to forget entity',
                  message:
                    error instanceof Error ? error.message : 'Unknown error',
                },
                null,
                2
              ),
            },
          ],
        };
      }
    }
  );

  logger.debug('Registered tool: forget_entity');

  // ============================================
  // Tool: memory_stats
  // ============================================
  server.tool('memory_stats', {}, async () => {
    logger.info('memory_stats called');

    if (!isSupabaseConfigured()) {
      return {
        content: [
          {
            type: 'text' as const,
            text: JSON.stringify(
              {
                error: 'Database not configured',
                message: 'Memory storage is not available.',
              },
              null,
              2
            ),
          },
        ],
      };
    }

    try {
      const stats = await getMemoryStats();

      return {
        content: [
          {
            type: 'text' as const,
            text: JSON.stringify(
              {
                totalEntities: stats.totalEntities,
                totalObservations: stats.totalObservations,
                totalRelations: stats.totalRelations,
                entitiesByType: stats.entityTypeCounts,
              },
              null,
              2
            ),
          },
        ],
      };
    } catch (error) {
      logger.error('memory_stats failed', {
        error: error instanceof Error ? error.message : String(error),
      });

      return {
        content: [
          {
            type: 'text' as const,
            text: JSON.stringify(
              {
                success: false,
                error: 'Failed to get memory stats',
                message:
                  error instanceof Error ? error.message : 'Unknown error',
              },
              null,
              2
            ),
          },
        ],
      };
    }
  });

  logger.debug('Registered tool: memory_stats');
}
