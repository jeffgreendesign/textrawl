import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { z } from 'zod';
import { isSupabaseConfigured } from '../db/client.js';
import { listDocuments } from '../db/documents.js';
import { getInsights } from '../db/insights.js';
import { configError, toolError } from '../utils/compact.js';
import { config } from '../utils/config.js';
import { logger } from '../utils/logger.js';

/**
 * Register the daily_briefing tool — proactive knowledge surfacing.
 */
export function registerBriefingTool(server: McpServer): void {
	server.registerTool(
		'daily_briefing',
		{
			title: 'Daily Briefing',
			description:
				'Get a personalized briefing of your knowledge base: recent additions, new insights, and "on this day" resurfacing of older content.',
			inputSchema: {
				includeOnThisDay: z
					.boolean()
					.default(true)
					.describe('Include documents from this date in previous years'),
				recentDays: z
					.number()
					.int()
					.min(1)
					.max(30)
					.default(7)
					.describe('Number of days to look back for recent additions'),
			},
			annotations: {
				readOnlyHint: true,
				destructiveHint: false,
				idempotentHint: true,
			},
		},
		async ({ includeOnThisDay, recentDays }) => {
			logger.info('daily_briefing called', { includeOnThisDay, recentDays });

			if (!isSupabaseConfigured()) {
				return configError('Database', 'Set SUPABASE_URL and SUPABASE_SERVICE_KEY');
			}

			try {
				const briefing: Record<string, unknown> = {};

				// Recent additions
				const recentDocs = await listDocuments({
					limit: 10,
					offset: 0,
				});
				const cutoff = new Date();
				cutoff.setDate(cutoff.getDate() - recentDays);
				const recent = recentDocs.documents.filter((d) => new Date(d.created_at) >= cutoff);
				briefing.recentAdditions = {
					count: recent.length,
					documents: recent.map((d) => ({
						id: d.id,
						title: d.title,
						sourceType: d.source_type,
						createdAt: d.created_at,
					})),
				};

				// New insights
				if (config.ENABLE_INSIGHTS) {
					const newInsights = await getInsights({
						status: 'new',
						limit: 5,
					});
					briefing.newInsights = {
						count: newInsights.length,
						insights: newInsights.map((i) => ({
							id: i.id,
							type: i.insight_type,
							title: i.title,
							summary: i.summary.slice(0, 200),
						})),
					};
				}

				// "On this day" — resurface content from same date in past years
				if (includeOnThisDay) {
					const allDocs = await listDocuments({ limit: 100, offset: 0 });
					const today = new Date();
					const onThisDay = allDocs.documents.filter((d) => {
						const created = new Date(d.created_at);
						return (
							created.getMonth() === today.getMonth() &&
							created.getDate() === today.getDate() &&
							created.getFullYear() < today.getFullYear()
						);
					});

					briefing.onThisDay = {
						count: onThisDay.length,
						documents: onThisDay.slice(0, 5).map((d) => ({
							id: d.id,
							title: d.title,
							sourceType: d.source_type,
							createdAt: d.created_at,
							yearsAgo: today.getFullYear() - new Date(d.created_at).getFullYear(),
						})),
					};
				}

				// Summary stats
				briefing.generatedAt = new Date().toISOString();

				logger.info('daily_briefing completed', {
					recentCount: (briefing.recentAdditions as { count: number }).count,
				});

				return {
					content: [
						{
							type: 'text' as const,
							text: JSON.stringify(briefing, null, 2),
						},
					],
				};
			} catch (error) {
				logger.error('daily_briefing failed', {
					error: error instanceof Error ? error.message : String(error),
				});
				return toolError(error instanceof Error ? error.message : 'Failed to generate briefing');
			}
		},
	);

	logger.debug('Registered tool: daily_briefing');
}
