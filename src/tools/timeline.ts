import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { z } from 'zod';
import { isSupabaseConfigured } from '../db/client.js';
import { listDocuments } from '../db/documents.js';
import { hybridSearch } from '../db/search.js';
import { generateEmbedding, isEmbeddingsConfigured } from '../services/embeddings.js';
import { configError, toolError } from '../utils/compact.js';
import { logger } from '../utils/logger.js';

/**
 * Register the timeline tool — temporal view of knowledge.
 */
export function registerTimelineTool(server: McpServer): void {
	server.registerTool(
		'timeline',
		{
			title: 'Timeline',
			description:
				'View your knowledge chronologically. Filter by date range and optionally by topic. Returns documents in chronological order.',
			inputSchema: {
				startDate: z.string().describe('Start date (ISO 8601 format, e.g. "2025-01-01")'),
				endDate: z.string().describe('End date (ISO 8601 format, e.g. "2025-12-31")'),
				topic: z
					.string()
					.optional()
					.describe('Optional topic to filter by (uses semantic search within date range)'),
				limit: z.number().int().min(1).max(100).default(20).describe('Maximum results'),
			},
			annotations: {
				readOnlyHint: true,
				destructiveHint: false,
				idempotentHint: true,
			},
		},
		async ({ startDate, endDate, topic, limit }) => {
			logger.info('timeline called', { startDate, endDate, topic, limit });

			if (!isSupabaseConfigured()) {
				return configError('Database', 'Set SUPABASE_URL and SUPABASE_SERVICE_KEY');
			}

			try {
				const start = new Date(startDate);
				const end = new Date(endDate);

				if (Number.isNaN(start.getTime()) || Number.isNaN(end.getTime())) {
					return toolError('Invalid date format. Use ISO 8601 (e.g. "2025-01-01").');
				}

				if (topic && isEmbeddingsConfigured()) {
					// Semantic search within date range
					const queryEmbedding = await generateEmbedding(topic);
					const searchResults = await hybridSearch({
						queryText: topic,
						queryEmbedding,
						limit: limit * 2,
					});

					// Filter by date range
					const filtered = searchResults.filter((r) => {
						const meta = r.document_metadata as Record<string, unknown> | null;
						const docDate = meta?.content_date ? new Date(meta.content_date as string) : null;
						// We don't have created_at on search results directly, so rely on metadata
						return !docDate || (docDate >= start && docDate <= end);
					});

					return {
						content: [
							{
								type: 'text' as const,
								text: JSON.stringify(
									{
										startDate,
										endDate,
										topic,
										totalResults: filtered.length,
										results: filtered.slice(0, limit).map((r) => ({
											documentId: r.document_id,
											documentTitle: r.document_title,
											sourceType: r.source_type,
											content: r.content.slice(0, 300),
											score: r.score,
										})),
									},
									null,
									2,
								),
							},
						],
					};
				}

				// No topic — just list documents in date range
				const allDocs = await listDocuments({
					limit: limit * 3,
					offset: 0,
					sortBy: 'created_at',
					sortOrder: 'asc',
				});

				const filtered = allDocs.documents.filter((d) => {
					const docDate = new Date(d.created_at);
					return docDate >= start && docDate <= end;
				});

				return {
					content: [
						{
							type: 'text' as const,
							text: JSON.stringify(
								{
									startDate,
									endDate,
									totalResults: filtered.length,
									results: filtered.slice(0, limit).map((d) => ({
										documentId: d.id,
										title: d.title,
										sourceType: d.source_type,
										createdAt: d.created_at,
									})),
								},
								null,
								2,
							),
						},
					],
				};
			} catch (error) {
				logger.error('timeline failed', {
					error: error instanceof Error ? error.message : String(error),
				});
				return toolError(error instanceof Error ? error.message : 'Failed to build timeline');
			}
		},
	);

	logger.debug('Registered tool: timeline');
}
