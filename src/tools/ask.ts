import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { z } from 'zod';
import { hybridConversationSearch } from '../db/conversation-search.js';
import { searchInsights } from '../db/insights.js';
import { hybridMemorySearch } from '../db/memory-search.js';
import { isDatabaseConfigured } from '../db/pg-client.js';
import { hybridSearch } from '../db/search.js';
import { generateEmbedding, isEmbeddingsConfigured } from '../services/embeddings.js';
import { configError, toolError } from '../utils/compact.js';
import { config } from '../utils/config.js';
import { logger } from '../utils/logger.js';

/**
 * Register the unified `ask` tool — the primary entry point for querying
 * the knowledge base across all data sources.
 */
export function registerAskTool(server: McpServer): void {
	server.registerTool(
		'ask',
		{
			title: 'Ask Your Knowledge Base',
			description:
				'Search across all your knowledge — documents, memories, conversations, and insights — with a single natural language question. Returns structured results with citations. This is the recommended entry point for querying Textrawl.',
			inputSchema: {
				question: z
					.string()
					.min(1)
					.max(10000)
					.describe('Natural language question to search your knowledge base'),
				scope: z
					.enum(['auto', 'documents', 'memory', 'conversations', 'insights'])
					.default('auto')
					.describe('Which sources to search. "auto" searches all enabled sources.'),
				limit: z.number().int().min(1).max(50).default(10).describe('Maximum results per source'),
			},
			annotations: {
				readOnlyHint: true,
				destructiveHint: false,
				idempotentHint: true,
				openWorldHint: false,
			},
		},
		async ({ question, scope, limit }) => {
			logger.info('ask called', { question: question.slice(0, 100), scope, limit });

			if (!isDatabaseConfigured()) {
				return configError('Database', 'Set SUPABASE_URL and SUPABASE_SERVICE_KEY');
			}
			if (!isEmbeddingsConfigured()) {
				return configError('Embeddings', 'Configure an embedding provider');
			}

			try {
				const queryEmbedding = await generateEmbedding(question);

				const allResults: Array<{
					type: 'document' | 'memory' | 'conversation' | 'insight';
					score: number;
					data: Record<string, unknown>;
				}> = [];

				const searchAll = scope === 'auto';

				// Documents
				if (searchAll || scope === 'documents') {
					const docs = await hybridSearch({
						queryText: question,
						queryEmbedding,
						limit,
					});
					for (const doc of docs) {
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
				}

				// Memory
				if ((searchAll || scope === 'memory') && config.ENABLE_MEMORY) {
					const memories = await hybridMemorySearch(question, queryEmbedding, {
						limit,
					});
					for (const mem of memories) {
						allResults.push({
							type: 'memory',
							score: mem.score,
							data: {
								entityId: mem.entity_id,
								entityName: mem.entity_name,
								entityType: mem.entity_type,
								content: mem.observation_content.slice(0, 500),
								source: mem.source,
							},
						});
					}
				}

				// Conversations
				if ((searchAll || scope === 'conversations') && config.ENABLE_CONVERSATIONS) {
					const convos = await hybridConversationSearch(question, queryEmbedding, { limit });
					for (const conv of convos) {
						allResults.push({
							type: 'conversation',
							score: conv.score,
							data: {
								sessionId: conv.session_id,
								sessionKey: conv.session_key,
								title: conv.title,
								summary: conv.summary?.slice(0, 300),
							},
						});
					}
				}

				// Insights
				if ((searchAll || scope === 'insights') && config.ENABLE_INSIGHTS) {
					const insights = await searchInsights(queryEmbedding, {
						limit,
					});
					for (const insight of insights) {
						allResults.push({
							type: 'insight',
							score: 0.5, // insights don't have a normalized score, use fixed weight
							data: {
								insightId: insight.id,
								insightType: insight.insight_type,
								title: insight.title,
								summary: insight.summary.slice(0, 300),
								entities: insight.entities,
							},
						});
					}
				}

				// Sort by score (highest first)
				allResults.sort((a, b) => b.score - a.score);
				const limitedResults = allResults.slice(0, limit * 2);

				const counts = {
					documents: allResults.filter((r) => r.type === 'document').length,
					memories: allResults.filter((r) => r.type === 'memory').length,
					conversations: allResults.filter((r) => r.type === 'conversation').length,
					insights: allResults.filter((r) => r.type === 'insight').length,
				};

				logger.info('ask completed', {
					totalResults: limitedResults.length,
					...counts,
				});

				const response = {
					question,
					totalResults: limitedResults.length,
					counts,
					results: limitedResults.map((r) => ({
						type: r.type,
						score: r.score,
						...r.data,
					})),
				};

				return {
					content: [
						{
							type: 'text' as const,
							text: JSON.stringify(response, null, 2),
						},
					],
				};
			} catch (error) {
				logger.error('ask failed', {
					error: error instanceof Error ? error.message : String(error),
				});
				return toolError(
					error instanceof Error ? error.message : 'Failed to search knowledge base',
				);
			}
		},
	);

	logger.debug('Registered tool: ask');
}
