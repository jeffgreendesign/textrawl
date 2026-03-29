import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { z } from 'zod';
import { isSupabaseConfigured } from '../db/client.js';
import { isOpenAIConfigured } from '../services/embeddings.js';
import { SearchError, unifiedSearch } from '../services/search.js';
import { configError, formatId, toolError, toolResponse } from '../utils/compact.js';
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
				const response = await unifiedSearch({
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
				});

				const structuredContent = {
					query: response.query,
					totalResults: response.totalResults,
					...(response.counts ? { counts: response.counts } : {}),
					results: response.results,
				};

				return toolResponse({
					compact: {
						n: response.totalResults,
						r: response.results.map((r) => ({
							src: r.type[0],
							s: Math.round(r.score * 1000) / 1000,
							...(r.documentId ? { d: formatId(r.documentId) } : {}),
							...(r.documentTitle ? { t: r.documentTitle } : {}),
							...(r.content ? { c: r.content.slice(0, 300) } : {}),
							...(r.entityName ? { entityName: r.entityName } : {}),
							...(r.entityType ? { entityType: r.entityType } : {}),
							...(r.sessionId ? { sessionId: r.sessionId } : {}),
							...(r.title ? { title: r.title } : {}),
							...(r.summary ? { summary: r.summary } : {}),
						})),
					},
					verbose: structuredContent,
					structuredContent,
				});
			} catch (error) {
				logger.error('search failed', {
					error: error instanceof Error ? error.message : String(error),
				});

				if (error instanceof SearchError) {
					return configError('Search', error.message);
				}

				return toolError(
					`Search failed: ${error instanceof Error ? error.message : 'Unknown error'}`,
				);
			}
		},
	);

	logger.debug('Registered tool: search');
}
