import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { z } from 'zod';
import {
	checkDatabaseConnection,
	isDatabaseConfigured,
	queryCount,
	queryOne,
} from '../db/pg-client.js';
import { generateEmbedding, isEmbeddingsConfigured } from '../services/embeddings.js';
import { toolError, toolResponse } from '../utils/compact.js';
import { config } from '../utils/config.js';
import {
	checkTable,
	estimateRowCount,
	formatUptime,
	serverStartTime,
	timed,
} from '../utils/health-helpers.js';
import { logger } from '../utils/logger.js';

import pkg from '../../package.json' with { type: 'json' };

// --- Output Schema ---

const ComponentCheckSchema = z.object({
	ok: z.boolean(),
	latencyMs: z.number().optional(),
	error: z.string().optional(),
	model: z.string().optional(),
	provider: z.string().optional(),
	count: z.number().optional(),
	entities: z.number().optional(),
	observations: z.number().optional(),
	sessions: z.number().optional(),
	pending: z.number().optional(),
});

export const HealthCheckOutputSchema = {
	status: z.enum(['healthy', 'degraded', 'unhealthy']),
	checks: z.record(z.string(), ComponentCheckSchema),
	version: z.string(),
	uptime: z.string(),
};

// --- Embedding model name lookup ---

const EMBEDDING_MODEL_MAP: Record<string, string> = {
	openai: 'text-embedding-3-small',
};

function getEmbeddingModelName(): string {
	if (config.EMBEDDING_PROVIDER === 'ollama') return config.OLLAMA_MODEL;
	if (config.EMBEDDING_PROVIDER === 'google') return config.GOOGLE_EMBEDDING_MODEL;
	return EMBEDDING_MODEL_MAP[config.EMBEDDING_PROVIDER] ?? 'unknown';
}

/**
 * Register the health_check tool — system diagnostics for agents.
 */
export function registerHealthTool(server: McpServer): void {
	server.registerTool(
		'health_check',
		{
			title: 'Health Check',
			description:
				'Check the health of the Textrawl server and all its subsystems. Returns pass/fail per component with an overall status. Use this as the first diagnostic step when something seems broken.',
			inputSchema: {
				verbose: z
					.boolean()
					.default(false)
					.describe('Include latency measurements and row counts for each component'),
			},
			outputSchema: HealthCheckOutputSchema,
			annotations: {
				readOnlyHint: true,
				destructiveHint: false,
				idempotentHint: true,
				openWorldHint: false,
			},
		},
		async ({ verbose }) => {
			logger.info('health_check called', { verbose });

			try {
				const checks: Record<string, Record<string, unknown>> = {};
				let hasFailure = false;
				let dbOk = false;

				// 1. Database connectivity
				if (isDatabaseConfigured()) {
					try {
						const [connected, latencyMs] = await timed(checkDatabaseConnection);
						dbOk = connected;
						checks.database = { ok: connected };
						if (verbose) checks.database.latencyMs = latencyMs;
						if (!connected) {
							checks.database.error = 'Connection check failed';
							hasFailure = true;
						}
					} catch (err) {
						dbOk = false;
						hasFailure = true;
						checks.database = {
							ok: false,
							error: err instanceof Error ? err.message : 'Connection failed',
						};
					}
				} else {
					dbOk = false;
					hasFailure = true;
					checks.database = { ok: false, error: 'DATABASE_URL not configured' };
				}

				// 2. Embeddings (config + reachability)
				const embeddingsConfigured = isEmbeddingsConfigured();
				checks.embeddings = {
					ok: embeddingsConfigured,
					model: getEmbeddingModelName(),
					provider: config.EMBEDDING_PROVIDER,
				};
				if (!embeddingsConfigured) {
					checks.embeddings.error = `${config.EMBEDDING_PROVIDER} not configured`;
					hasFailure = true;
				} else {
					try {
						await generateEmbedding('health check');
					} catch (err) {
						checks.embeddings.ok = false;
						checks.embeddings.error =
							err instanceof Error ? err.message : 'Embedding service unreachable';
						hasFailure = true;
					}
				}

				// 3. Table checks (only if DB is connected)
				if (dbOk) {
					// Use estimated counts by default (pg_class catalog), exact count(*) in verbose
					const getCount = verbose
						? (table: string) => queryCount(`SELECT count(*) FROM ${table}`)
						: estimateRowCount;

					// Documents (always checked)
					try {
						const docsOk = await checkTable('documents');
						checks.documents = { ok: docsOk };
						if (!docsOk) {
							checks.documents.error = "Table 'documents' not accessible";
							hasFailure = true;
						} else {
							checks.documents.count = await getCount('documents');
						}
					} catch (err) {
						checks.documents = {
							ok: false,
							error: err instanceof Error ? err.message : 'Check failed',
						};
						hasFailure = true;
					}

					// Chunks (always checked)
					try {
						const chunksOk = await checkTable('chunks');
						checks.chunks = { ok: chunksOk };
						if (!chunksOk) {
							checks.chunks.error = "Table 'chunks' not accessible";
							hasFailure = true;
						} else {
							checks.chunks.count = await getCount('chunks');
						}
					} catch (err) {
						checks.chunks = {
							ok: false,
							error: err instanceof Error ? err.message : 'Check failed',
						};
						hasFailure = true;
					}

					// Memory (if enabled)
					if (config.ENABLE_MEMORY) {
						try {
							const memOk = await checkTable('memory_entities');
							checks.memory = { ok: memOk };
							if (!memOk) {
								checks.memory.error = "Table 'memory_entities' not accessible";
								hasFailure = true;
							} else {
								checks.memory.entities = await getCount('memory_entities');
								checks.memory.observations = await getCount('memory_observations');
							}
						} catch (err) {
							checks.memory = {
								ok: false,
								error: err instanceof Error ? err.message : 'Check failed',
							};
							hasFailure = true;
						}
					}

					// Conversations (if enabled)
					if (config.ENABLE_CONVERSATIONS) {
						try {
							const convOk = await checkTable('conversation_sessions');
							checks.conversations = { ok: convOk };
							if (!convOk) {
								checks.conversations.error = "Table 'conversation_sessions' not accessible";
								hasFailure = true;
							} else {
								checks.conversations.sessions = await getCount('conversation_sessions');
							}
						} catch (err) {
							checks.conversations = {
								ok: false,
								error: err instanceof Error ? err.message : 'Check failed',
							};
							hasFailure = true;
						}
					}

					// Insights (if enabled)
					if (config.ENABLE_INSIGHTS) {
						try {
							const insOk = await checkTable('proactive_insights');
							checks.insights = { ok: insOk };
							if (!insOk) {
								checks.insights.error = "Table 'proactive_insights' not accessible";
								hasFailure = true;
							} else {
								checks.insights.count = await getCount('proactive_insights');
							}
						} catch (err) {
							checks.insights = {
								ok: false,
								error: err instanceof Error ? err.message : 'Check failed',
							};
							hasFailure = true;
						}

						// Insight queue
						try {
							const queueOk = await checkTable('insight_queue');
							checks.insightQueue = { ok: queueOk };
							if (!queueOk) {
								checks.insightQueue.error = "Table 'insight_queue' not accessible";
								hasFailure = true;
							} else {
								const row = await queryOne<{ chunks_pending: number }>(
									'SELECT chunks_pending FROM insight_queue WHERE id = 1',
								);
								if (row) {
									checks.insightQueue.pending = row.chunks_pending;
								}
							}
						} catch (err) {
							checks.insightQueue = {
								ok: false,
								error: err instanceof Error ? err.message : 'Check failed',
							};
							hasFailure = true;
						}
					}
				}

				// Overall status
				let status: 'healthy' | 'degraded' | 'unhealthy';
				if (!dbOk) {
					status = 'unhealthy';
				} else if (hasFailure) {
					status = 'degraded';
				} else {
					status = 'healthy';
				}

				const uptimeSeconds = Math.round((Date.now() - serverStartTime) / 1000);
				const result = {
					status,
					checks,
					version: pkg.version,
					uptime: formatUptime(uptimeSeconds),
				};

				return toolResponse({
					compact: result,
					verbose: result,
					structuredContent: result,
				});
			} catch (error) {
				return toolError('health_check', error);
			}
		},
	);

	logger.debug('Registered tool: health_check');
}
