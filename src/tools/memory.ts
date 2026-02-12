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
import { getEntityContext, hybridMemorySearch, semanticMemorySearch } from '../db/memory-search.js';
import { generateEmbedding, isOpenAIConfigured } from '../services/embeddings.js';
import {
	extractAndStoreMemories,
	extractMemoriesFromText,
	isExtractionConfigured,
} from '../services/memory-extraction.js';
import { configError, formatId, isCompact, toJSON, toolError } from '../utils/compact.js';
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
				'Store a single atomic fact about an entity (person, project, concept, etc.) with automatic semantic embedding. Creates the entity if it does not exist. Idempotent: duplicate facts are detected and skipped. Prefer build_knowledge for batch operations.',
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
	// Tool: query_memory
	// Consolidated: replaces recall_memories, get_entity_context, list_entities
	// ============================================
	// --- query_memory Output Schema ---
	const QueryMemoryOutputSchema = {
		mode: z.enum(['search', 'entity', 'list']),
		// Search mode fields
		totalMemories: z.number().optional(),
		entities: z
			.array(
				z.object({
					entityName: z.string(),
					entityType: z.string(),
					memories: z.array(
						z.object({
							content: z.string(),
							source: z.string(),
							score: z.number(),
						}),
					),
				}),
			)
			.optional(),
		// Entity mode fields
		found: z.boolean().optional(),
		entity: z
			.object({
				id: z.string(),
				name: z.string(),
				type: z.string(),
				description: z.string().nullable(),
			})
			.optional(),
		observations: z
			.array(
				z.object({
					id: z.string(),
					content: z.string(),
					source: z.string(),
					created_at: z.string(),
				}),
			)
			.optional(),
		relations: z
			.object({
				outgoing: z.array(z.object({ relation_type: z.string(), to_entity: z.string() })),
				incoming: z.array(z.object({ from_entity: z.string(), relation_type: z.string() })),
			})
			.optional(),
		hasMore: z.boolean().optional(),
		totalObservations: z.number().optional(),
		message: z.string().optional(),
		// List mode fields
		total: z.number().optional(),
		returned: z.number().optional(),
		offset: z.number().optional(),
		entityList: z
			.array(
				z.object({
					id: z.string(),
					name: z.string(),
					type: z.string(),
					description: z.string().nullable(),
					updatedAt: z.string(),
				}),
			)
			.optional(),
	};

	server.registerTool(
		'query_memory',
		{
			title: 'Query Memory',
			description:
				'Query the memory graph. mode="search": semantic/hybrid search across memories. mode="entity": get full context for a named entity (observations + relations). mode="list": list all entities with optional type filter.',
			inputSchema: {
				mode: z
					.enum(['search', 'entity', 'list'])
					.describe(
						'Query mode. "search": search memories by query. "entity": get full context for a named entity. "list": list all entities.',
					),
				query: z
					.string()
					.min(1)
					.max(1000)
					.optional()
					.describe('Search query (required for mode="search")'),
				entityTypes: z
					.array(EntityTypeSchema)
					.optional()
					.describe('Filter by entity types (e.g., ["person", "project"])'),
				searchMode: z
					.enum(['hybrid', 'semantic'])
					.default('hybrid')
					.describe(
						'Search algorithm for mode="search": hybrid (keyword + semantic) or semantic only',
					),
				entityName: z
					.string()
					.min(1)
					.max(200)
					.optional()
					.describe('Entity name to look up (required for mode="entity")'),
				includeRelated: z
					.boolean()
					.default(true)
					.describe('Include related entities and relations (for mode="entity")'),
				maxObs: z
					.number()
					.int()
					.min(1)
					.max(100)
					.default(20)
					.describe('Max observations to return (for mode="entity")'),
				limit: z
					.number()
					.int()
					.min(1)
					.max(100)
					.default(10)
					.describe('Maximum results (mode="search": max 50, mode="list": max 100)'),
				offset: z.number().int().min(0).default(0).describe('Pagination offset (for mode="list")'),
			},
			outputSchema: QueryMemoryOutputSchema,
			annotations: {
				readOnlyHint: true,
				destructiveHint: false,
				openWorldHint: false,
			},
		},
		async ({
			mode,
			query,
			entityTypes,
			searchMode,
			entityName,
			includeRelated,
			maxObs,
			limit,
			offset,
		}) => {
			logger.info('query_memory called', { mode, query, entityName, entityTypes, limit });

			if (!isSupabaseConfigured()) {
				return configError('Database', 'Set SUPABASE_URL and SUPABASE_SERVICE_KEY');
			}

			try {
				switch (mode) {
					// --- Search mode (replaces recall_memories) ---
					case 'search': {
						if (!query) {
							return toolError('query is required for mode="search"');
						}
						if (!isOpenAIConfigured()) {
							return configError('Embedding provider', 'Set OPENAI_API_KEY or configure Ollama');
						}

						const queryEmbedding = await generateEmbedding(query);

						const results =
							searchMode === 'semantic'
								? await semanticMemorySearch(queryEmbedding, {
										limit: Math.min(limit, 50),
										entityTypes: entityTypes as EntityType[] | undefined,
									})
								: await hybridMemorySearch(query, queryEmbedding, {
										limit: Math.min(limit, 50),
										entityTypes: entityTypes as EntityType[] | undefined,
									});

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

						// Build structuredContent (always verbose, canonical keys)
						const structuredContent = {
							mode: 'search' as const,
							totalMemories: results.length,
							entities: groupedResults,
						};

						// Build content text (compact or verbose)
						const text = isCompact()
							? JSON.stringify({
									n: results.length,
									e: groupedResults.map((g) => ({
										n: g.entityName,
										t: g.entityType,
										m: g.memories.map((m) => ({ c: m.content, s: m.score })),
									})),
								})
							: JSON.stringify(structuredContent, null, 2);

						return {
							content: [{ type: 'text' as const, text }],
							structuredContent,
						};
					}

					// --- Entity mode (replaces get_entity_context) ---
					case 'entity': {
						if (!entityName) {
							return toolError('entityName is required for mode="entity"');
						}

						const context = await getEntityContext(entityName, includeRelated);

						if (!context) {
							const structuredContent = {
								mode: 'entity' as const,
								found: false,
								message: `No entity found with name "${entityName}". Use query_memory with mode="list" to see available entities, or remember_fact to create one.`,
							};

							const text = isCompact()
								? JSON.stringify({ found: false })
								: JSON.stringify(structuredContent, null, 2);

							return {
								content: [{ type: 'text' as const, text }],
								structuredContent,
							};
						}

						const limitedObs = context.observations.slice(0, maxObs);
						const hasMore = context.observations.length > maxObs;

						// Build structuredContent (always verbose, canonical keys)
						const structuredContent = {
							mode: 'entity' as const,
							found: true,
							entity: {
								id: context.entity_id,
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

						// Build content text (compact or verbose)
						const text = isCompact()
							? JSON.stringify({
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
								})
							: JSON.stringify(structuredContent, null, 2);

						return {
							content: [{ type: 'text' as const, text }],
							structuredContent,
						};
					}

					// --- List mode (replaces list_entities) ---
					case 'list': {
						const { entities, total } = await listEntities({
							entityTypes: entityTypes as EntityType[] | undefined,
							limit: Math.min(limit, 100),
							offset,
						});

						// Build structuredContent (always verbose, canonical keys)
						const structuredContent = {
							mode: 'list' as const,
							total,
							returned: entities.length,
							offset,
							entityList: entities.map((e) => ({
								id: e.id,
								name: e.name,
								type: e.entity_type,
								description: e.description,
								updatedAt: e.updated_at,
							})),
						};

						// Build content text (compact or verbose)
						const text = isCompact()
							? JSON.stringify({
									n: total,
									e: entities.map((e) => ({ n: e.name, t: e.entity_type })),
								})
							: JSON.stringify(structuredContent, null, 2);

						return {
							content: [{ type: 'text' as const, text }],
							structuredContent,
						};
					}
				}
			} catch (error) {
				logger.error('query_memory failed', {
					mode,
					error: error instanceof Error ? error.message : String(error),
				});

				return toolError(
					`Memory query failed: ${error instanceof Error ? error.message : 'Unknown error'}`,
				);
			}
		},
	);

	logger.debug('Registered tool: query_memory');

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
				'Prefer build_knowledge for batch operations.',
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
				fromEntityType: EntityTypeSchema.optional()
					.nullable()
					.describe(
						'Type of source entity. Omit if entity already exists — type is auto-detected. Only needed when creating a new entity.',
					),
				toEntityType: EntityTypeSchema.optional()
					.nullable()
					.describe(
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
						`Entity "${entityName}" not found. Use query_memory with mode="list" to see available entities.`,
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

	// ============================================
	// Tool: build_knowledge
	// ============================================
	server.registerTool(
		'build_knowledge',
		{
			title: 'Build Knowledge',
			description:
				'Store multiple facts and relations in a single call. More efficient than calling remember_fact and relate_entities individually. Creates entities automatically. Idempotent: duplicate facts and relations are skipped.',
			inputSchema: {
				facts: z
					.array(
						z.object({
							entityName: z.string().min(1).max(200),
							entityType: EntityTypeSchema,
							observation: z.string().min(1).max(2000),
							source: z
								.enum(['conversation', 'note', 'document', 'manual'])
								.optional()
								.default('conversation'),
						}),
					)
					.max(50)
					.optional()
					.describe('Facts to store (max 50)'),
				relations: z
					.array(
						z.object({
							fromEntity: z.string().min(1).max(200),
							relation: z.string().min(1).max(100),
							toEntity: z.string().min(1).max(200),
							fromEntityType: EntityTypeSchema.optional().nullable(),
							toEntityType: EntityTypeSchema.optional().nullable(),
						}),
					)
					.max(50)
					.optional()
					.describe('Relations to create (max 50)'),
			},
			annotations: {
				readOnlyHint: false,
				destructiveHint: false,
				idempotentHint: true,
				openWorldHint: false,
			},
		},
		async ({ facts, relations }) => {
			logger.info('build_knowledge called', {
				factCount: facts?.length ?? 0,
				relationCount: relations?.length ?? 0,
			});

			if (!facts?.length && !relations?.length) {
				return toolError('Provide at least one fact or relation');
			}

			if (!isSupabaseConfigured()) {
				return configError('Database', 'Set SUPABASE_URL and SUPABASE_SERVICE_KEY');
			}

			if (!isOpenAIConfigured()) {
				return configError('Embedding provider', 'Set OPENAI_API_KEY or configure Ollama');
			}

			let factsCreated = 0;
			let factsDuplicate = 0;
			let relationsCreated = 0;
			const errors: string[] = [];

			// Process facts
			if (facts?.length) {
				for (const fact of facts) {
					try {
						const entity = await getOrCreateEntity({
							name: fact.entityName,
							entityType: fact.entityType as EntityType,
						});

						// Check for duplicate
						const existing = await findSimilarObservation(entity.id, fact.observation);
						if (existing) {
							factsDuplicate++;
							continue;
						}

						// Generate embedding and create observation
						const embedding = await generateEmbedding(fact.observation);
						await createObservation({
							entityId: entity.id,
							content: fact.observation,
							source: fact.source,
							embedding,
							validUntil: null,
						});
						factsCreated++;
					} catch (error) {
						const msg = `fact "${fact.entityName}": ${error instanceof Error ? error.message : String(error)}`;
						logger.error('build_knowledge fact failed', { entity: fact.entityName, error: msg });
						errors.push(msg);
					}
				}
			}

			// Process relations
			if (relations?.length) {
				for (const rel of relations) {
					try {
						const cleanFromType = sanitizeEntityType(rel.fromEntityType);
						const cleanToType = sanitizeEntityType(rel.toEntityType);

						const fromEntityObj = await getOrCreateEntity({
							name: rel.fromEntity,
							entityType:
								cleanFromType || (await findEntityByName(rel.fromEntity))?.entity_type || 'concept',
						});

						const toEntityObj = await getOrCreateEntity({
							name: rel.toEntity,
							entityType:
								cleanToType || (await findEntityByName(rel.toEntity))?.entity_type || 'concept',
						});

						await getOrCreateRelation({
							fromEntityId: fromEntityObj.id,
							toEntityId: toEntityObj.id,
							relationType: rel.relation,
						});
						relationsCreated++;
					} catch (error) {
						const msg = `relation "${rel.fromEntity} ${rel.relation} ${rel.toEntity}": ${error instanceof Error ? error.message : String(error)}`;
						logger.error('build_knowledge relation failed', {
							from: rel.fromEntity,
							to: rel.toEntity,
							error: msg,
						});
						errors.push(msg);
					}
				}
			}

			const hasErrors = errors.length > 0;
			logger.info('build_knowledge completed', {
				factsCreated,
				factsDuplicate,
				relationsCreated,
				errors: hasErrors ? errors.length : 0,
			});

			return {
				content: [
					{
						type: 'text' as const,
						text: toJSON(
							isCompact()
								? {
										ok: !hasErrors,
										...(hasErrors ? { partial: true } : {}),
										facts: { new: factsCreated, dup: factsDuplicate },
										rel: relationsCreated,
										...(hasErrors ? { err: errors } : {}),
									}
								: {
										success: !hasErrors,
										...(hasErrors ? { partialSuccess: true } : {}),
										factsCreated,
										factsDuplicate,
										relationsCreated,
										...(hasErrors ? { errors } : {}),
									},
						),
					},
				],
			};
		},
	);

	logger.debug('Registered tool: build_knowledge');
}
