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
 * Compact JSON serialization - no pretty-printing to save tokens
 * Research shows pretty-printing adds ~30% token overhead
 */
function toJSON(obj: unknown): string {
  return JSON.stringify(obj);
}

/**
 * Truncate UUID to first 8 chars for display (still unique enough)
 * Full UUIDs waste 28 chars per ID
 */
function shortId(uuid: string): string {
  return uuid.slice(0, 8);
}

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
              text: toJSON({
                error: 'Database not configured',
                message: 'Set SUPABASE_URL and SUPABASE_SERVICE_KEY',
              }),
            },
          ],
        };
      }

      if (!isOpenAIConfigured()) {
        return {
          content: [
            {
              type: 'text' as const,
              text: toJSON({
                error: 'Embedding not configured',
                message: 'Set OPENAI_API_KEY or configure Ollama',
              }),
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
                text: toJSON({
                  ok: true,
                  dup: true,
                  id: shortId(existing.id),
                }),
              },
            ],
          };
        }

        // Generate embedding for the observation
        const embedStart = Date.now();
        const embedding = await generateEmbedding(observation);
        logger.debug('embedding generated', {
          operation: 'remember_fact',
          entityName,
          latencyMs: Date.now() - embedStart,
        });

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

        // Compact response - don't echo back the observation (caller already has it)
        return {
          content: [
            {
              type: 'text' as const,
              text: toJSON({
                ok: true,
                entity: shortId(entity.id),
                obs: shortId(obs.id),
              }),
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
              text: toJSON({
                ok: false,
                error: error instanceof Error ? error.message : 'Unknown error',
              }),
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
              text: toJSON({ error: 'Database not configured' }),
            },
          ],
        };
      }

      if (!isOpenAIConfigured()) {
        return {
          content: [
            {
              type: 'text' as const,
              text: toJSON({ error: 'Embedding not configured' }),
            },
          ],
        };
      }

      try {
        // Generate embedding for the query
        const embedStart = Date.now();
        const queryEmbedding = await generateEmbedding(query);
        logger.debug('embedding generated', {
          operation: 'recall_memories',
          queryLength: query.length,
          latencyMs: Date.now() - embedStart,
        });

        // Search memories
        const searchStart = Date.now();
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
        const searchLatencyMs = Date.now() - searchStart;

        // Group results by entity - compact format
        const groupedByEntity = new Map<
          string,
          {
            n: string; // name (short key)
            t: string; // type (short key)
            m: Array<{
              c: string; // content
              s: number; // score (rounded)
            }>;
          }
        >();

        for (const result of results) {
          const key = result.entity_id;
          if (!groupedByEntity.has(key)) {
            groupedByEntity.set(key, {
              n: result.entity_name,
              t: result.entity_type,
              m: [],
            });
          }
          // Only include content and score (source/confidence rarely used)
          groupedByEntity.get(key)!.m.push({
            c: result.observation_content,
            s: Math.round(result.score * 100) / 100, // 2 decimal places
          });
        }

        const groupedResults = Array.from(groupedByEntity.values());

        logger.info('recall_memories completed', {
          resultCount: results.length,
          entityCount: groupedResults.length,
          searchLatencyMs,
        });

        // Compact response - don't echo query back (caller has it)
        return {
          content: [
            {
              type: 'text' as const,
              text: toJSON({
                n: results.length, // count
                e: groupedResults, // entities
              }),
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
              text: toJSON({
                ok: false,
                error: error instanceof Error ? error.message : 'Unknown error',
              }),
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
              text: toJSON({ error: 'Database not configured' }),
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

        // Compact response - caller knows the entity names
        return {
          content: [
            {
              type: 'text' as const,
              text: toJSON({
                ok: true,
                id: shortId(rel.id),
              }),
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
              text: toJSON({
                ok: false,
                error: error instanceof Error ? error.message : 'Unknown error',
              }),
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
      maxObs: z
        .number()
        .int()
        .min(1)
        .max(100)
        .default(20)
        .describe('Max observations to return (default 20, for token efficiency)'),
    },
    async ({ entityName, includeRelated, maxObs }) => {
      logger.info('get_entity_context called', { entityName, includeRelated });

      if (!isSupabaseConfigured()) {
        return {
          content: [
            {
              type: 'text' as const,
              text: toJSON({ error: 'Database not configured' }),
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
                text: toJSON({ found: false }),
              },
            ],
          };
        }

        logger.info('Entity context retrieved', {
          entityId: context.entity_id,
          observationCount: context.observations.length,
        });

        // Compact observations - only content, limit count
        const compactObs = context.observations.slice(0, maxObs).map((o) => o.content);

        // Compact relations - just type and target name
        const outRels = context.outgoing_relations.map((r) => `${r.relation_type}→${r.to_entity}`);
        const inRels = context.incoming_relations.map((r) => `${r.from_entity}→${r.relation_type}`);

        return {
          content: [
            {
              type: 'text' as const,
              text: toJSON({
                t: context.entity_type, // type
                o: compactObs, // observations (array of strings)
                r: outRels.length > 0 || inRels.length > 0 ? { out: outRels, in: inRels } : undefined,
                more: context.observations.length > maxObs ? context.observations.length - maxObs : undefined,
              }),
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
              text: toJSON({
                ok: false,
                error: error instanceof Error ? error.message : 'Unknown error',
              }),
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
              text: toJSON({ error: 'Database not configured' }),
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

        // Compact format - just name:type pairs
        return {
          content: [
            {
              type: 'text' as const,
              text: toJSON({
                n: total, // total count
                e: entities.map((e) => ({ n: e.name, t: e.entity_type })),
              }),
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
              text: toJSON({
                ok: false,
                error: error instanceof Error ? error.message : 'Unknown error',
              }),
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
        .describe('Must be true to confirm deletion'),
    },
    async ({ entityName, confirm }) => {
      logger.info('forget_entity called', { entityName, confirm });

      if (!confirm) {
        return {
          content: [
            {
              type: 'text' as const,
              text: toJSON({ error: 'Set confirm=true to delete' }),
            },
          ],
        };
      }

      if (!isSupabaseConfigured()) {
        return {
          content: [
            {
              type: 'text' as const,
              text: toJSON({ error: 'Database not configured' }),
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
                text: toJSON({ ok: false, error: 'Entity not found' }),
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
              text: toJSON({ ok: true }),
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
              text: toJSON({
                ok: false,
                error: error instanceof Error ? error.message : 'Unknown error',
              }),
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
            text: toJSON({ error: 'Database not configured' }),
          },
        ],
      };
    }

    try {
      const stats = await getMemoryStats();

      // Compact keys
      return {
        content: [
          {
            type: 'text' as const,
            text: toJSON({
              ent: stats.totalEntities,
              obs: stats.totalObservations,
              rel: stats.totalRelations,
              byType: stats.entityTypeCounts,
            }),
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
            text: toJSON({
              ok: false,
              error: error instanceof Error ? error.message : 'Unknown error',
            }),
          },
        ],
      };
    }
  });

  logger.debug('Registered tool: memory_stats');
}
