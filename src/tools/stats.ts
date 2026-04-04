import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { z } from 'zod';
import { getConversationSearchStats } from '../db/conversation-search.js';
import { getInsightStats, validateInsightSchema } from '../db/insights.js';
import { getMemoryStats } from '../db/memory-search.js';
import { isDatabaseConfigured } from '../db/pg-client.js';
import { getKnowledgeStats } from '../db/stats.js';
import {
	classifyError,
	configError,
	isCompact,
	toolError,
	toolResponse,
} from '../utils/compact.js';
import { config } from '../utils/config.js';
import { logger } from '../utils/logger.js';

// --- Output Schema ---

const ScopeErrorSchema = z.object({
	error: z.literal(true),
	message: z.string(),
	code: z.string(),
});

const KnowledgeSchema = z.object({
	total: z.number(),
	bySourceType: z.record(z.string(), z.number()),
	byContentType: z.record(z.string(), z.number()),
	topTags: z.array(z.object({ tag: z.string(), count: z.number() })),
	dateRange: z.object({
		oldest: z.string().nullable(),
		newest: z.string().nullable(),
	}),
});

const MemorySchema = z.object({
	totalEntities: z.number(),
	totalObservations: z.number(),
	totalRelations: z.number(),
	entityTypeCounts: z.record(z.string(), z.number()),
});

const ConversationsSchema = z.object({
	totalSessions: z.number(),
	sessionsWithSummary: z.number(),
	totalTurns: z.number(),
	turnsWithEmbedding: z.number(),
});

const InsightsSchema = z.object({
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
});

export const GetStatsOutputSchema = {
	knowledge: z.union([KnowledgeSchema, ScopeErrorSchema]).optional(),
	memory: z.union([MemorySchema, ScopeErrorSchema]).optional(),
	conversations: z.union([ConversationsSchema, ScopeErrorSchema]).optional(),
	insights: z.union([InsightsSchema, ScopeErrorSchema]).optional(),
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

function scopeError(message: string, error: unknown) {
	return {
		error: true as const,
		message,
		code: classifyError(error),
	};
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
				'Get statistics about the knowledge base, memory graph, conversations, and insights. Use scope to select which stats to return. Scoped queries require feature flags: memory (ENABLE_MEMORY), conversations (ENABLE_CONVERSATIONS), insights (ENABLE_INSIGHTS). scope="all" silently skips disabled features but returns per-scope errors for enabled features that fail.',
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
							return toolError('get_stats', err, { scope: 'knowledge' });
						}
						result.knowledge = scopeError(
							err instanceof Error ? err.message : 'Unknown error',
							err,
						);
					}
				}

				// Memory stats (feature-flagged)
				if (includeAll && config.ENABLE_MEMORY) {
					try {
						result.memory = await getMemoryStats();
					} catch (err) {
						logScopeError('memory', scope, err);
						result.memory = scopeError(err instanceof Error ? err.message : 'Unknown error', err);
					}
				} else if (scope === 'memory') {
					if (!config.ENABLE_MEMORY) {
						return toolError('Memory feature is disabled (ENABLE_MEMORY=false)');
					}
					try {
						result.memory = await getMemoryStats();
					} catch (err) {
						logScopeError('memory', scope, err);
						return toolError('get_stats', err, { scope: 'memory' });
					}
				}

				// Conversation stats (feature-flagged)
				if (includeAll && config.ENABLE_CONVERSATIONS) {
					try {
						result.conversations = await getConversationSearchStats();
					} catch (err) {
						logScopeError('conversations', scope, err);
						result.conversations = scopeError(
							err instanceof Error ? err.message : 'Unknown error',
							err,
						);
					}
				} else if (scope === 'conversations') {
					if (!config.ENABLE_CONVERSATIONS) {
						return toolError('Conversations feature is disabled (ENABLE_CONVERSATIONS=false)');
					}
					try {
						result.conversations = await getConversationSearchStats();
					} catch (err) {
						logScopeError('conversations', scope, err);
						return toolError('get_stats', err, { scope: 'conversations' });
					}
				}

				// Insight stats (feature-flagged + schema check)
				if (includeAll && config.ENABLE_INSIGHTS) {
					try {
						const schema = await ensureInsightSchema();
						if (schema.ok) {
							result.insights = await getInsightStats();
						} else {
							result.insights = {
								error: true,
								message: schema.error,
								code: 'SCHEMA_ERROR',
							};
						}
					} catch (err) {
						logScopeError('insights', scope, err);
						// Invalidate stale schema cache so next call re-checks
						insightSchemaCache = null;
						result.insights = scopeError(err instanceof Error ? err.message : 'Unknown error', err);
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
						logScopeError('insights', scope, err);
						insightSchemaCache = null;
						return toolError('get_stats', err, { scope: 'insights' });
					}
				}

				// Format response
				if (isCompact()) {
					const compact: Record<string, unknown> = {};

					if (result.knowledge) {
						compact.knowledge = result.knowledge;
					}

					if (result.memory) {
						if (typeof result.memory === 'object' && (result.memory as { error?: boolean }).error) {
							compact.memory = result.memory;
						} else {
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
					}

					if (result.conversations) {
						if (
							typeof result.conversations === 'object' &&
							(result.conversations as { error?: boolean }).error
						) {
							compact.conversations = result.conversations;
						} else {
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
					}

					if (result.insights) {
						if (
							typeof result.insights === 'object' &&
							(result.insights as { error?: boolean }).error
						) {
							compact.insights = result.insights;
						} else {
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
				return toolError('get_stats', error, { scope });
			}
		},
	);

	logger.debug('Registered tool: get_stats');
}
