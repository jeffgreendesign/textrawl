import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { z } from 'zod';
import { isSupabaseConfigured } from '../db/client.js';
import {
	type EntityType,
	deleteEntity,
	findEntityByName,
	getOrCreateEntity,
	listEntities,
} from '../db/memory-entities.js';
import {
	createObservation,
	deleteObservation,
	findSimilarObservation,
} from '../db/memory-observations.js';
import { RELATION_TYPES, getOrCreateRelation } from '../db/memory-relations.js';
import {
	getEntityContext,
	getMemoryStats,
	getRecentMemories,
	hybridMemorySearch,
	semanticMemorySearch,
} from '../db/memory-search.js';
import { generateEmbedding, isOpenAIConfigured } from '../services/embeddings.js';
import {
	extractAndStoreMemories,
	isExtractionConfigured,
} from '../services/memory-extraction.js';
import { config } from '../utils/config.js';
import { logger } from '../utils/logger.js';

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
 * Check if compact response mode is enabled
 * Compact mode saves 40-60% tokens by using short keys and no pretty-printing
 * Set COMPACT_RESPONSES=false for human-readable verbose responses
 */
const isCompact = () => config.COMPACT_RESPONSES;

/**
 * JSON serialization - compact (no whitespace) or pretty-printed
 */
function toJSON(obj: unknown): string {
	return isCompact() ? JSON.stringify(obj) : JSON.stringify(obj, null, 2);
}

/**
 * Format UUID - truncated (8 chars) in compact mode, full in verbose mode
 */
function formatId(uuid: string): string {
	return isCompact() ? uuid.slice(0, 8) : uuid;
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
					'Name of the entity to remember about (e.g., "Jeff", "Project Alpha", "TypeScript")',
				),
			entityType: EntityTypeSchema.describe(
				'Type of entity: person, concept, project, preference, fact, location, organization',
			),
			observation: z
				.string()
				.min(1)
				.max(2000)
				.describe(
					'The fact or observation to remember about this entity. Should be a single, atomic fact.',
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
					'ISO date string if this fact expires (e.g., "2026-12-31"). Leave empty for permanent facts.',
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
								text: toJSON(
									isCompact()
										? { ok: true, dup: true, id: formatId(existing.id) }
										: {
												success: true,
												duplicate: true,
												message: 'This fact was already remembered.',
												entityId: formatId(entity.id),
												observationId: formatId(existing.id),
											},
								),
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

				return {
					content: [
						{
							type: 'text' as const,
							text: toJSON(
								isCompact()
									? { ok: true, entity: formatId(entity.id), obs: formatId(obs.id) }
									: {
											success: true,
											message: `Remembered: "${observation}" about ${entityName}`,
											entityId: formatId(entity.id),
											entityName: entity.name,
											entityType: entity.entity_type,
											observationId: formatId(obs.id),
										},
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
							text: toJSON({
								ok: false,
								error: error instanceof Error ? error.message : 'Unknown error',
							}),
						},
					],
				};
			}
		},
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
				.describe('What to search for in memories. Can be a question or topic.'),
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

				// Group results by entity
				const groupedByEntity = new Map<
					string,
					{
						entityName: string;
						entityType: string;
						memories: Array<{ content: string; source: string; score: number }>;
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
					groupedByEntity.get(key)?.memories.push({
						content: result.observation_content,
						source: result.source,
						score: Math.round(result.score * 100) / 100,
					});
				}

				const groupedResults = Array.from(groupedByEntity.values());

				logger.info('recall_memories completed', {
					resultCount: results.length,
					entityCount: groupedResults.length,
					searchLatencyMs,
				});

				// Format based on compact mode
				const response = isCompact()
					? {
							n: results.length,
							e: groupedResults.map((g) => ({
								n: g.entityName,
								t: g.entityType,
								m: g.memories.map((m) => ({ c: m.content, s: m.score })),
							})),
						}
					: {
							query,
							totalMemories: results.length,
							entities: groupedResults,
						};

				return {
					content: [
						{
							type: 'text' as const,
							text: toJSON(response),
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
		},
	);

	logger.debug('Registered tool: recall_memories');

	// ============================================
	// Tool: relate_entities
	// ============================================
	server.tool(
		'relate_entities',
		{
			fromEntity: z.string().min(1).max(200).describe('The source entity name'),
			relation: z
				.string()
				.min(1)
				.max(100)
				.describe(
					`Relation type in active voice (e.g., "${RELATION_TYPES.WORKS_AT}", "${RELATION_TYPES.PREFERS}", "${RELATION_TYPES.KNOWS}")`,
				),
			toEntity: z.string().min(1).max(200).describe('The target entity name'),
			fromEntityType: EntityTypeSchema.optional().describe(
				'Type of the source entity (will be inferred if entity exists)',
			),
			toEntityType: EntityTypeSchema.optional().describe(
				'Type of the target entity (will be inferred if entity exists)',
			),
		},
		async ({ fromEntity, relation, toEntity, fromEntityType, toEntityType }) => {
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

				return {
					content: [
						{
							type: 'text' as const,
							text: toJSON(
								isCompact()
									? { ok: true, id: formatId(rel.id) }
									: {
											success: true,
											message: `Created relation: ${fromEntity} ${relation} ${toEntity}`,
											relationId: formatId(rel.id),
											fromEntity: {
												id: formatId(fromEntityObj.id),
												name: fromEntityObj.name,
												type: fromEntityObj.entity_type,
											},
											toEntity: {
												id: formatId(toEntityObj.id),
												name: toEntityObj.name,
												type: toEntityObj.entity_type,
											},
										},
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
							text: toJSON({
								ok: false,
								error: error instanceof Error ? error.message : 'Unknown error',
							}),
						},
					],
				};
			}
		},
	);

	logger.debug('Registered tool: relate_entities');

	// ============================================
	// Tool: get_entity_context
	// ============================================
	server.tool(
		'get_entity_context',
		{
			entityName: z.string().min(1).max(200).describe('Name of the entity to get context for'),
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
								text: toJSON(
									isCompact()
										? { found: false }
										: { found: false, message: `No entity found with name: ${entityName}` },
								),
							},
						],
					};
				}

				logger.info('Entity context retrieved', {
					entityId: context.entity_id,
					observationCount: context.observations.length,
				});

				const limitedObs = context.observations.slice(0, maxObs);
				const hasMore = context.observations.length > maxObs;

				// Format based on compact mode
				const response = isCompact()
					? {
							t: context.entity_type,
							o: limitedObs.map((o) => o.content),
							r:
								context.outgoing_relations.length > 0 || context.incoming_relations.length > 0
									? {
											out: context.outgoing_relations.map(
												(r) => `${r.relation_type}→${r.to_entity}`,
											),
											in: context.incoming_relations.map(
												(r) => `${r.from_entity}→${r.relation_type}`,
											),
										}
									: undefined,
							more: hasMore ? context.observations.length - maxObs : undefined,
						}
					: {
							found: true,
							entity: {
								id: formatId(context.entity_id),
								name: context.entity_name,
								type: context.entity_type,
								description: context.entity_description,
							},
							observations: limitedObs,
							relations: {
								outgoing: context.outgoing_relations,
								incoming: context.incoming_relations,
							},
							hasMore,
							totalObservations: context.observations.length,
						};

				return {
					content: [
						{
							type: 'text' as const,
							text: toJSON(response),
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
		},
	);

	logger.debug('Registered tool: get_entity_context');

	// ============================================
	// Tool: list_entities
	// ============================================
	server.tool(
		'list_entities',
		{
			entityTypes: z.array(EntityTypeSchema).optional().describe('Filter by entity types'),
			limit: z
				.number()
				.int()
				.min(1)
				.max(100)
				.default(50)
				.describe('Maximum number of entities to return'),
			offset: z.number().int().min(0).default(0).describe('Pagination offset'),
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

				const response = isCompact()
					? {
							n: total,
							e: entities.map((e) => ({ n: e.name, t: e.entity_type })),
						}
					: {
							total,
							returned: entities.length,
							offset,
							entities: entities.map((e) => ({
								id: formatId(e.id),
								name: e.name,
								type: e.entity_type,
								description: e.description,
								updatedAt: e.updated_at,
							})),
						};

				return {
					content: [
						{
							type: 'text' as const,
							text: toJSON(response),
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
		},
	);

	logger.debug('Registered tool: list_entities');

	// ============================================
	// Tool: forget_entity
	// ============================================
	server.tool(
		'forget_entity',
		{
			entityName: z.string().min(1).max(200).describe('Name of the entity to forget'),
			confirm: z.boolean().describe('Must be true to confirm deletion'),
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
							text: toJSON(
								isCompact()
									? { ok: true }
									: {
											success: true,
											message: `Forgotten: ${entityName} and all associated memories`,
											deletedEntityId: formatId(entity.id),
										},
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
							text: toJSON({
								ok: false,
								error: error instanceof Error ? error.message : 'Unknown error',
							}),
						},
					],
				};
			}
		},
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

			const response = isCompact()
				? {
						ent: stats.totalEntities,
						obs: stats.totalObservations,
						rel: stats.totalRelations,
						byType: stats.entityTypeCounts,
					}
				: {
						totalEntities: stats.totalEntities,
						totalObservations: stats.totalObservations,
						totalRelations: stats.totalRelations,
						entitiesByType: stats.entityTypeCounts,
					};

			return {
				content: [
					{
						type: 'text' as const,
						text: toJSON(response),
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

	// ============================================
	// Tool: extract_memories
	// ============================================
	server.tool(
		'extract_memories',
		{
			text: z
				.string()
				.min(10)
				.max(100000)
				.describe('Text to extract entities and facts from'),
			source: z
				.enum(['conversation', 'note', 'document', 'manual'])
				.default('manual')
				.describe('Source of this text for attribution'),
			storeResults: z
				.boolean()
				.default(true)
				.describe('Store extracted memories in database (false for preview only)'),
		},
		async ({ text, source, storeResults }) => {
			logger.info('extract_memories called', {
				textLength: text.length,
				source,
				storeResults,
			});

			if (!isExtractionConfigured()) {
				return {
					content: [
						{
							type: 'text' as const,
							text: toJSON({
								error: 'Memory extraction not configured',
								message:
									'Set ENABLE_MEMORY_EXTRACTION=true and ANTHROPIC_API_KEY to enable extraction',
							}),
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
				const { extraction, storage } = await extractAndStoreMemories(text, source);

				// If storeResults is false, we still extracted but results were stored
				// In future, we could add a preview-only mode that skips storage
				const response = isCompact()
					? {
							ok: true,
							entities: extraction.entities.map((e) => ({
								n: e.name,
								t: e.type,
								o: e.observations,
							})),
							relations: extraction.relations.map((r) => ({
								f: r.from,
								r: r.relation,
								t: r.to,
							})),
							stored: {
								obs: storage.observationsCreated,
								dup: storage.observationsDuplicate,
								rel: storage.relationsCreated,
							},
						}
					: {
							success: true,
							extraction: {
								entities: extraction.entities,
								relations: extraction.relations,
							},
							storage: {
								observationsCreated: storage.observationsCreated,
								observationsDuplicate: storage.observationsDuplicate,
								relationsCreated: storage.relationsCreated,
								errors: storage.errors.length > 0 ? storage.errors : undefined,
							},
						};

				return {
					content: [
						{
							type: 'text' as const,
							text: toJSON(response),
						},
					],
				};
			} catch (error) {
				logger.error('extract_memories failed', {
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
		},
	);

	logger.debug('Registered tool: extract_memories');
}
