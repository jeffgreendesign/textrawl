import { beforeEach, describe, expect, it, vi } from 'vitest';
import { z } from 'zod';

vi.mock('../../utils/config.js', () => ({
	config: {
		COMPACT_RESPONSES: false,
	},
}));

vi.mock('../../utils/logger.js', () => ({
	logger: { debug: vi.fn(), info: vi.fn(), warn: vi.fn(), error: vi.fn() },
}));

vi.mock('../../db/pg-client.js', () => ({
	isDatabaseConfigured: vi.fn(() => true),
	pgQuery: vi.fn(),
}));

import { isDatabaseConfigured, pgQuery } from '../../db/pg-client.js';
import { HealthCheckOutputSchema, registerHealthTool } from '../health.js';

type ToolHandler = (args: Record<string, never>, extra: unknown) => Promise<unknown>;

function createHandler(): () => Promise<unknown> {
	let handler: ToolHandler | undefined;

	const fakeServer = {
		registerTool: (_name: string, _opts: unknown, cb: ToolHandler) => {
			handler = cb;
		},
	};

	registerHealthTool(fakeServer as never);
	if (!handler) throw new Error('registerHealthTool did not register a handler');
	return () => handler!({}, {});
}

describe('health_check tool', () => {
	let callHealth: ReturnType<typeof createHandler>;

	beforeEach(() => {
		vi.clearAllMocks();
		vi.mocked(isDatabaseConfigured).mockReturnValue(true);
		vi.mocked(pgQuery).mockImplementation(async (sql: string) => {
			if (sql === 'SELECT 1') return { rows: [{ '?column?': 1 }], rowCount: 1 };
			return { rows: [{ c: 3 }], rowCount: 1 };
		});
		callHealth = createHandler();
	});

	it('returns healthy when all checks pass', async () => {
		const result = (await callHealth()) as {
			structuredContent?: { status: string; checks: Record<string, unknown> };
		};
		expect(result.structuredContent?.status).toBe('healthy');
		expect(result.structuredContent?.checks.database).toEqual(
			expect.objectContaining({ ok: true }),
		);
		expect(result.structuredContent?.checks.documents).toEqual(
			expect.objectContaining({ ok: true, count: 3 }),
		);
	});

	it('returns config error when database is not configured', async () => {
		vi.mocked(isDatabaseConfigured).mockReturnValue(false);
		const result = (await callHealth()) as { isError?: boolean; content?: Array<{ text: string }> };
		expect(result.isError).toBe(true);
		expect(result.content?.[0]?.text).toContain('DATABASE_URL');
	});

	it('returns degraded when one subsystem fails', async () => {
		vi.mocked(pgQuery).mockImplementation(async (sql: string) => {
			if (sql.includes('conversation_sessions')) throw new Error('missing table');
			if (sql === 'SELECT 1') return { rows: [{ '?column?': 1 }], rowCount: 1 };
			return { rows: [{ c: 3 }], rowCount: 1 };
		});
		const result = (await callHealth()) as {
			structuredContent?: {
				status: string;
				checks: Record<string, { ok: boolean; error?: string }>;
			};
		};
		expect(result.structuredContent?.status).toBe('degraded');
		expect(result.structuredContent?.checks.conversations.ok).toBe(false);
		expect(result.structuredContent?.checks.conversations.error).toContain('missing table');
	});

	it('output matches schema', async () => {
		const outputSchema = z.object(HealthCheckOutputSchema);
		const result = (await callHealth()) as { structuredContent?: Record<string, unknown> };
		expect(outputSchema.safeParse(result.structuredContent).success).toBe(true);
	});
});
