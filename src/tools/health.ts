import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { z } from 'zod';
import { isDatabaseConfigured, pgQuery } from '../db/pg-client.js';
import { configError, toolError, toolResponse } from '../utils/compact.js';
import { logger } from '../utils/logger.js';

const ComponentCheckSchema = z.object({
	ok: z.boolean(),
	latencyMs: z.number().optional(),
	error: z.string().optional(),
	count: z.number().optional(),
	entities: z.number().optional(),
	sessions: z.number().optional(),
});

export const HealthCheckOutputSchema = {
	status: z.enum(['healthy', 'degraded', 'unhealthy']),
	checks: z.record(z.string(), ComponentCheckSchema),
	timestamp: z.string(),
};

export type TableName =
	| 'documents'
	| 'chunks'
	| 'memory_entities'
	| 'conversation_sessions'
	| 'proactive_insights';

async function countRows(table: TableName): Promise<number> {
	const result = await pgQuery<{ c: number }>(`SELECT COUNT(*)::int AS c FROM ${table}`);
	return result.rows[0]?.c ?? 0;
}

async function handleHealthCheck() {
	const checks: Record<string, Record<string, unknown>> = {};

	const t0 = Date.now();
	try {
		await pgQuery('SELECT 1');
		checks.database = { ok: true, latencyMs: Date.now() - t0 };
	} catch (error) {
		checks.database = {
			ok: false,
			error: error instanceof Error ? error.message : String(error),
		};
	}

	try {
		checks.documents = { ok: true, count: await countRows('documents') };
	} catch (error) {
		checks.documents = {
			ok: false,
			error: error instanceof Error ? error.message : String(error),
		};
	}

	try {
		checks.chunks = { ok: true, count: await countRows('chunks') };
	} catch (error) {
		checks.chunks = {
			ok: false,
			error: error instanceof Error ? error.message : String(error),
		};
	}

	try {
		checks.memory = { ok: true, entities: await countRows('memory_entities') };
	} catch (error) {
		checks.memory = {
			ok: false,
			error: error instanceof Error ? error.message : String(error),
		};
	}

	try {
		checks.conversations = {
			ok: true,
			sessions: await countRows('conversation_sessions'),
		};
	} catch (error) {
		checks.conversations = {
			ok: false,
			error: error instanceof Error ? error.message : String(error),
		};
	}

	try {
		checks.insights = { ok: true, count: await countRows('proactive_insights') };
	} catch (error) {
		checks.insights = {
			ok: false,
			error: error instanceof Error ? error.message : String(error),
		};
	}

	const values = Object.values(checks);
	const allOk = values.every((check) => check.ok === true);
	const anyOk = values.some((check) => check.ok === true);

	return {
		status: allOk ? 'healthy' : anyOk ? 'degraded' : 'unhealthy',
		checks,
		timestamp: new Date().toISOString(),
	};
}

export function registerHealthTool(server: McpServer): void {
	server.registerTool(
		'health_check',
		{
			title: 'Health Check',
			description:
				'Quick diagnostic check across all textrawl subsystems. Returns pass/fail per component with error details on failure. Use as the first call when other tools are failing.',
			inputSchema: {},
			outputSchema: HealthCheckOutputSchema,
			annotations: {
				readOnlyHint: true,
				destructiveHint: false,
				idempotentHint: true,
				openWorldHint: false,
			},
		},
		async () => {
			logger.info('health_check called');

			if (!isDatabaseConfigured()) {
				return configError('Database', 'Set DATABASE_URL');
			}

			try {
				const result = await handleHealthCheck();
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
