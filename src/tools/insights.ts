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
	// ========================================================================
	// Tool: get_insights
	// ========================================================================
	server.registerTool(
		'get_insights',
		{
			description:
				"Get proactive insights discovered from your knowledge base. Shows cross-source connections, recurring themes, entity bridges, and outliers that were automatically found. Use this to discover things you didn't know to ask about.",
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
			description:
				"Trigger an insight scan to discover connections, patterns, and outliers in your knowledge base. Use after bulk imports (email, Facebook, Google Takeout) to find what's interesting. The scan compares recent content against everything in the database.",
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
			description: 'Dismiss an insight so it no longer appears in new/seen results',
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
			description:
				'Get statistics about proactive insights and the insight queue (pending chunks, processing state)',
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
				};
			}
		},
	);

	logger.debug('Registered tool: insight_stats');
}
