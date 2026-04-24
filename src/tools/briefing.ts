import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { z } from 'zod';
import { listDocuments } from '../db/documents.js';
import { getInsights } from '../db/insights.js';
import { isDatabaseConfigured } from '../db/pg-client.js';
import { classifyError, configError, toolError, toolResponse } from '../utils/compact.js';
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
				'Get a personalized briefing of your knowledge base: recent additions, new insights, and "on this day" resurfacing of older content. Each section is fetched independently — a failure in one section returns an error object for that section without blocking others.',
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

			if (!isDatabaseConfigured()) {
				return configError('Database', 'Set DATABASE_URL');
			}

			try {
				const briefing: Record<string, unknown> = {};

				// Section 1: Recent additions
				try {
					const recentDocs = await listDocuments({
						limit: 50,
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
				} catch (err) {
					logger.error('daily_briefing: recentAdditions failed', {
						error: err instanceof Error ? err.message : String(err),
					});
					briefing.recentAdditions = {
						error: true,
						message: err instanceof Error ? err.message : 'Unknown error',
						code: classifyError(err),
					};
				}

				// Section 2: New insights
				try {
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
				} catch (err) {
					logger.error('daily_briefing: newInsights failed', {
						error: err instanceof Error ? err.message : String(err),
					});
					briefing.newInsights = {
						error: true,
						message: err instanceof Error ? err.message : 'Unknown error',
						code: classifyError(err),
					};
				}

				// Section 3: "On this day" — resurface content from same date in past years
				try {
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
				} catch (err) {
					logger.error('daily_briefing: onThisDay failed', {
						error: err instanceof Error ? err.message : String(err),
					});
					briefing.onThisDay = {
						error: true,
						message: err instanceof Error ? err.message : 'Unknown error',
						code: classifyError(err),
					};
				}

				// Summary stats
				briefing.generatedAt = new Date().toISOString();

				logger.info('daily_briefing completed', {
					recentCount:
						briefing.recentAdditions &&
						typeof briefing.recentAdditions === 'object' &&
						'count' in (briefing.recentAdditions as object)
							? (briefing.recentAdditions as { count: number }).count
							: 'error',
				});

				return toolResponse({
					compact: briefing,
					verbose: briefing,
				});
			} catch (error) {
				return toolError('daily_briefing', error);
			}
		},
	);

	logger.debug('Registered tool: daily_briefing');
}
