import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { z } from 'zod';
import { isSupabaseConfigured } from '../db/client.js';
import { getConversationSearchStats } from '../db/conversation-search.js';
import { getInsightStats, validateInsightSchema } from '../db/insights.js';
import { getMemoryStats } from '../db/memory-search.js';
import { getKnowledgeStats } from '../db/stats.js';
import { configError, isCompact, toJSON, toolError } from '../utils/compact.js';
import { config } from '../utils/config.js';
import { logger } from '../utils/logger.js';

/** Cache insight schema validation for 60s */
let insightSchemaCache: { valid: boolean; hint: string; checkedAt: number } | null = null;
const SCHEMA_CACHE_TTL = 60_000;

async function ensureInsightSchema(): Promise<{ ok: true } | { ok: false; error: string }> {
	const now = Date.now();
	if (insightSchemaCache && now - insightSchemaCache.checkedAt < SCHEMA_CACHE_TTL) {
		if (insightSchemaCache.valid) return { ok: true };
		return { ok: false, error: insightSchemaCache.hint };
	}
	const result = await validateInsightSchema();
	insightSchemaCache = { valid: result.valid, hint: result.hint, checkedAt: now };
	if (!result.valid) {
		return { ok: false, error: result.hint };
	}
	return { ok: true };
}

/**
 * Register the get_stats tool
 *
 * Consolidated stats tool replacing knowledge_stats, memory_stats,
 * conversation_stats, and insight_stats.
 */
export function registerStatsTools(server: McpServer): void {
	server.registerTool(
		'get_stats',
		{
			title: 'Get Stats',
			description:
				'Get statistics about the knowledge base, memory graph, conversations, and insights. Use scope to select which stats to return. Scoped queries require feature flags: memory (ENABLE_MEMORY), conversations (ENABLE_CONVERSATIONS), insights (ENABLE_INSIGHTS). scope="all" silently skips disabled features.',
			inputSchema: {
				scope: z
					.enum(['all', 'knowledge', 'memory', 'conversations', 'insights'])
					.default('all')
					.describe(
						'Which stats to return. "all" returns every enabled scope. Individual scopes: knowledge, memory, conversations, insights.',
					),
			},
			annotations: {
				readOnlyHint: true,
				destructiveHint: false,
				openWorldHint: false,
			},
			_meta: {
				ui: {
					resourceUri: 'ui://textrawl/knowledge-stats',
				},
			},
		},
		async ({ scope }) => {
			logger.info('get_stats called', { scope });

			if (!isSupabaseConfigured()) {
				return configError('Database', 'Set SUPABASE_URL and SUPABASE_SERVICE_KEY');
			}

			try {
				const result: Record<string, unknown> = {};
				const includeAll = scope === 'all';

				// Knowledge stats (always available)
				if (includeAll || scope === 'knowledge') {
					result.knowledge = await getKnowledgeStats();
				}

				// Memory stats (feature-flagged)
				if (includeAll && config.ENABLE_MEMORY) {
					result.memory = await getMemoryStats();
				} else if (scope === 'memory') {
					if (!config.ENABLE_MEMORY) {
						return toolError('Memory feature is disabled (ENABLE_MEMORY=false)');
					}
					result.memory = await getMemoryStats();
				}

				// Conversation stats (feature-flagged)
				if (includeAll && config.ENABLE_CONVERSATIONS) {
					result.conversations = await getConversationSearchStats();
				} else if (scope === 'conversations') {
					if (!config.ENABLE_CONVERSATIONS) {
						return toolError('Conversations feature is disabled (ENABLE_CONVERSATIONS=false)');
					}
					result.conversations = await getConversationSearchStats();
				}

				// Insight stats (feature-flagged + schema check)
				if (includeAll && config.ENABLE_INSIGHTS) {
					const schema = await ensureInsightSchema();
					if (schema.ok) {
						result.insights = await getInsightStats();
					}
					// Silently skip if schema not ready in 'all' mode
				} else if (scope === 'insights') {
					if (!config.ENABLE_INSIGHTS) {
						return toolError('Insights feature is disabled (ENABLE_INSIGHTS=false)');
					}
					const schema = await ensureInsightSchema();
					if (!schema.ok) {
						return toolError(`Insight schema not initialized: ${schema.error}`);
					}
					result.insights = await getInsightStats();
				}

				// Format response
				if (isCompact()) {
					const compact: Record<string, unknown> = {};

					if (result.knowledge) {
						compact.knowledge = result.knowledge;
					}

					if (result.memory) {
						const mem = result.memory as {
							totalEntities: number;
							totalObservations: number;
							totalRelations: number;
							entityTypeCounts: Record<string, number>;
						};
						compact.memory = {
							ent: mem.totalEntities,
							obs: mem.totalObservations,
							rel: mem.totalRelations,
							byType: mem.entityTypeCounts,
						};
					}

					if (result.conversations) {
						const conv = result.conversations as {
							totalSessions: number;
							sessionsWithSummary: number;
							totalTurns: number;
							turnsWithEmbedding: number;
						};
						compact.conversations = {
							sess: conv.totalSessions,
							indexed: conv.sessionsWithSummary,
							turns: conv.totalTurns,
							turnIdx: conv.turnsWithEmbedding,
						};
					}

					if (result.insights) {
						const ins = result.insights as {
							total: number;
							new: number;
							seen: number;
							dismissed: number;
							byType: Record<string, number>;
							queueState: {
								chunks_pending: number;
								is_processing: boolean;
								last_scan_at: string | null;
							} | null;
						};
						compact.insights = {
							n: ins.total,
							new: ins.new,
							seen: ins.seen,
							dis: ins.dismissed,
							types: ins.byType,
							q: ins.queueState
								? {
										p: ins.queueState.chunks_pending,
										proc: ins.queueState.is_processing,
										last: ins.queueState.last_scan_at,
									}
								: null,
						};
					}

					return {
						content: [
							{
								type: 'text' as const,
								text: JSON.stringify(compact),
							},
						],
					};
				}

				return {
					content: [
						{
							type: 'text' as const,
							text: toJSON(result),
						},
					],
				};
			} catch (error) {
				logger.error('get_stats failed', {
					error: error instanceof Error ? error.message : String(error),
				});

				return toolError(
					`Failed to get stats: ${error instanceof Error ? error.message : 'Unknown error'}`,
				);
			}
		},
	);

	logger.debug('Registered tool: get_stats');
}
