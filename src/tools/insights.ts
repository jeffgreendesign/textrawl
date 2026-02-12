import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { z } from 'zod';
import { isSupabaseConfigured } from '../db/client.js';
import {
	type InsightStatus,
	type InsightType,
	type ProactiveInsight,
	getInsightStats,
	getInsights,
	searchInsights,
	shouldRunInsightScan,
	updateInsightStatus,
	validateInsightSchema,
} from '../db/insights.js';
import { generateEmbedding, isOpenAIConfigured } from '../services/embeddings.js';
import { runInsightScan } from '../services/insight-analysis.js';
import { config } from '../utils/config.js';
import { logger } from '../utils/logger.js';

const isCompact = () => config.COMPACT_RESPONSES;

/**
 * Register proactive insight tools
 */
export function registerInsightTools(server: McpServer): void {
	/** Run schema validation on first call, cache the result for 60s */
	let schemaCheckCache: { valid: boolean; hint: string; checkedAt: number } | null = null;
	const SCHEMA_CACHE_TTL = 60_000;

	async function ensureSchema(): Promise<{ ok: true } | { ok: false; error: string }> {
		const now = Date.now();
		if (schemaCheckCache && now - schemaCheckCache.checkedAt < SCHEMA_CACHE_TTL) {
			if (schemaCheckCache.valid) return { ok: true };
			return { ok: false, error: schemaCheckCache.hint };
		}

		const result = await validateInsightSchema();
		schemaCheckCache = { valid: result.valid, hint: result.hint, checkedAt: now };
		if (!result.valid) {
			logger.error('Insight schema validation failed', {
				missing: result.missing,
				hint: result.hint,
			});
			return { ok: false, error: result.hint };
		}
		return { ok: true };
	}

	// ========================================================================
	// Tool: get_insights
	// ========================================================================
	server.registerTool(
		'get_insights',
		{
			title: 'Get Insights',
			description:
				"Get proactive insights discovered from your knowledge base. Shows cross-source connections, recurring themes, entity bridges, and outliers that were automatically found. Use this to discover things you didn't know to ask about.",
			annotations: {
				readOnlyHint: false,
				destructiveHint: false,
				openWorldHint: false,
			},
			inputSchema: {
				status: z
					.enum(['new', 'seen', 'dismissed'])
					.optional()
					.describe('Filter by status (default: show "new" insights)'),
				insightType: z
					.enum(['cross_source', 'theme_cluster', 'entity_bridge', 'temporal_pattern', 'outlier'])
					.optional()
					.describe('Filter by insight type'),
				query: z.string().optional().describe('Semantic search query to find relevant insights'),
				limit: z.number().int().min(1).max(50).default(5).describe('Maximum insights to return'),
			},
		},
		async ({ status, insightType, query, limit }) => {
			logger.info('get_insights called', { status, insightType, query, limit });

			if (!isSupabaseConfigured()) {
				return {
					content: [
						{
							type: 'text' as const,
							text: JSON.stringify({ error: 'Database not configured' }),
						},
					],
				};
			}

			const schema = await ensureSchema();
			if (!schema.ok) {
				return {
					content: [
						{
							type: 'text' as const,
							text: JSON.stringify({
								error: 'Insight schema not initialized',
								message: schema.error,
							}),
						},
					],
				};
			}

			try {
				let results: ProactiveInsight[];

				if (query) {
					// Semantic search over insights
					if (!isOpenAIConfigured()) {
						return {
							content: [
								{
									type: 'text' as const,
									text: JSON.stringify({ error: 'Embeddings not configured for semantic search' }),
								},
							],
						};
					}
					const queryEmbedding = await generateEmbedding(query);
					results = await searchInsights(queryEmbedding, {
						limit,
						status: status as InsightStatus | undefined,
					});
				} else {
					results = await getInsights({
						status: (status ?? 'new') as InsightStatus,
						insightType: insightType as InsightType | undefined,
						limit,
					});
				}

				// Mark retrieved "new" insights as "seen"
				const newInsights = results.filter((r) => r.status === 'new');
				for (const insight of newInsights) {
					await updateInsightStatus(insight.id, 'seen');
				}

				if (isCompact()) {
					return {
						content: [
							{
								type: 'text' as const,
								text: JSON.stringify({
									n: results.length,
									new: newInsights.length,
									insights: results.map((r) => ({
										id: r.id.slice(0, 8),
										t: r.insight_type,
										title: r.title,
										sum: r.summary,
										ev: r.evidence.length,
										ent: r.entities,
										s: r.status,
										at: r.created_at,
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
									totalInsights: results.length,
									newInsightsMarkedSeen: newInsights.length,
									insights: results.map((r) => ({
										id: r.id,
										type: r.insight_type,
										title: r.title,
										summary: r.summary,
										evidenceCount: r.evidence.length,
										evidence: r.evidence,
										entities: r.entities,
										status: r.status,
										createdAt: r.created_at,
									})),
								},
								null,
								2,
							),
						},
					],
				};
			} catch (error) {
				logger.error('get_insights failed', {
					error: error instanceof Error ? error.message : String(error),
				});
				return {
					content: [
						{
							type: 'text' as const,
							text: JSON.stringify({
								error: 'Failed to get insights',
								message: error instanceof Error ? error.message : 'Unknown error',
							}),
						},
					],
					isError: true,
				};
			}
		},
	);

	logger.debug('Registered tool: get_insights');

	// ========================================================================
	// Tool: discover_connections
	// ========================================================================
	server.registerTool(
		'discover_connections',
		{
			title: 'Discover Connections',
			description:
				"Trigger an insight scan to discover connections, patterns, and outliers in your knowledge base. Use after bulk imports (email, Facebook, Google Takeout) to find what's interesting. The scan compares recent content against everything in the database.",
			annotations: {
				readOnlyHint: false,
				destructiveHint: false,
				openWorldHint: false,
			},
			inputSchema: {
				fullScan: z
					.boolean()
					.default(false)
					.describe('Scan all content (not just recent). Use sparingly on large databases.'),
				maxChunks: z
					.number()
					.int()
					.min(10)
					.max(1000)
					.default(200)
					.describe('Maximum chunks to analyze in this scan'),
			},
		},
		async ({ fullScan, maxChunks }) => {
			logger.info('discover_connections called', { fullScan, maxChunks });

			if (!isSupabaseConfigured()) {
				return {
					content: [
						{
							type: 'text' as const,
							text: JSON.stringify({ error: 'Database not configured' }),
						},
					],
				};
			}

			const schema = await ensureSchema();
			if (!schema.ok) {
				return {
					content: [
						{
							type: 'text' as const,
							text: JSON.stringify({
								error: 'Insight schema not initialized',
								message: schema.error,
							}),
						},
					],
				};
			}

			if (!isOpenAIConfigured()) {
				return {
					content: [
						{
							type: 'text' as const,
							text: JSON.stringify({ error: 'Embeddings not configured' }),
						},
					],
				};
			}

			try {
				const result = await runInsightScan({ fullScan, maxChunks });

				if (isCompact()) {
					return {
						content: [
							{
								type: 'text' as const,
								text: JSON.stringify({
									ok: true,
									chunks: result.chunksAnalyzed,
									found: result.insightsCreated,
									batch: result.batchId.slice(0, 8),
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
									success: true,
									chunksAnalyzed: result.chunksAnalyzed,
									insightsCreated: result.insightsCreated,
									batchId: result.batchId,
									message:
										result.insightsCreated > 0
											? `Found ${result.insightsCreated} insight(s). Use get_insights to view them.`
											: 'No new insights found in this scan.',
								},
								null,
								2,
							),
						},
					],
				};
			} catch (error) {
				logger.error('discover_connections failed', {
					error: error instanceof Error ? error.message : String(error),
				});
				return {
					content: [
						{
							type: 'text' as const,
							text: JSON.stringify({
								error: 'Insight scan failed',
								message: error instanceof Error ? error.message : 'Unknown error',
							}),
						},
					],
					isError: true,
				};
			}
		},
	);

	logger.debug('Registered tool: discover_connections');

	// ========================================================================
	// Tool: dismiss_insight
	// ========================================================================
	server.registerTool(
		'dismiss_insight',
		{
			title: 'Dismiss Insight',
			description: 'Dismiss an insight so it no longer appears in new/seen results',
			annotations: {
				readOnlyHint: false,
				destructiveHint: false,
				idempotentHint: true,
				openWorldHint: false,
			},
			inputSchema: {
				insightId: z.string().describe('The insight ID to dismiss'),
			},
		},
		async ({ insightId }) => {
			logger.info('dismiss_insight called', { insightId });

			if (!isSupabaseConfigured()) {
				return {
					content: [
						{
							type: 'text' as const,
							text: JSON.stringify({ error: 'Database not configured' }),
						},
					],
				};
			}

			const schema = await ensureSchema();
			if (!schema.ok) {
				return {
					content: [
						{
							type: 'text' as const,
							text: JSON.stringify({
								error: 'Insight schema not initialized',
								message: schema.error,
							}),
						},
					],
				};
			}

			try {
				await updateInsightStatus(insightId, 'dismissed');
				return {
					content: [
						{
							type: 'text' as const,
							text: JSON.stringify(
								isCompact() ? { ok: true } : { success: true, message: 'Insight dismissed' },
							),
						},
					],
				};
			} catch (error) {
				return {
					content: [
						{
							type: 'text' as const,
							text: JSON.stringify({
								error: 'Failed to dismiss insight',
								message: error instanceof Error ? error.message : 'Unknown error',
							}),
						},
					],
					isError: true,
				};
			}
		},
	);

	logger.debug('Registered tool: dismiss_insight');

	// ========================================================================
	// Tool: insight_stats
	// ========================================================================
	server.registerTool(
		'insight_stats',
		{
			title: 'Insight Stats',
			description:
				'Get statistics about proactive insights and the insight queue (pending chunks, processing state)',
			annotations: {
				readOnlyHint: true,
				destructiveHint: false,
				openWorldHint: false,
			},
			inputSchema: {},
		},
		async () => {
			logger.info('insight_stats called');

			if (!isSupabaseConfigured()) {
				return {
					content: [
						{
							type: 'text' as const,
							text: JSON.stringify({ error: 'Database not configured' }),
						},
					],
				};
			}

			const schema = await ensureSchema();
			if (!schema.ok) {
				return {
					content: [
						{
							type: 'text' as const,
							text: JSON.stringify({
								error: 'Insight schema not initialized',
								message: schema.error,
							}),
						},
					],
				};
			}

			try {
				const stats = await getInsightStats();

				if (isCompact()) {
					return {
						content: [
							{
								type: 'text' as const,
								text: JSON.stringify({
									n: stats.total,
									new: stats.new,
									seen: stats.seen,
									dis: stats.dismissed,
									types: stats.byType,
									q: stats.queueState
										? {
												p: stats.queueState.chunks_pending,
												proc: stats.queueState.is_processing,
												last: stats.queueState.last_scan_at,
											}
										: null,
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
									totalInsights: stats.total,
									new: stats.new,
									seen: stats.seen,
									dismissed: stats.dismissed,
									byType: stats.byType,
									queue: stats.queueState
										? {
												chunksPending: stats.queueState.chunks_pending,
												isProcessing: stats.queueState.is_processing,
												lastScanAt: stats.queueState.last_scan_at,
												lastInsertAt: stats.queueState.last_insert_at,
											}
										: null,
								},
								null,
								2,
							),
						},
					],
				};
			} catch (error) {
				return {
					content: [
						{
							type: 'text' as const,
							text: JSON.stringify({
								error: 'Failed to get insight stats',
								message: error instanceof Error ? error.message : 'Unknown error',
							}),
						},
					],
					isError: true,
				};
			}
		},
	);

	logger.debug('Registered tool: insight_stats');
}
