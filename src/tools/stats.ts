import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { z } from 'zod';
import { isSupabaseConfigured } from '../db/client.js';
import { getKnowledgeStats } from '../db/stats.js';
import { logger } from '../utils/logger.js';

/**
 * Register the knowledge_stats tool
 *
 * This tool provides statistics about the knowledge base contents.
 */
export function registerStatsTools(server: McpServer): void {
	server.registerTool(
		'knowledge_stats',
		{
			title: 'Knowledge Stats',
			description: 'Get statistics about the knowledge base contents',
			inputSchema: {},
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
		async () => {
			logger.info('knowledge_stats called');

			if (!isSupabaseConfigured()) {
				return {
					content: [
						{
							type: 'text' as const,
							text: JSON.stringify(
								{
									error: 'Database not configured',
									message: 'Set SUPABASE_URL and SUPABASE_SERVICE_KEY to enable stats.',
								},
								null,
								2,
							),
						},
					],
				};
			}

			try {
				const stats = await getKnowledgeStats();

				return {
					content: [
						{
							type: 'text' as const,
							text: JSON.stringify(stats, null, 2),
						},
					],
				};
			} catch (error) {
				logger.error('knowledge_stats failed', {
					error: error instanceof Error ? error.message : String(error),
				});

				return {
					content: [
						{
							type: 'text' as const,
							text: JSON.stringify(
								{
									error: 'Failed to get knowledge stats',
									message: error instanceof Error ? error.message : 'Unknown error',
								},
								null,
								2,
							),
						},
					],
					isError: true,
				};
			}
		},
	);

	logger.debug('Registered tool: knowledge_stats');
}
