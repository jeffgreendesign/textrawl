import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { z } from 'zod';
import { isSupabaseConfigured } from '../db/client.js';
import { hybridConversationSearch } from '../db/conversation-search.js';
import { hybridMemorySearch } from '../db/memory-search.js';
import { hybridSearch } from '../db/search.js';
import { generateEmbedding, isOpenAIConfigured } from '../services/embeddings.js';
import { configError, formatId, isCompact, toJSON, toolError } from '../utils/compact.js';
import { config } from '../utils/config.js';
import { logger } from '../utils/logger.js';

// --- Output Schema ---

const SearchResultItemSchema = z.object({
	type: z.enum(['document', 'memory', 'conversation']),
	score: z.number(),
	// Document fields
	documentId: z.string().optional(),
	documentTitle: z.string().optional(),
	sourceType: z.string().optional(),
	tags: z.array(z.string()).optional(),
	chunkId: z.string().optional(),
	// Memory fields
	entityId: z.string().optional(),
	entityName: z.string().optional(),
	entityType: z.string().optional(),
	// Conversation fields
	sessionId: z.string().optional(),
	sessionKey: z.string().nullable().optional(),
	title: z.string().nullable().optional(),
	summary: z.string().nullable().optional(),
	// Shared
	content: z.string().optional(),
});

const SearchOutputSchema = {
	query: z.string(),
	totalResults: z.number(),
	results: z.array(SearchResultItemSchema),
	counts: z
		.object({
			documents: z.number(),
			memories: z.number(),
			conversations: z.number(),
		})
		.optional(),
};

/**
 * Register the unified search tool
 *
 * Replaces search_knowledge and search_with_context.
 * By default searches documents only. Set includeMemories / includeConversations
 * to also search those sources with weighted RRF fusion.
 */
export function registerSearchTool(server: McpServer): void {
	server.registerTool(
		'search',
		{
			title: 'Search',
			description:
				'Search the knowledge base using hybrid semantic + full-text search. Optionally include entity memories and past conversations with weighted fusion.',
			annotations: {
				readOnlyHint: true,
				destructiveHint: false,
				openWorldHint: false,
			},
			inputSchema: {
				query: z
					.string()
					.min(1)
					.max(10000, 'Query must be at most 10KB')
					.describe('Natural language search query'),
				limit: z.number().min(1).max(50).default(5).describe('Maximum results to return'),
				fullTextWeight: z
					.number()
					.min(0)
					.max(2)
					.default(1.0)
					.describe('Weight for keyword matching (0-2)'),
				semanticWeight: z
					.number()
					.min(0)
					.max(2)
					.default(1.0)
					.describe('Weight for semantic similarity (0-2)'),
				tags: z
					.array(z.string())
					.optional()
					.describe('Filter results to only include documents with ALL specified tags'),
				sourceType: z
					.enum(['note', 'file', 'url'])
					.optional()
					.describe('Filter by document source type'),
				contentType: z
					.enum(['email', 'youtube', 'calendar', 'contact', 'webpage', 'document'])
					.optional()
					.describe(
						'Filter by content type (email, youtube watch history, calendar events, contacts, webpages)',
					),
				minScore: z
					.number()
					.min(0)
					.max(1)
					.optional()
					.describe('Minimum relevance score threshold (0-1) to filter out low-quality results'),
				includeMemories: z
					.boolean()
					.default(false)
					.describe(
						'Also search entity memories (requires ENABLE_MEMORY). Results are fused with document results by score.',
					),
				includeConversations: z
					.boolean()
					.default(false)
					.describe(
						'Also search past conversations (requires ENABLE_CONVERSATIONS). Results are fused with document results by score.',
					),
				memoryWeight: z
					.number()
					.min(0)
					.max(2)
					.default(1.0)
					.describe('Weight for memory results when includeMemories=true (0-2)'),
				conversationWeight: z
					.number()
					.min(0)
					.max(2)
					.default(0.5)
					.describe('Weight for conversation results when includeConversations=true (0-2)'),
			},
			outputSchema: SearchOutputSchema,
			_meta: {
				ui: {
					resourceUri: 'ui://textrawl/search-results',
				},
			},
		},
		async ({
			query,
			limit,
			fullTextWeight,
			semanticWeight,
			tags,
			sourceType,
			contentType,
			minScore,
			includeMemories,
			includeConversations,
			memoryWeight,
			conversationWeight,
		}) => {
			logger.info('search called', {
				query,
				limit,
				fullTextWeight,
				semanticWeight,
				tags,
				sourceType,
				contentType,
				minScore,
				includeMemories,
				includeConversations,
			});

			if (!isSupabaseConfigured()) {
				return configError('Database', 'Set SUPABASE_URL and SUPABASE_SERVICE_KEY');
			}

			if (!isOpenAIConfigured()) {
				return configError('Embedding provider', 'Set OPENAI_API_KEY or configure Ollama');
			}

			try {
				// Generate embedding for the query
				const queryEmbedding = await generateEmbedding(query);

				// Request more results to allow for post-filtering
				const fetchLimit = tags || sourceType || contentType || minScore ? limit * 3 : limit;

				// Perform hybrid search on documents
				let docResults = await hybridSearch({
					queryText: query,
					queryEmbedding,
					limit: fetchLimit,
					fullTextWeight,
					semanticWeight,
				});

				// Apply post-filters
				if (sourceType) {
					docResults = docResults.filter((r) => r.source_type === sourceType);
				}

				if (contentType) {
					docResults = docResults.filter((r) => r.document_metadata?.content_type === contentType);
				}

				if (tags && tags.length > 0) {
					docResults = docResults.filter((r) => {
						const docTags = (r.document_metadata?.tags as string[]) || [];
						return tags.every((tag) => docTags.includes(tag));
					});
				}

				if (minScore !== undefined) {
					docResults = docResults.filter((r) => r.score >= minScore);
				}

				// Apply final limit after filtering
				docResults = docResults.slice(0, limit);

				// --- Document-only response (default) ---
				const crossSource = includeMemories || includeConversations;

				if (!crossSource) {
					// Build structuredContent (always verbose, canonical keys)
					const structuredContent = {
						query,
						totalResults: docResults.length,
						results: docResults.map((r) => {
							const docTags = (r.document_metadata?.tags as string[]) || [];
							return {
								type: 'document' as const,
								score: r.score,
								documentId: r.document_id,
								documentTitle: r.document_title,
								sourceType: r.source_type,
								tags: docTags,
								chunkId: r.chunk_id,
								content: r.content.slice(0, 500),
							};
						}),
					};

					// Build content text (compact or verbose)
					if (isCompact()) {
						return {
							content: [
								{
									type: 'text' as const,
									text: JSON.stringify({
										n: docResults.length,
										r: docResults.map((r) => ({
											d: formatId(r.document_id),
											t: r.document_title,
											c: r.content.slice(0, 300),
											s: Math.round(r.score * 1000) / 1000,
										})),
									}),
								},
							],
							structuredContent,
						};
					}

					return {
						content: [
							{
								type: 'text' as const,
								text: JSON.stringify(structuredContent, null, 2),
							},
						],
						structuredContent,
					};
				}

				// --- Cross-source fusion ---
				// Results from multiple retrievers are combined using score-based
				// linear weighting (not rank-based RRF). Document scores pass
				// through unweighted — they are already fused via weighted RRF
				// during retrieval (fullTextWeight / semanticWeight). Memory
				// scores are scaled by memoryWeight, conversation scores by
				// conversationWeight. Score scales may differ between retrievers;
				// this is an accepted trade-off for simplicity over per-retriever
				// normalization.
				const allResults: Array<{
					type: 'document' | 'memory' | 'conversation';
					score: number;
					data: Record<string, unknown>;
				}> = [];

				for (const doc of docResults) {
					allResults.push({
						type: 'document',
						score: doc.score,
						data: {
							documentId: doc.document_id,
							documentTitle: doc.document_title,
							content: doc.content.slice(0, 500),
							sourceType: doc.source_type,
						},
					});
				}

				// Search memories
				if (includeMemories && config.ENABLE_MEMORY) {
					const memories = await hybridMemorySearch(query, queryEmbedding, { limit });
					for (const mem of memories) {
						allResults.push({
							type: 'memory',
							score: mem.score * memoryWeight,
							data: {
								entityId: mem.entity_id,
								entityName: mem.entity_name,
								entityType: mem.entity_type,
								content: mem.observation_content.slice(0, 500),
							},
						});
					}
				}

				// Search conversations
				if (includeConversations && config.ENABLE_CONVERSATIONS) {
					const convos = await hybridConversationSearch(query, queryEmbedding, {
						limit,
					});
					for (const conv of convos) {
						allResults.push({
							type: 'conversation',
							score: conv.score * conversationWeight,
							data: {
								sessionId: conv.session_id,
								sessionKey: conv.session_key,
								title: conv.title,
								summary: conv.summary?.slice(0, 300),
							},
						});
					}
				}

				// Sort by score (highest first) and limit
				allResults.sort((a, b) => b.score - a.score);
				const limitedResults = allResults.slice(0, limit * 2);

				const docCount = docResults.length;
				const memCount = allResults.filter((r) => r.type === 'memory').length;
				const convCount = allResults.filter((r) => r.type === 'conversation').length;

				logger.info('search completed (cross-source)', {
					documentCount: docCount,
					memoryCount: memCount,
					conversationCount: convCount,
					totalFused: limitedResults.length,
				});

				// Build structuredContent (always verbose, canonical keys)
				const structuredContent = {
					query,
					totalResults: limitedResults.length,
					counts: {
						documents: docCount,
						memories: memCount,
						conversations: convCount,
					},
					results: limitedResults.map((r) => ({
						type: r.type,
						score: r.score,
						...r.data,
					})),
				};

				// Build content text (compact or verbose)
				if (isCompact()) {
					return {
						content: [
							{
								type: 'text' as const,
								text: JSON.stringify({
									n: limitedResults.length,
									r: limitedResults.map((r) => ({
										src: r.type[0],
										s: Math.round(r.score * 1000) / 1000,
										...r.data,
									})),
								}),
							},
						],
						structuredContent,
					};
				}

				return {
					content: [
						{
							type: 'text' as const,
							text: JSON.stringify(structuredContent, null, 2),
						},
					],
					structuredContent,
				};
			} catch (error) {
				logger.error('search failed', {
					error: error instanceof Error ? error.message : String(error),
				});

				return toolError(
					`Search failed: ${error instanceof Error ? error.message : 'Unknown error'}`,
				);
			}
		},
	);

	logger.debug('Registered tool: search');
}
