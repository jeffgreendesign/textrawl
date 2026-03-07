import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { z } from 'zod';
import { isPgConfigured } from '../db/pg-client.js';
import { formatCompact, formatMarkdown } from '../services/pg-analyze/formatter.js';
import {
	compareReports,
	formatDiff,
	getHistory,
	saveReport,
} from '../services/pg-analyze/history.js';
import { runAnalysis } from '../services/pg-analyze/index.js';
import { configError, toolError, toolResponse } from '../utils/compact.js';
import { config } from '../utils/config.js';
import { logger } from '../utils/logger.js';

// --- Output Schemas ---

const PgAnalyzeOutputSchema = {
	timestamp: z.string(),
	databaseVersion: z.string(),
	databaseSize: z.string(),
	tableCount: z.number(),
	indexCount: z.number(),
	recommendationCount: z.number(),
	tables: z.array(
		z.object({
			schema: z.string(),
			table: z.string(),
			rowEstimate: z.number(),
			totalSize: z.string(),
			deadTuples: z.number(),
		}),
	),
	recommendations: z.array(
		z.object({
			severity: z.enum(['info', 'warning', 'critical']),
			category: z.string(),
			title: z.string(),
			suggestion: z.string(),
		}),
	),
};

const PgRecommendationsOutputSchema = {
	total: z.number(),
	recommendations: z.array(
		z.object({
			severity: z.enum(['info', 'warning', 'critical']),
			category: z.string(),
			title: z.string(),
			description: z.string(),
			suggestion: z.string(),
			reference: z.string().optional(),
		}),
	),
};

const PgReportHistoryOutputSchema = {
	total: z.number(),
	reports: z.array(
		z.object({
			timestamp: z.string(),
			databaseSize: z.string(),
			tables: z.number(),
			critical: z.number(),
			warnings: z.number(),
		}),
	),
	diff: z
		.object({
			tableChanges: z.array(
				z.object({
					table: z.string(),
					rowDelta: z.number(),
					deadTupleDelta: z.number(),
					sizeChange: z.string(),
				}),
			),
			newRecommendations: z.array(z.string()),
			resolvedRecommendations: z.array(z.string()),
			connectionDelta: z.number(),
		})
		.nullable(),
	diffFormatted: z.string().nullable(),
};

export function registerPgAnalyzeTools(server: McpServer): void {
	// pg_analyze — full analysis
	server.registerTool(
		'pg_analyze',
		{
			title: 'Analyze Postgres',
			description:
				'Run a comprehensive Postgres health analysis. Returns table stats, index health, vacuum status, connection info, bloat estimates, Textrawl-specific checks, and actionable recommendations. Optionally saves the report for trend tracking.',
			inputSchema: {
				save: z.boolean().default(false).describe('Save report to history for future comparison'),
			},
			outputSchema: PgAnalyzeOutputSchema,
			annotations: {
				readOnlyHint: true,
				destructiveHint: false,
				openWorldHint: false,
			},
		},
		async ({ save }) => {
			logger.info('pg_analyze called', { save });

			if (!isPgConfigured()) {
				return configError('DATABASE_URL', 'Set DATABASE_URL for direct Postgres analysis');
			}

			try {
				const report = await runAnalysis();

				if (save) {
					const path = saveReport(report, config.PG_REPORT_DIR);
					logger.info('Report saved', { path });
				}

				const structuredContent = {
					timestamp: report.timestamp,
					databaseVersion: report.databaseVersion,
					databaseSize: report.databaseSize,
					tableCount: report.tables.length,
					indexCount: report.indexes.length,
					recommendationCount: report.recommendations.length,
					tables: report.tables.map((t) => ({
						schema: t.schema,
						table: t.table,
						rowEstimate: t.rowEstimate,
						totalSize: t.totalSize,
						deadTuples: t.deadTuples,
					})),
					recommendations: report.recommendations.map((r) => ({
						severity: r.severity,
						category: r.category,
						title: r.title,
						suggestion: r.suggestion,
					})),
				};

				return toolResponse({
					compact: formatCompact(report),
					verbose: report,
					structuredContent,
				});
			} catch (error) {
				logger.error('pg_analyze failed', {
					error: error instanceof Error ? error.message : String(error),
				});
				return toolError(
					`Analysis failed: ${error instanceof Error ? error.message : 'Unknown error'}`,
				);
			}
		},
	);

	// pg_recommendations — just the recommendations
	server.registerTool(
		'pg_recommendations',
		{
			title: 'Postgres Recommendations',
			description:
				'Get actionable optimization recommendations for Postgres. Runs analysis and returns only the categorized recommendations with severity, descriptions, and suggested SQL fixes.',
			inputSchema: {
				severity: z
					.enum(['all', 'critical', 'warning', 'info'])
					.default('all')
					.describe('Filter recommendations by minimum severity'),
			},
			outputSchema: PgRecommendationsOutputSchema,
			annotations: {
				readOnlyHint: true,
				destructiveHint: false,
				openWorldHint: false,
			},
		},
		async ({ severity }) => {
			logger.info('pg_recommendations called', { severity });

			if (!isPgConfigured()) {
				return configError('DATABASE_URL', 'Set DATABASE_URL for direct Postgres analysis');
			}

			try {
				const report = await runAnalysis();
				let recs = report.recommendations;

				if (severity !== 'all') {
					const order = { critical: 0, warning: 1, info: 2 };
					const minLevel = order[severity];
					recs = recs.filter((r) => order[r.severity] <= minLevel);
				}

				const verboseRecs = {
					total: recs.length,
					recommendations: recs,
				};

				return toolResponse({
					compact: {
						n: recs.length,
						recs: recs.map((r) => ({
							sev: r.severity,
							cat: r.category,
							title: r.title,
							fix: r.suggestion,
						})),
					},
					verbose: verboseRecs,
					structuredContent: verboseRecs,
				});
			} catch (error) {
				logger.error('pg_recommendations failed', {
					error: error instanceof Error ? error.message : String(error),
				});
				return toolError(
					`Recommendations failed: ${error instanceof Error ? error.message : 'Unknown error'}`,
				);
			}
		},
	);

	// pg_report_history — trends and diffs
	server.registerTool(
		'pg_report_history',
		{
			title: 'Postgres Report History',
			description:
				'View past Postgres analysis reports and compare trends. Shows changes in table sizes, dead tuples, recommendations gained/resolved.',
			inputSchema: {
				count: z
					.number()
					.int()
					.min(1)
					.max(50)
					.default(5)
					.describe('Number of past reports to load'),
				diff: z.boolean().default(true).describe('Compare latest two reports and show changes'),
			},
			outputSchema: PgReportHistoryOutputSchema,
			annotations: {
				readOnlyHint: true,
				destructiveHint: false,
				openWorldHint: false,
			},
		},
		async ({ count, diff }) => {
			logger.info('pg_report_history called', { count, diff });

			try {
				const history = getHistory(config.PG_REPORT_DIR, count);

				if (history.length === 0) {
					return toolResponse({
						compact: { n: 0, msg: 'No saved reports. Run pg_analyze with save=true first.' },
						verbose: {
							total: 0,
							message: 'No saved reports. Run pg_analyze with save=true first.',
						},
						structuredContent: {
							total: 0,
							reports: [],
							diff: null,
							diffFormatted: null,
						},
					});
				}

				const summaries = history.map((r) => ({
					timestamp: r.timestamp,
					databaseSize: r.databaseSize,
					tables: r.tables.length,
					critical: r.recommendations.filter((rec) => rec.severity === 'critical').length,
					warnings: r.recommendations.filter((rec) => rec.severity === 'warning').length,
				}));

				let diffText = '';
				let diffData: ReturnType<typeof compareReports> | null = null;

				if (diff && history.length >= 2) {
					diffData = compareReports(history[0], history[1]);
					diffText = formatDiff(diffData);
				}

				const verboseHistory = {
					total: history.length,
					reports: summaries,
					diff: diffData,
					diffFormatted: diffText || null,
				};

				return toolResponse({
					compact: {
						n: history.length,
						reports: summaries,
						diff: diffData,
					},
					verbose: verboseHistory,
					structuredContent: verboseHistory,
				});
			} catch (error) {
				logger.error('pg_report_history failed', {
					error: error instanceof Error ? error.message : String(error),
					stack: error instanceof Error ? error.stack : undefined,
				});
				return toolError(
					`Report history failed: ${error instanceof Error ? error.message : 'Unknown error'}`,
				);
			}
		},
	);

	logger.debug('Registered tools: pg_analyze, pg_recommendations, pg_report_history');
}
