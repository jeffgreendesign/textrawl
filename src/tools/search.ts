import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { z } from 'zod';
import { isSupabaseConfigured } from '../db/client.js';
import { hybridConversationSearch } from '../db/conversation-search.js';
import { hybridMemorySearch } from '../db/memory-search.js';
import { hybridSearch } from '../db/search.js';
import { generateEmbedding, isOpenAIConfigured } from '../services/embeddings.js';
import { formatId, isCompact } from '../utils/compact.js';
import { config } from '../utils/config.js';
import { logger } from '../utils/logger.js';

/**
 * Register the search_knowledge tool
 *
 * This tool performs hybrid semantic + full-text search over the knowledge base.
 */
export function registerSearchTool(server: McpServer): void {
	server.registerTool(
		'search_knowledge',
		{
			description: 'Search the knowledge base using hybrid semantic + full-text search',
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
			},
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
		}) => {
			logger.info('search_knowledge called', {
				query,
				limit,
				fullTextWeight,
				semanticWeight,
				tags,
				sourceType,
				contentType,
				minScore,
			});

			// Check if services are configured
			if (!isSupabaseConfigured()) {
				return {
					content: [
						{
							type: 'text' as const,
							text: JSON.stringify(
								{
									error: 'Database not configured',
									message: 'Set SUPABASE_URL and SUPABASE_SERVICE_KEY to enable search.',
								},
								null,
								2,
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
									error: 'OpenAI not configured',
									message: 'Set OPENAI_API_KEY to enable semantic search.',
								},
								null,
								2,
							),
						},
					],
				};
			}

			try {
				// Generate embedding for the query
				const queryEmbedding = await generateEmbedding(query);

				// Request more results to allow for post-filtering
				const fetchLimit = tags || sourceType || contentType || minScore ? limit * 3 : limit;

				// Perform hybrid search
				let results = await hybridSearch({
					queryText: query,
					queryEmbedding,
					limit: fetchLimit,
					fullTextWeight,
					semanticWeight,
				});

				// Apply post-filters
				if (sourceType) {
					results = results.filter((r) => r.source_type === sourceType);
				}

				if (contentType) {
					results = results.filter((r) => r.document_metadata?.content_type === contentType);
				}

				if (tags && tags.length > 0) {
					results = results.filter((r) => {
						const docTags = (r.document_metadata?.tags as string[]) || [];
						return tags.every((tag) => docTags.includes(tag));
					});
				}

				if (minScore !== undefined) {
					results = results.filter((r) => r.score >= minScore);
				}

				// Apply final limit after filtering
				results = results.slice(0, limit);

				// Format results for output with metadata
				if (isCompact()) {
					return {
						content: [
							{
								type: 'text' as const,
								text: JSON.stringify({
									n: results.length,
									r: results.map((r) => ({
										d: formatId(r.document_id),
										t: r.document_title,
										c: r.content.slice(0, 300),
										s: Math.round(r.score * 1000) / 1000,
									})),
								}),
							},
						],
					};
				}

				const formattedResults = results.map((r) => {
					const docTags = (r.document_metadata?.tags as string[]) || [];
					return {
						documentId: r.document_id,
						documentTitle: r.document_title,
						sourceType: r.source_type,
						tags: docTags,
						chunkId: r.chunk_id,
						content: r.content.slice(0, 500),
						score: r.score,
					};
				});

				return {
					content: [
						{
							type: 'text' as const,
							text: JSON.stringify(
								{
									query,
									totalResults: formattedResults.length,
									results: formattedResults,
								},
								null,
								2,
							),
						},
					],
				};
			} catch (error) {
				logger.error('search_knowledge failed', {
					error: error instanceof Error ? error.message : String(error),
				});

				return {
					content: [
						{
							type: 'text' as const,
							text: JSON.stringify(
								{
									error: 'Search failed',
									message: error instanceof Error ? error.message : 'Unknown error',
								},
								null,
								2,
							),
						},
					],
				};
			}
		},
	);

	logger.debug('Registered tool: search_knowledge');

	// ============================================
	// Tool: search_with_context
	// Unified search across documents, memories, and conversations
	// ============================================
	server.registerTool(
		'search_with_context',
		{
			description: 'Unified search across documents, memories, and conversations',
			inputSchema: {
				query: z.string().min(1).max(10000).describe('Natural language search query'),
				limit: z.number().int().min(1).max(30).default(5).describe('Maximum results per source'),
				includeDocuments: z.boolean().default(true).describe('Search documents/notes'),
				includeMemories: z
					.boolean()
					.default(true)
					.describe('Search entity memories (requires ENABLE_MEMORY)'),
				includeConversations: z
					.boolean()
					.default(false)
					.describe('Search past conversations (requires ENABLE_CONVERSATIONS)'),
				documentWeight: z
					.number()
					.min(0)
					.max(2)
					.default(1.0)
					.describe('Weight for document results in fusion'),
				memoryWeight: z
					.number()
					.min(0)
					.max(2)
					.default(1.0)
					.describe('Weight for memory results in fusion'),
				conversationWeight: z
					.number()
					.min(0)
					.max(2)
					.default(0.5)
					.describe('Weight for conversation results in fusion'),
			},
			_meta: {
				ui: {
					resourceUri: 'ui://textrawl/search-results',
				},
			},
		},
		async ({
			query,
			limit,
			includeDocuments,
			includeMemories,
			includeConversations,
			documentWeight,
			memoryWeight,
			conversationWeight,
		}) => {
			logger.info('search_with_context called', {
				query,
				limit,
				includeDocuments,
				includeMemories,
				includeConversations,
			});

			if (!isSupabaseConfigured()) {
				return {
					content: [
						{
							type: 'text' as const,
							text: JSON.stringify({ error: 'Database not configured' }, null, 2),
						},
					],
				};
			}

			if (!isOpenAIConfigured()) {
				return {
					content: [
						{
							type: 'text' as const,
							text: JSON.stringify({ error: 'Embedding not configured' }, null, 2),
						},
					],
				};
			}

			try {
				// Generate embedding for the query
				const embedStart = Date.now();
				const queryEmbedding = await generateEmbedding(query);
				logger.debug('Query embedding generated', { latencyMs: Date.now() - embedStart });

				// Collect results from all sources
				const documentResults: Array<{
					type: 'document';
					id: string;
					title: string;
					content: string;
					score: number;
					sourceType: string;
				}> = [];

				const memoryResults: Array<{
					type: 'memory';
					entityId: string;
					entityName: string;
					entityType: string;
					content: string;
					score: number;
				}> = [];

				const conversationResults: Array<{
					type: 'conversation';
					sessionId: string;
					sessionKey: string | null;
					title: string | null;
					summary: string | null;
					score: number;
				}> = [];

				// Search documents
				if (includeDocuments) {
					const docs = await hybridSearch({
						queryText: query,
						queryEmbedding,
						limit,
					});
					for (const doc of docs) {
						documentResults.push({
							type: 'document',
							id: doc.document_id,
							title: doc.document_title,
							content: doc.content,
							score: doc.score * documentWeight,
							sourceType: doc.source_type,
						});
					}
				}

				// Search memories
				if (includeMemories && config.ENABLE_MEMORY) {
					const memories = await hybridMemorySearch(query, queryEmbedding, { limit });
					for (const mem of memories) {
						memoryResults.push({
							type: 'memory',
							entityId: mem.entity_id,
							entityName: mem.entity_name,
							entityType: mem.entity_type,
							content: mem.observation_content,
							score: mem.score * memoryWeight,
						});
					}
				}

				// Search conversations
				if (includeConversations && config.ENABLE_CONVERSATIONS) {
					const convos = await hybridConversationSearch(query, queryEmbedding, { limit });
					for (const conv of convos) {
						conversationResults.push({
							type: 'conversation',
							sessionId: conv.session_id,
							sessionKey: conv.session_key,
							title: conv.title,
							summary: conv.summary,
							score: conv.score * conversationWeight,
						});
					}
				}

				// Merge and sort by weighted score
				const allResults: Array<{
					type: 'document' | 'memory' | 'conversation';
					score: number;
					data: unknown;
				}> = [];

				for (const doc of documentResults) {
					allResults.push({
						type: 'document',
						score: doc.score,
						data: {
							id: doc.id,
							title: doc.title,
							content: doc.content.slice(0, 500), // Truncate for response size
							sourceType: doc.sourceType,
						},
					});
				}

				for (const mem of memoryResults) {
					allResults.push({
						type: 'memory',
						score: mem.score,
						data: {
							entityId: mem.entityId,
							entityName: mem.entityName,
							entityType: mem.entityType,
							content: mem.content.slice(0, 500),
						},
					});
				}

				for (const conv of conversationResults) {
					allResults.push({
						type: 'conversation',
						score: conv.score,
						data: {
							sessionId: conv.sessionId,
							sessionKey: conv.sessionKey,
							title: conv.title,
							summary: conv.summary?.slice(0, 300),
						},
					});
				}

				// Sort by score (highest first)
				allResults.sort((a, b) => b.score - a.score);

				// Limit total results
				const limitedResults = allResults.slice(0, limit * 2);

				logger.info('search_with_context completed', {
					documentCount: documentResults.length,
					memoryCount: memoryResults.length,
					conversationCount: conversationResults.length,
					totalFused: limitedResults.length,
				});

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
										...(r.data as Record<string, unknown>),
									})),
								}),
							},
						],
					};
				}

				return {
					content: [
						{
							type: 'text' as const,
							text: JSON.stringify(
								{
									query,
									counts: {
										documents: documentResults.length,
										memories: memoryResults.length,
										conversations: conversationResults.length,
									},
									results: limitedResults,
								},
								null,
								2,
							),
						},
					],
				};
			} catch (error) {
				logger.error('search_with_context failed', {
					error: error instanceof Error ? error.message : String(error),
				});

				return {
					content: [
						{
							type: 'text' as const,
							text: JSON.stringify(
								{
									error: 'Search failed',
									message: error instanceof Error ? error.message : 'Unknown error',
								},
								null,
								2,
							),
						},
					],
				};
			}
		},
	);

	logger.debug('Registered tool: search_with_context');
}
