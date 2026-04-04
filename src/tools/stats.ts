import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { z } from 'zod';
import { getConversationSearchStats } from '../db/conversation-search.js';
import { getInsightStats, validateInsightSchema } from '../db/insights.js';
import { getMemoryStats } from '../db/memory-search.js';
import { isDatabaseConfigured } from '../db/pg-client.js';
import { getKnowledgeStats } from '../db/stats.js';
import { configError, isCompact, toolError, toolResponse } from '../utils/compact.js';
import { config } from '../utils/config.js';
import { logger } from '../utils/logger.js';

// --- Output Schema ---

const GetStatsOutputSchema = {
	knowledge: z
		.object({
			total: z.number(),
			bySourceType: z.record(z.string(), z.number()),
			byContentType: z.record(z.string(), z.number()),
			topTags: z.array(z.object({ tag: z.string(), count: z.number() })),
			dateRange: z.object({
				oldest: z.string().nullable(),
				newest: z.string().nullable(),
			}),
		})
		.optional(),
	memory: z
		.object({
			totalEntities: z.number(),
			totalObservations: z.number(),
			totalRelations: z.number(),
			entityTypeCounts: z.record(z.string(), z.number()),
		})
		.optional(),
	conversations: z
		.object({
			totalSessions: z.number(),
			sessionsWithSummary: z.number(),
			totalTurns: z.number(),
			turnsWithEmbedding: z.number(),
		})
		.optional(),
	insights: z
		.object({
			total: z.number(),
			new: z.number(),
			seen: z.number(),
			dismissed: z.number(),
			byType: z.record(z.string(), z.number()),
			queueState: z
				.object({
					chunks_pending: z.number(),
					is_processing: z.boolean(),
					last_insert_at: z.string().nullable(),
					last_scan_at: z.string().nullable(),
				})
				.nullable(),
		})
		.optional(),
};

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
	/** Log a per-scope error with message and stack trace. */
	function logScopeError(scopeName: string, scope: string, err: unknown): void {
		logger.error(`get_stats: ${scopeName} scope failed`, {
			scope,
			error: err instanceof Error ? err.message : String(err),
			stack: err instanceof Error ? err.stack : undefined,
		});
	}

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
			outputSchema: GetStatsOutputSchema,
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

			if (!isDatabaseConfigured()) {
				return configError('Database', 'Set DATABASE_URL');
			}

			try {
				const result: Record<string, unknown> = {};
				const includeAll = scope === 'all';

				// Knowledge stats (always available)
				if (includeAll || scope === 'knowledge') {
					try {
						result.knowledge = await getKnowledgeStats();
					} catch (err) {
						logScopeError('knowledge', scope, err);
						if (!includeAll) {
							return toolError(
								`Knowledge stats failed: ${err instanceof Error ? err.message : 'Unknown error'}`,
							);
						}
					}
				}

				// Memory stats (feature-flagged)
				if (includeAll && config.ENABLE_MEMORY) {
					try {
						result.memory = await getMemoryStats();
					} catch (err) {
						logScopeError('memory', scope, err);
					}
				} else if (scope === 'memory') {
					if (!config.ENABLE_MEMORY) {
						return toolError('Memory feature is disabled (ENABLE_MEMORY=false)');
					}
					try {
						result.memory = await getMemoryStats();
					} catch (err) {
						logScopeError('memory', scope, err);
						return toolError(
							`Memory stats failed: ${err instanceof Error ? err.message : 'Unknown error'}`,
						);
					}
				}

				// Conversation stats (feature-flagged)
				if (includeAll && config.ENABLE_CONVERSATIONS) {
					try {
						result.conversations = await getConversationSearchStats();
					} catch (err) {
						logScopeError('conversations', scope, err);
					}
				} else if (scope === 'conversations') {
					if (!config.ENABLE_CONVERSATIONS) {
						return toolError('Conversations feature is disabled (ENABLE_CONVERSATIONS=false)');
					}
					try {
						result.conversations = await getConversationSearchStats();
					} catch (err) {
						logScopeError('conversations', scope, err);
						return toolError(
							`Conversation stats failed: ${err instanceof Error ? err.message : 'Unknown error'}`,
						);
					}
				}

				// Insight stats (feature-flagged + schema check)
				if (includeAll && config.ENABLE_INSIGHTS) {
					try {
						const schema = await ensureInsightSchema();
						if (schema.ok) {
							result.insights = await getInsightStats();
						}
						// Silently skip if schema not ready in 'all' mode
					} catch (err) {
						// Log to stderr so the actual error is visible in server logs
						console.error('[get_stats] insights scope error (all):', err);
						logScopeError('insights', scope, err);
						// Invalidate stale schema cache so next call re-checks
						insightSchemaCache = null;
					}
				} else if (scope === 'insights') {
					if (!config.ENABLE_INSIGHTS) {
						return toolError('Insights feature is disabled (ENABLE_INSIGHTS=false)');
					}
					const schema = await ensureInsightSchema();
					if (!schema.ok) {
						return toolError(`Insight schema not initialized: ${schema.error}`);
					}
					try {
						result.insights = await getInsightStats();
					} catch (err) {
						// Log to stderr so the actual error is visible in server logs
						console.error('[get_stats] insights scope error:', err);
						logScopeError('insights', scope, err);
						insightSchemaCache = null;
						return toolError(
							`Insight stats failed: ${err instanceof Error ? err.message : 'Unknown error'}`,
						);
					}
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
								last_insert_at: string | null;
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
										lastIns: ins.queueState.last_insert_at,
										last: ins.queueState.last_scan_at,
									}
								: null,
						};
					}

					return toolResponse({
						compact,
						verbose: result,
						structuredContent: result,
					});
				}

				return toolResponse({
					compact: result,
					verbose: result,
					structuredContent: result,
				});
			} catch (error) {
				// Log to stderr so the actual error is visible even if MCP swallows it
				console.error(`[get_stats] unhandled error (scope=${scope}):`, error);
				logger.error('get_stats failed', {
					scope,
					error: error instanceof Error ? error.message : String(error),
					stack: error instanceof Error ? error.stack : undefined,
				});

				return toolError(
					`Failed to get stats (scope=${scope}): ${error instanceof Error ? error.message : 'Unknown error'}`,
				);
			}
		},
	);

	logger.debug('Registered tool: get_stats');
}
