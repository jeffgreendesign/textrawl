import { beforeEach, describe, expect, it, vi } from 'vitest';
import { z } from 'zod';

// --- Mocks (must be declared before imports) ---

vi.mock('../../utils/config.js', () => ({
	config: {
		COMPACT_RESPONSES: false,
		ENABLE_MEMORY: false,
		ENABLE_CONVERSATIONS: false,
		ENABLE_INSIGHTS: false,
		EMBEDDING_PROVIDER: 'openai',
		OLLAMA_MODEL: 'nomic-embed-text',
		GOOGLE_EMBEDDING_MODEL: 'text-embedding-004',
	},
}));

vi.mock('../../utils/logger.js', () => ({
	logger: { debug: vi.fn(), info: vi.fn(), warn: vi.fn(), error: vi.fn() },
}));

vi.mock('../../db/pg-client.js', () => ({
	isDatabaseConfigured: vi.fn(() => true),
	checkDatabaseConnection: vi.fn(async () => true),
	pgQuery: vi.fn(),
	queryCount: vi.fn(async () => 0),
	queryOne: vi.fn(async () => null),
}));

vi.mock('../../services/embeddings.js', () => ({
	isEmbeddingsConfigured: vi.fn(() => true),
	generateEmbedding: vi.fn(async () => [0.1, 0.2, 0.3]),
}));

vi.mock('../../utils/health-helpers.js', async (importOriginal) => {
	const orig = await importOriginal<typeof import('../../utils/health-helpers.js')>();
	return {
		...orig,
		serverStartTime: Date.now() - 60_000, // 1 minute ago
		checkTable: vi.fn(async () => true),
		estimateRowCount: vi.fn(async () => 0),
	};
});

// --- Imports ---

import { checkDatabaseConnection, isDatabaseConfigured, queryCount } from '../../db/pg-client.js';
import { generateEmbedding, isEmbeddingsConfigured } from '../../services/embeddings.js';
import { config } from '../../utils/config.js';
import { checkTable, estimateRowCount } from '../../utils/health-helpers.js';
import { HealthCheckOutputSchema, registerHealthTool } from '../health.js';

// --- Helpers ---

type ToolHandler = (args: { verbose: boolean }, extra: unknown) => Promise<unknown>;

function createHandler(): (verbose: boolean) => Promise<unknown> {
	let handler: ToolHandler | undefined;

	const fakeServer = {
		registerTool: (_name: string, _opts: unknown, cb: ToolHandler) => {
			handler = cb;
		},
	};

	registerHealthTool(fakeServer as never);

	if (!handler) throw new Error('registerHealthTool did not register a handler');
	const h = handler;
	return (verbose: boolean) => h({ verbose }, {});
}

// --- Tests ---

describe('health_check tool', () => {
	let callHealth: ReturnType<typeof createHandler>;

	beforeEach(() => {
		vi.clearAllMocks();
		vi.mocked(isDatabaseConfigured).mockReturnValue(true);
		vi.mocked(checkDatabaseConnection).mockResolvedValue(true);
		vi.mocked(isEmbeddingsConfigured).mockReturnValue(true);
		vi.mocked(checkTable).mockResolvedValue(true);

		(config as Record<string, unknown>).ENABLE_MEMORY = false;
		(config as Record<string, unknown>).ENABLE_CONVERSATIONS = false;
		(config as Record<string, unknown>).ENABLE_INSIGHTS = false;
		(config as Record<string, unknown>).EMBEDDING_PROVIDER = 'openai';

		callHealth = createHandler();
	});

	it('returns healthy when all checks pass', async () => {
		const result = (await callHealth(false)) as {
			structuredContent?: { status: string; checks: Record<string, unknown> };
		};
		expect(result.structuredContent?.status).toBe('healthy');
		expect(result.structuredContent?.checks.database).toEqual(
			expect.objectContaining({ ok: true }),
		);
		expect(result.structuredContent?.checks.embeddings).toEqual(
			expect.objectContaining({ ok: true, model: 'text-embedding-3-small', provider: 'openai' }),
		);
		expect(result.structuredContent?.checks.documents).toEqual(
			expect.objectContaining({ ok: true, count: 0 }),
		);
		expect(result.structuredContent?.checks.chunks).toEqual(
			expect.objectContaining({ ok: true, count: 0 }),
		);
	});

	it('returns unhealthy when database is not configured', async () => {
		vi.mocked(isDatabaseConfigured).mockReturnValue(false);
		const result = (await callHealth(false)) as {
			structuredContent?: {
				status: string;
				checks: Record<string, { ok: boolean; error?: string }>;
			};
		};
		expect(result.structuredContent?.status).toBe('unhealthy');
		expect(result.structuredContent?.checks.database.ok).toBe(false);
		expect(result.structuredContent?.checks.database.error).toContain('not configured');
	});

	it('returns unhealthy when database connection fails', async () => {
		vi.mocked(checkDatabaseConnection).mockResolvedValue(false);
		const result = (await callHealth(false)) as {
			structuredContent?: { status: string; checks: Record<string, { ok: boolean }> };
		};
		expect(result.structuredContent?.status).toBe('unhealthy');
		expect(result.structuredContent?.checks.database.ok).toBe(false);
	});

	it('returns degraded when a table check fails', async () => {
		vi.mocked(checkTable).mockImplementation(async (table: string) => {
			return table !== 'documents';
		});

		const result = (await callHealth(false)) as {
			structuredContent?: {
				status: string;
				checks: Record<string, { ok: boolean; error?: string }>;
			};
		};
		expect(result.structuredContent?.status).toBe('degraded');
		expect(result.structuredContent?.checks.documents.ok).toBe(false);
	});

	it('checks memory tables when ENABLE_MEMORY is true', async () => {
		(config as { ENABLE_MEMORY: boolean }).ENABLE_MEMORY = true;
		const result = (await callHealth(false)) as {
			structuredContent?: {
				checks: Record<string, { ok: boolean; entities?: number; observations?: number }>;
			};
		};
		expect(result.structuredContent?.checks.memory).toBeDefined();
		expect(result.structuredContent?.checks.memory.ok).toBe(true);
		expect(result.structuredContent?.checks.memory.entities).toBe(0);
		expect(result.structuredContent?.checks.memory.observations).toBe(0);
	});

	it('checks conversation tables when ENABLE_CONVERSATIONS is true', async () => {
		(config as { ENABLE_CONVERSATIONS: boolean }).ENABLE_CONVERSATIONS = true;
		const result = (await callHealth(false)) as {
			structuredContent?: { checks: Record<string, { ok: boolean; sessions?: number }> };
		};
		expect(result.structuredContent?.checks.conversations).toBeDefined();
		expect(result.structuredContent?.checks.conversations.ok).toBe(true);
		expect(result.structuredContent?.checks.conversations.sessions).toBe(0);
	});

	it('checks insight tables when ENABLE_INSIGHTS is true', async () => {
		(config as { ENABLE_INSIGHTS: boolean }).ENABLE_INSIGHTS = true;
		const result = (await callHealth(false)) as {
			structuredContent?: { checks: Record<string, { ok: boolean; count?: number }> };
		};
		expect(result.structuredContent?.checks.insights).toBeDefined();
		expect(result.structuredContent?.checks.insights.ok).toBe(true);
		expect(result.structuredContent?.checks.insights.count).toBe(0);
		expect(result.structuredContent?.checks.insightQueue).toBeDefined();
	});

	it('includes version and uptime', async () => {
		const result = (await callHealth(false)) as {
			structuredContent?: { version: string; uptime: string };
		};
		expect(result.structuredContent?.version).toBeDefined();
		expect(result.structuredContent?.uptime).toBeDefined();
		// Uptime should be a human-readable string
		expect(result.structuredContent?.uptime).toMatch(/\d+[dhms]/);
	});

	it('reports correct embedding model for ollama', async () => {
		(config as Record<string, unknown>).EMBEDDING_PROVIDER = 'ollama';
		(config as Record<string, unknown>).OLLAMA_MODEL = 'nomic-embed-text-v2-moe';
		const result = (await callHealth(false)) as {
			structuredContent?: { checks: Record<string, { model?: string }> };
		};
		expect(result.structuredContent?.checks.embeddings.model).toBe('nomic-embed-text-v2-moe');
	});

	it('always includes counts even when verbose is false', async () => {
		(config as Record<string, unknown>).ENABLE_MEMORY = true;
		(config as Record<string, unknown>).ENABLE_CONVERSATIONS = true;
		(config as Record<string, unknown>).ENABLE_INSIGHTS = true;

		const result = (await callHealth(false)) as {
			structuredContent?: { checks: Record<string, Record<string, unknown>> };
		};
		const checks = result.structuredContent?.checks;
		expect(checks?.documents.count).toBe(0);
		expect(checks?.chunks.count).toBe(0);
		expect(checks?.memory.entities).toBe(0);
		expect(checks?.memory.observations).toBe(0);
		expect(checks?.conversations.sessions).toBe(0);
		expect(checks?.insights.count).toBe(0);
	});

	it('returns degraded when embedding service is unreachable', async () => {
		vi.mocked(generateEmbedding).mockRejectedValueOnce(new Error('Connection refused'));
		const result = (await callHealth(false)) as {
			structuredContent?: {
				status: string;
				checks: Record<string, { ok: boolean; error?: string }>;
			};
		};
		expect(result.structuredContent?.status).toBe('degraded');
		expect(result.structuredContent?.checks.embeddings.ok).toBe(false);
		expect(result.structuredContent?.checks.embeddings.error).toBe('Connection refused');
	});

	it('insight queue failure sets status to degraded', async () => {
		(config as Record<string, unknown>).ENABLE_INSIGHTS = true;
		vi.mocked(checkTable).mockImplementation(async (table: string) => {
			return table !== 'insight_queue';
		});

		const result = (await callHealth(false)) as {
			structuredContent?: {
				status: string;
				checks: Record<string, { ok: boolean; error?: string }>;
			};
		};
		expect(result.structuredContent?.status).toBe('degraded');
		expect(result.structuredContent?.checks.insightQueue.ok).toBe(false);
		expect(result.structuredContent?.checks.insightQueue.error).toContain('not accessible');
	});

	it('uses estimated counts by default and exact counts in verbose mode', async () => {
		vi.mocked(estimateRowCount).mockResolvedValue(100);
		vi.mocked(queryCount).mockResolvedValue(42);

		const defaultResult = (await callHealth(false)) as {
			structuredContent?: { checks: Record<string, { count?: number }> };
		};
		expect(defaultResult.structuredContent?.checks.documents.count).toBe(100);

		const verboseResult = (await callHealth(true)) as {
			structuredContent?: { checks: Record<string, { count?: number }> };
		};
		expect(verboseResult.structuredContent?.checks.documents.count).toBe(42);
	});

	it('includes provider in embeddings check', async () => {
		(config as Record<string, unknown>).EMBEDDING_PROVIDER = 'google';
		const result = (await callHealth(false)) as {
			structuredContent?: { checks: Record<string, { provider?: string }> };
		};
		expect(result.structuredContent?.checks.embeddings.provider).toBe('google');
	});

	describe('output schema validation', () => {
		const outputSchema = z.object(HealthCheckOutputSchema);

		it('healthy state passes schema validation', async () => {
			const result = (await callHealth(false)) as {
				structuredContent?: Record<string, unknown>;
			};
			const parsed = outputSchema.safeParse(result.structuredContent);
			expect(parsed.success).toBe(true);
		});

		it('degraded state passes schema validation', async () => {
			vi.mocked(checkTable).mockResolvedValue(false);
			const result = (await callHealth(false)) as {
				structuredContent?: Record<string, unknown>;
			};
			const parsed = outputSchema.safeParse(result.structuredContent);
			expect(parsed.success).toBe(true);
		});

		it('unhealthy state passes schema validation', async () => {
			vi.mocked(isDatabaseConfigured).mockReturnValue(false);
			const result = (await callHealth(false)) as {
				structuredContent?: Record<string, unknown>;
			};
			const parsed = outputSchema.safeParse(result.structuredContent);
			expect(parsed.success).toBe(true);
		});

		it('verbose mode passes schema validation', async () => {
			(config as { ENABLE_MEMORY: boolean }).ENABLE_MEMORY = true;
			(config as { ENABLE_CONVERSATIONS: boolean }).ENABLE_CONVERSATIONS = true;
			(config as { ENABLE_INSIGHTS: boolean }).ENABLE_INSIGHTS = true;

			const result = (await callHealth(true)) as {
				structuredContent?: Record<string, unknown>;
			};
			const parsed = outputSchema.safeParse(result.structuredContent);
			expect(parsed.success).toBe(true);
		});
	});
});
