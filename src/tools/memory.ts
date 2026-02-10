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
import { createObservation, findSimilarObservation } from '../db/memory-observations.js';
import { RELATION_TYPES, getOrCreateRelation } from '../db/memory-relations.js';
import {
	getEntityContext,
	getMemoryStats,
	hybridMemorySearch,
	semanticMemorySearch,
} from '../db/memory-search.js';
import { generateEmbedding, isOpenAIConfigured } from '../services/embeddings.js';
import {
	extractAndStoreMemories,
	extractMemoriesFromText,
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
 * Helper: return an MCP tool error response with isError: true.
 * Per MCP spec, isError signals to the client that the response is an error
 * and the LLM should NOT blindly retry the same call.
 */
function toolError(message: string) {
	return {
		content: [{ type: 'text' as const, text: toJSON({ error: message }) }],
		isError: true,
	};
}

/**
 * Helper: return a configuration error (permanent failure - do not retry).
 */
function configError(what: string, fix: string) {
	return {
		content: [
			{
				type: 'text' as const,
				text: toJSON({
					error: `${what} not configured`,
					message: `${fix}. This is a server configuration issue — do not retry.`,
				}),
			},
		],
		isError: true,
	};
}

/**
 * Sanitize an optional EntityType parameter.
 * LLMs sometimes pass null, "null", undefined, or empty string for optional enum params.
 * This normalizes those to undefined so the fallback logic kicks in correctly.
 */
function sanitizeEntityType(value: unknown): EntityType | undefined {
	if (value === null || value === undefined || value === '' || value === 'null') {
		return undefined;
	}
	// Validate against known types
	const validTypes: EntityType[] = [
		'person',
		'concept',
		'project',
		'preference',
		'fact',
		'location',
		'organization',
	];
	if (typeof value === 'string' && validTypes.includes(value as EntityType)) {
		return value as EntityType;
	}
	// Unknown type — return undefined so we fall back to auto-detection
	return undefined;
}

/**
 * Register all memory-related MCP tools
 */
export function registerMemoryTools(server: McpServer): void {
	// ============================================
	// Tool: remember_fact
	// ============================================
	server.registerTool(
		'remember_fact',
		{
			title: 'Remember Fact',
			description:
				'Store a single atomic fact about an entity (person, project, concept, etc.) with automatic semantic embedding. Creates the entity if it does not exist. Idempotent: duplicate facts are detected and skipped.',
			inputSchema: {
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
					.describe('Source of this memory (default: conversation)'),
				validUntil: z
					.string()
					.optional()
					.describe(
						'ISO date string if this fact expires (e.g., "2026-12-31"). Omit for permanent facts.',
					),
			},
			annotations: {
				readOnlyHint: false,
				destructiveHint: false,
				idempotentHint: true,
				openWorldHint: false,
			},
		},
		async ({ entityName, entityType, observation, source, validUntil }) => {
			logger.info('remember_fact called', {
				entityName,
				entityType,
				observationLength: observation.length,
			});

			if (!isSupabaseConfigured()) {
				return configError('Database', 'Set SUPABASE_URL and SUPABASE_SERVICE_KEY');
			}

			if (!isOpenAIConfigured()) {
				return configError('Embedding provider', 'Set OPENAI_API_KEY or configure Ollama');
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

				return toolError(
					`Failed to remember fact about "${entityName}": ${error instanceof Error ? error.message : 'Unknown error'}`,
				);
			}
		},
	);

	logger.debug('Registered tool: remember_fact');

	// ============================================
	// Tool: recall_memories
	// ============================================
	server.registerTool(
		'recall_memories',
		{
			title: 'Recall Memories',
			description:
				'Search stored memories using hybrid (keyword + semantic) or semantic-only search. Returns memories grouped by entity. Use this to find previously stored facts.',
			inputSchema: {
				query: z
					.string()
					.min(1)
					.max(1000)
					.describe('What to search for in memories. Can be a question or topic.'),
				entityTypes: z
					.array(EntityTypeSchema)
					.optional()
					.describe('Filter by entity types (e.g., ["person", "project"]). Omit to search all.'),
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
			annotations: {
				readOnlyHint: true,
				destructiveHint: false,
				openWorldHint: false,
			},
		},
		async ({ query, entityTypes, limit, searchMode }) => {
			logger.info('recall_memories called', {
				query,
				entityTypes,
				limit,
				searchMode,
			});

			if (!isSupabaseConfigured()) {
				return configError('Database', 'Set SUPABASE_URL and SUPABASE_SERVICE_KEY');
			}

			if (!isOpenAIConfigured()) {
				return configError('Embedding provider', 'Set OPENAI_API_KEY or configure Ollama');
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

				return toolError(
					`Memory search failed: ${error instanceof Error ? error.message : 'Unknown error'}`,
				);
			}
		},
	);

	logger.debug('Registered tool: recall_memories');

	// ============================================
	// Tool: relate_entities
	// ============================================
	server.registerTool(
		'relate_entities',
		{
			title: 'Relate Entities',
			description: [
				'Create a directed relationship between two entities.',
				'Both entities are auto-created if they do not already exist.',
				'If entities already exist, their type is looked up automatically — you can omit fromEntityType/toEntityType.',
				'Idempotent: creating the same relation twice is a no-op.',
				`Common relation types: ${Object.values(RELATION_TYPES).join(', ')}.`,
				'Custom relation types are also accepted (use snake_case).',
			].join(' '),
			inputSchema: {
				fromEntity: z.string().min(1).max(200).describe('The source entity name'),
				relation: z
					.string()
					.min(1)
					.max(100)
					.describe(
						'Relation type in snake_case active voice (e.g., "works_at", "prefers", "knows", "created", "part_of"). Free-form — any string accepted.',
					),
				toEntity: z.string().min(1).max(200).describe('The target entity name'),
				fromEntityType: EntityTypeSchema.optional().describe(
					'Type of source entity. Omit if entity already exists — type is auto-detected. Only needed when creating a new entity.',
				),
				toEntityType: EntityTypeSchema.optional().describe(
					'Type of target entity. Omit if entity already exists — type is auto-detected. Only needed when creating a new entity.',
				),
			},
			annotations: {
				readOnlyHint: false,
				destructiveHint: false,
				idempotentHint: true,
				openWorldHint: false,
			},
		},
		async ({ fromEntity, relation, toEntity, fromEntityType, toEntityType }) => {
			logger.info('relate_entities called', {
				fromEntity,
				relation,
				toEntity,
				fromEntityType,
				toEntityType,
			});

			if (!isSupabaseConfigured()) {
				return configError('Database', 'Set SUPABASE_URL and SUPABASE_SERVICE_KEY');
			}

			try {
				// Sanitize optional entity types:
				// LLMs sometimes pass null, "null", or undefined for optional params.
				const cleanFromType = sanitizeEntityType(fromEntityType);
				const cleanToType = sanitizeEntityType(toEntityType);

				// Get or create entities (with type inference from existing entities)
				const fromEntityObj = await getOrCreateEntity({
					name: fromEntity,
					entityType:
						cleanFromType || (await findEntityByName(fromEntity))?.entity_type || 'concept',
				});

				const toEntityObj = await getOrCreateEntity({
					name: toEntity,
					entityType: cleanToType || (await findEntityByName(toEntity))?.entity_type || 'concept',
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

				return toolError(
					`Failed to relate "${fromEntity}" → "${toEntity}": ${error instanceof Error ? error.message : 'Unknown error'}. Tip: entity type params are optional — omit them if unsure.`,
				);
			}
		},
	);

	logger.debug('Registered tool: relate_entities');

	// ============================================
	// Tool: get_entity_context
	// ============================================
	server.registerTool(
		'get_entity_context',
		{
			title: 'Get Entity Context',
			description:
				'Retrieve all stored information about an entity: observations (facts), outgoing relations, and incoming relations. Use this to see everything known about a specific entity.',
			inputSchema: {
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
			annotations: {
				readOnlyHint: true,
				destructiveHint: false,
				openWorldHint: false,
			},
		},
		async ({ entityName, includeRelated, maxObs }) => {
			logger.info('get_entity_context called', { entityName, includeRelated });

			if (!isSupabaseConfigured()) {
				return configError('Database', 'Set SUPABASE_URL and SUPABASE_SERVICE_KEY');
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
										: {
												found: false,
												message: `No entity found with name "${entityName}". Use list_entities to see available entities, or remember_fact to create one.`,
											},
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

				return toolError(
					`Failed to get context for "${entityName}": ${error instanceof Error ? error.message : 'Unknown error'}`,
				);
			}
		},
	);

	logger.debug('Registered tool: get_entity_context');

	// ============================================
	// Tool: list_entities
	// ============================================
	server.registerTool(
		'list_entities',
		{
			title: 'List Entities',
			description:
				'List all known entities in the memory graph with optional type filtering and pagination.',
			inputSchema: {
				entityTypes: z
					.array(EntityTypeSchema)
					.optional()
					.describe('Filter by entity types. Omit to list all.'),
				limit: z
					.number()
					.int()
					.min(1)
					.max(100)
					.default(50)
					.describe('Maximum number of entities to return'),
				offset: z.number().int().min(0).default(0).describe('Pagination offset'),
			},
			annotations: {
				readOnlyHint: true,
				destructiveHint: false,
				openWorldHint: false,
			},
		},
		async ({ entityTypes, limit, offset }) => {
			logger.info('list_entities called', { entityTypes, limit, offset });

			if (!isSupabaseConfigured()) {
				return configError('Database', 'Set SUPABASE_URL and SUPABASE_SERVICE_KEY');
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

				return toolError(
					`Failed to list entities: ${error instanceof Error ? error.message : 'Unknown error'}`,
				);
			}
		},
	);

	logger.debug('Registered tool: list_entities');

	// ============================================
	// Tool: forget_entity
	// ============================================
	server.registerTool(
		'forget_entity',
		{
			title: 'Forget Entity',
			description:
				'Permanently delete an entity and all its associated observations and relations. Requires confirm=true. This action cannot be undone.',
			inputSchema: {
				entityName: z.string().min(1).max(200).describe('Name of the entity to forget'),
				confirm: z.boolean().describe('Must be true to confirm deletion'),
			},
			annotations: {
				readOnlyHint: false,
				destructiveHint: true,
				idempotentHint: false,
				openWorldHint: false,
			},
		},
		async ({ entityName, confirm }) => {
			logger.info('forget_entity called', { entityName, confirm });

			if (!confirm) {
				return toolError(
					'Deletion not confirmed. Set confirm=true to delete. This action is irreversible.',
				);
			}

			if (!isSupabaseConfigured()) {
				return configError('Database', 'Set SUPABASE_URL and SUPABASE_SERVICE_KEY');
			}

			try {
				const entity = await findEntityByName(entityName);

				if (!entity) {
					return toolError(
						`Entity "${entityName}" not found. Use list_entities to see available entities.`,
					);
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

				return toolError(
					`Failed to forget "${entityName}": ${error instanceof Error ? error.message : 'Unknown error'}`,
				);
			}
		},
	);

	logger.debug('Registered tool: forget_entity');

	// ============================================
	// Tool: memory_stats
	// ============================================
	server.registerTool(
		'memory_stats',
		{
			title: 'Memory Stats',
			description:
				'Get statistics about stored memories: entity counts, observation counts, relation counts, and breakdown by entity type.',
			inputSchema: {},
			annotations: {
				readOnlyHint: true,
				destructiveHint: false,
				openWorldHint: false,
			},
		},
		async () => {
			logger.info('memory_stats called');

			if (!isSupabaseConfigured()) {
				return configError('Database', 'Set SUPABASE_URL and SUPABASE_SERVICE_KEY');
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

				return toolError(
					`Failed to get memory stats: ${error instanceof Error ? error.message : 'Unknown error'}`,
				);
			}
		},
	);

	logger.debug('Registered tool: memory_stats');

	// ============================================
	// Tool: extract_memories
	// ============================================
	server.registerTool(
		'extract_memories',
		{
			title: 'Extract Memories',
			description:
				'Extract entities and facts from text using LLM analysis. Requires ENABLE_MEMORY_EXTRACTION=true and ANTHROPIC_API_KEY. Set storeResults=false to preview without saving.',
			inputSchema: {
				text: z.string().min(10).max(100000).describe('Text to extract entities and facts from'),
				source: z
					.enum(['conversation', 'note', 'document', 'manual'])
					.default('manual')
					.describe('Source of this text for attribution'),
				storeResults: z
					.boolean()
					.default(true)
					.describe('Store extracted memories in database (false for preview only)'),
			},
			annotations: {
				readOnlyHint: false,
				destructiveHint: false,
				idempotentHint: true,
				openWorldHint: true,
			},
		},
		async ({ text, source, storeResults }) => {
			logger.info('extract_memories called', {
				textLength: text.length,
				source,
				storeResults,
			});

			if (!isExtractionConfigured()) {
				return configError(
					'Memory extraction',
					'Set ENABLE_MEMORY_EXTRACTION=true and ANTHROPIC_API_KEY to enable extraction',
				);
			}

			// Only require Supabase if we're storing results
			if (storeResults && !isSupabaseConfigured()) {
				return configError('Database', 'Set SUPABASE_URL and SUPABASE_SERVICE_KEY');
			}

			try {
				// Preview-only mode: extract without storing
				if (!storeResults) {
					const extraction = await extractMemoriesFromText(text);
					const response = isCompact()
						? {
								ok: true,
								preview: true,
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
							}
						: {
								success: true,
								preview: true,
								message: 'Preview only — no memories were stored',
								extraction: {
									entities: extraction.entities,
									relations: extraction.relations,
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
				}

				// Full mode: extract and store
				const { extraction, storage } = await extractAndStoreMemories(text, source);

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

				return toolError(
					`Memory extraction failed: ${error instanceof Error ? error.message : 'Unknown error'}`,
				);
			}
		},
	);

	logger.debug('Registered tool: extract_memories');
}
