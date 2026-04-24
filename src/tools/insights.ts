import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { z } from 'zod';
import {
	type InsightStatus,
	type InsightType,
	type ProactiveInsight,
	getInsights,
	searchInsights,
	shouldRunInsightScan,
	updateInsightStatus,
	validateInsightSchema,
} from '../db/insights.js';
import { isDatabaseConfigured } from '../db/pg-client.js';
import { generateEmbedding, isOpenAIConfigured } from '../services/embeddings.js';
import { runInsightScan } from '../services/insight-analysis.js';
import { configError, formatId, isCompact, toJSON, toolError } from '../utils/compact.js';
import { logger } from '../utils/logger.js';

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

			if (!isDatabaseConfigured()) {
				return configError('Database', 'Set DATABASE_URL');
			}

			const schema = await ensureSchema();
			if (!schema.ok) {
				return toolError(`Insight schema not initialized: ${schema.error}`);
			}

			try {
				let results: ProactiveInsight[];

				if (query) {
					// Semantic search over insights
					if (!isOpenAIConfigured()) {
						return configError('Embedding provider', 'Set OPENAI_API_KEY or configure Ollama');
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
										id: formatId(r.id),
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
				return toolError('get_insights', error);
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

			if (!isDatabaseConfigured()) {
				return configError('Database', 'Set DATABASE_URL');
			}

			const schema = await ensureSchema();
			if (!schema.ok) {
				return toolError(`Insight schema not initialized: ${schema.error}`);
			}

			if (!isOpenAIConfigured()) {
				return configError('Embedding provider', 'Set OPENAI_API_KEY or configure Ollama');
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
									batch: formatId(result.batchId),
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
				return toolError('discover_connections', error);
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

			if (!isDatabaseConfigured()) {
				return configError('Database', 'Set DATABASE_URL');
			}

			const schema = await ensureSchema();
			if (!schema.ok) {
				return toolError(`Insight schema not initialized: ${schema.error}`);
			}

			try {
				await updateInsightStatus(insightId, 'dismissed');
				return {
					content: [
						{
							type: 'text' as const,
							text: toJSON(
								isCompact() ? { ok: true } : { success: true, message: 'Insight dismissed' },
							),
						},
					],
				};
			} catch (error) {
				return toolError('dismiss_insight', error);
			}
		},
	);

	logger.debug('Registered tool: dismiss_insight');
}
