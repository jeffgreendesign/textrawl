import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { z } from 'zod';
import { hybridConversationSearch } from '../db/conversation-search.js';
import { searchInsights } from '../db/insights.js';
import { hybridMemorySearch } from '../db/memory-search.js';
import { isDatabaseConfigured } from '../db/pg-client.js';
import { hybridSearch } from '../db/search.js';
import { resolveAccess } from '../services/access-policy.js';
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
					.enum(['auto', 'personal', 'family', 'documents', 'memory', 'conversations', 'insights'])
					.default('auto')
					.describe(
						'Which sources to search. "auto"/"personal" search all enabled sources; "family" limits to shared documents; or name a single source.',
					),
				audience: z
					.enum(['private_jeff', 'family_shared', 'public_safe'])
					.default('private_jeff')
					.describe(
						'Who the answer is for. "family_shared"/"public_safe" exclude private memory, conversations, and insights unless allow_cross_profile=true.',
					),
				allowCrossProfile: z
					.boolean()
					.default(false)
					.describe('Allow a family/public audience to read private sources. Use with care.'),
				limit: z.number().int().min(1).max(50).default(10).describe('Maximum results per source'),
			},
			annotations: {
				readOnlyHint: true,
				destructiveHint: false,
				idempotentHint: true,
				openWorldHint: false,
			},
		},
		async ({ question, scope, audience, allowCrossProfile, limit }) => {
			logger.info('ask called', { question: question.slice(0, 100), scope, audience, limit });

			if (!isDatabaseConfigured()) {
				return configError('Database', 'Set DATABASE_URL');
			}
			if (!isEmbeddingsConfigured()) {
				return configError('Embeddings', 'Configure an embedding provider');
			}

			// Central privacy/audience enforcement — decides which sources are readable.
			const access = resolveAccess({ scope, audience, allowCrossProfile });

			try {
				const queryEmbedding = await generateEmbedding(question);

				const allResults: Array<{
					type: 'document' | 'memory' | 'conversation' | 'insight';
					score: number;
					data: Record<string, unknown>;
				}> = [];

				// Documents
				if (access.sources.includes('documents')) {
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
				if (access.sources.includes('memory') && config.ENABLE_MEMORY) {
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
				if (access.sources.includes('conversations') && config.ENABLE_CONVERSATIONS) {
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
				if (access.sources.includes('insights') && config.ENABLE_INSIGHTS) {
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
					sensitivity: access.sensitivity,
					...(access.warnings.length > 0 ? { warnings: access.warnings } : {}),
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
				return toolError('ask', error);
			}
		},
	);

	logger.debug('Registered tool: ask');
}
