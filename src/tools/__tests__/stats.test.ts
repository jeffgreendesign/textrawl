import { beforeEach, describe, expect, it, vi } from 'vitest';
import { z } from 'zod';

// --- Mocks (must be declared before imports) ---

vi.mock('../../utils/config.js', () => ({
	config: {
		COMPACT_RESPONSES: false,
		ENABLE_MEMORY: false,
		ENABLE_CONVERSATIONS: false,
		ENABLE_INSIGHTS: false,
	},
}));

vi.mock('../../utils/logger.js', () => ({
	logger: { debug: vi.fn(), info: vi.fn(), warn: vi.fn(), error: vi.fn() },
}));

vi.mock('../../db/pg-client.js', () => ({
	isDatabaseConfigured: vi.fn(() => true),
}));

vi.mock('../../db/stats.js', () => ({
	getKnowledgeStats: vi.fn(),
}));

vi.mock('../../db/memory-search.js', () => ({
	getMemoryStats: vi.fn(),
}));

vi.mock('../../db/conversation-search.js', () => ({
	getConversationSearchStats: vi.fn(),
}));

vi.mock('../../db/insights.js', () => ({
	getInsightStats: vi.fn(),
	validateInsightSchema: vi.fn(),
}));

// --- Imports ---

import { getConversationSearchStats } from '../../db/conversation-search.js';
import { getInsightStats, validateInsightSchema } from '../../db/insights.js';
import { getMemoryStats } from '../../db/memory-search.js';
import { isDatabaseConfigured } from '../../db/pg-client.js';
import { getKnowledgeStats } from '../../db/stats.js';
import { gatherAllStats, GetStatsOutputSchema, registerStatsTools } from '../../tools/stats.js';
import { config } from '../../utils/config.js';

// --- Helpers ---

type ToolHandler = (args: { scope: string }, extra: unknown) => Promise<unknown>;

/**
 * Register get_stats and return a callable handler.
 */
function createHandler(): (scope: string) => Promise<unknown> {
	let handler: ToolHandler | undefined;

	const fakeServer = {
		registerTool: (_name: string, _opts: unknown, cb: ToolHandler) => {
			handler = cb;
		},
	};

	registerStatsTools(fakeServer as never);

	if (!handler) throw new Error('registerStatsTools did not register a handler');
	const h = handler;
	return (scope: string) => h({ scope }, {});
}

// --- Tests ---

describe('get_stats tool', () => {
	let callStats: ReturnType<typeof createHandler>;

	beforeEach(() => {
		vi.clearAllMocks();
		vi.mocked(isDatabaseConfigured).mockReturnValue(true);

		// Reset feature flags to defaults (prevent cross-test leakage)
		(config as Record<string, unknown>).ENABLE_MEMORY = false;
		(config as Record<string, unknown>).ENABLE_CONVERSATIONS = false;
		(config as Record<string, unknown>).ENABLE_INSIGHTS = false;

		// Default: empty knowledge base
		vi.mocked(getKnowledgeStats).mockResolvedValue({
			total: 0,
			bySourceType: {},
			byContentType: {},
			topTags: [],
			dateRange: { oldest: null, newest: null },
		});

		callStats = createHandler();
	});

	it('returns config error when database is not configured', async () => {
		vi.mocked(isDatabaseConfigured).mockReturnValue(false);
		const result = (await callStats('all')) as { isError?: boolean; content: { text: string }[] };
		expect(result.isError).toBe(true);
		expect(result.content[0].text).toContain('not configured');
		expect(result.content[0].text).toContain('DATABASE_URL');
	});

	it('returns knowledge stats for empty database', async () => {
		const result = (await callStats('knowledge')) as {
			structuredContent?: { knowledge: unknown };
		};
		expect(result.structuredContent?.knowledge).toEqual({
			total: 0,
			bySourceType: {},
			byContentType: {},
			topTags: [],
			dateRange: { oldest: null, newest: null },
		});
	});

	it('handles Date objects in dateRange via serializeDates', async () => {
		vi.mocked(getKnowledgeStats).mockResolvedValue({
			total: 1,
			bySourceType: { file: 1 },
			byContentType: { text: 1 },
			topTags: [],
			dateRange: {
				oldest: new Date('2024-01-01T00:00:00.000Z') as unknown as string,
				newest: new Date('2024-06-01T00:00:00.000Z') as unknown as string,
			},
		});

		const result = (await callStats('knowledge')) as {
			structuredContent?: { knowledge: { dateRange: { oldest: string; newest: string } } };
		};
		expect(result.structuredContent?.knowledge.dateRange.oldest).toBe('2024-01-01T00:00:00.000Z');
		expect(result.structuredContent?.knowledge.dateRange.newest).toBe('2024-06-01T00:00:00.000Z');
	});

	it('returns error for disabled memory scope', async () => {
		(config as { ENABLE_MEMORY: boolean }).ENABLE_MEMORY = false;
		const result = (await callStats('memory')) as {
			isError?: boolean;
			content: { text: string }[];
		};
		expect(result.isError).toBe(true);
		expect(result.content[0].text).toContain('disabled');
	});

	it('returns error for disabled conversations scope', async () => {
		(config as { ENABLE_CONVERSATIONS: boolean }).ENABLE_CONVERSATIONS = false;
		const result = (await callStats('conversations')) as {
			isError?: boolean;
			content: { text: string }[];
		};
		expect(result.isError).toBe(true);
		expect(result.content[0].text).toContain('disabled');
	});

	it('returns error for disabled insights scope', async () => {
		(config as { ENABLE_INSIGHTS: boolean }).ENABLE_INSIGHTS = false;
		const result = (await callStats('insights')) as {
			isError?: boolean;
			content: { text: string }[];
		};
		expect(result.isError).toBe(true);
		expect(result.content[0].text).toContain('disabled');
	});

	it('scope=all silently skips disabled features', async () => {
		(config as { ENABLE_MEMORY: boolean }).ENABLE_MEMORY = false;
		(config as { ENABLE_CONVERSATIONS: boolean }).ENABLE_CONVERSATIONS = false;
		(config as { ENABLE_INSIGHTS: boolean }).ENABLE_INSIGHTS = false;

		const result = (await callStats('all')) as {
			structuredContent?: Record<string, unknown>;
		};
		expect(result.structuredContent).toHaveProperty('knowledge');
		expect(result.structuredContent).not.toHaveProperty('memory');
		expect(result.structuredContent).not.toHaveProperty('conversations');
		expect(result.structuredContent).not.toHaveProperty('insights');
	});

	it('includes insight stats with queueState dates serialized', async () => {
		(config as { ENABLE_INSIGHTS: boolean }).ENABLE_INSIGHTS = true;
		vi.mocked(validateInsightSchema).mockResolvedValue({
			valid: true,
			missing: [],
			hint: '',
		});
		vi.mocked(getInsightStats).mockResolvedValue({
			total: 3,
			new: 2,
			seen: 1,
			dismissed: 0,
			byType: { theme: 3 },
			queueState: {
				chunks_pending: 5,
				is_processing: false,
				last_insert_at: new Date('2024-03-01T00:00:00.000Z') as unknown as string,
				last_scan_at: new Date('2024-03-01T12:00:00.000Z') as unknown as string,
			},
		});

		const result = (await callStats('insights')) as {
			structuredContent?: {
				insights: {
					queueState: {
						last_insert_at: string;
						last_scan_at: string;
					};
				};
			};
		};
		const qs = result.structuredContent?.insights.queueState;
		expect(qs?.last_insert_at).toBe('2024-03-01T00:00:00.000Z');
		expect(qs?.last_scan_at).toBe('2024-03-01T12:00:00.000Z');
	});

	it('handles database error gracefully with structured error', async () => {
		vi.mocked(getKnowledgeStats).mockRejectedValue(new Error('connection refused'));
		const result = (await callStats('knowledge')) as {
			isError?: boolean;
			content: { text: string }[];
		};
		expect(result.isError).toBe(true);
		const parsed = JSON.parse(result.content[0].text);
		expect(parsed.error).toBe(true);
		expect(parsed.tool).toBe('get_stats');
		expect(parsed.message).toBe('connection refused');
		expect(parsed.scope).toBe('knowledge');
	});

	it('returns insight stats with empty data (all zeros)', async () => {
		(config as { ENABLE_INSIGHTS: boolean }).ENABLE_INSIGHTS = true;
		vi.mocked(validateInsightSchema).mockResolvedValue({
			valid: true,
			missing: [],
			hint: '',
		});
		vi.mocked(getInsightStats).mockResolvedValue({
			total: 0,
			new: 0,
			seen: 0,
			dismissed: 0,
			byType: {},
			queueState: null,
		});

		const result = (await callStats('insights')) as {
			isError?: boolean;
			structuredContent?: {
				insights: {
					total: number;
					new: number;
					seen: number;
					dismissed: number;
					byType: Record<string, number>;
					queueState: null;
				};
			};
		};
		expect(result.isError).toBeUndefined();
		expect(result.structuredContent?.insights).toEqual({
			total: 0,
			new: 0,
			seen: 0,
			dismissed: 0,
			byType: {},
			queueState: null,
		});
	});

	it('returns insight stats with null queueState in structuredContent', async () => {
		(config as { ENABLE_INSIGHTS: boolean }).ENABLE_INSIGHTS = true;
		vi.mocked(validateInsightSchema).mockResolvedValue({
			valid: true,
			missing: [],
			hint: '',
		});
		vi.mocked(getInsightStats).mockResolvedValue({
			total: 1,
			new: 1,
			seen: 0,
			dismissed: 0,
			byType: { cross_source: 1 },
			queueState: null,
		});

		const result = (await callStats('insights')) as {
			structuredContent?: { insights: { queueState: unknown } };
		};
		expect(result.structuredContent?.insights.queueState).toBeNull();
	});

	it('scope=insights returns structured error when getInsightStats throws', async () => {
		(config as { ENABLE_INSIGHTS: boolean }).ENABLE_INSIGHTS = true;
		vi.mocked(validateInsightSchema).mockResolvedValue({
			valid: true,
			missing: [],
			hint: '',
		});
		vi.mocked(getInsightStats).mockRejectedValue(
			new Error('relation "proactive_insights" does not exist'),
		);

		const result = (await callStats('insights')) as {
			isError?: boolean;
			content: { text: string }[];
		};
		expect(result.isError).toBe(true);
		const parsed = JSON.parse(result.content[0].text);
		expect(parsed.tool).toBe('get_stats');
		expect(parsed.scope).toBe('insights');
		expect(parsed.message).toContain('proactive_insights');
	});

	it('scope=all returns partial results with error object when insights throws', async () => {
		(config as { ENABLE_INSIGHTS: boolean }).ENABLE_INSIGHTS = true;
		vi.mocked(validateInsightSchema).mockResolvedValue({
			valid: true,
			missing: [],
			hint: '',
		});
		vi.mocked(getInsightStats).mockRejectedValue(new Error('insights query failed'));

		const result = (await callStats('all')) as {
			isError?: boolean;
			structuredContent?: Record<string, unknown>;
		};
		// Should NOT be a top-level error — insights failure is reported per-scope
		expect(result.isError).toBeUndefined();
		expect(result.structuredContent).toHaveProperty('knowledge');
		// Insights should have an error object, not be absent
		expect(result.structuredContent?.insights).toEqual({
			error: true,
			message: 'insights query failed',
			code: expect.any(String),
		});
	});

	it('scope=all returns partial results with error for knowledge failure', async () => {
		(config as { ENABLE_MEMORY: boolean }).ENABLE_MEMORY = true;
		vi.mocked(getKnowledgeStats).mockRejectedValue(new Error('knowledge table missing'));
		vi.mocked(getMemoryStats).mockResolvedValue({
			totalEntities: 5,
			totalObservations: 10,
			totalRelations: 3,
			entityTypeCounts: { person: 3, org: 2 },
		});

		const result = (await callStats('all')) as {
			isError?: boolean;
			structuredContent?: Record<string, unknown>;
		};
		expect(result.isError).toBeUndefined();
		// Knowledge has error
		expect(result.structuredContent?.knowledge).toEqual({
			error: true,
			message: 'knowledge table missing',
			code: expect.any(String),
		});
		// Memory still succeeded
		expect(result.structuredContent?.memory).toEqual({
			totalEntities: 5,
			totalObservations: 10,
			totalRelations: 3,
			entityTypeCounts: { person: 3, org: 2 },
		});
	});

	it('scope=all reports schema error for insights when schema not ready', async () => {
		(config as { ENABLE_INSIGHTS: boolean }).ENABLE_INSIGHTS = true;
		vi.mocked(validateInsightSchema).mockResolvedValue({
			valid: false,
			missing: ['proactive_insights'],
			hint: 'Run setup-db-insights.sql',
		});

		const result = (await callStats('all')) as {
			structuredContent?: Record<string, unknown>;
		};
		expect(result.structuredContent?.insights).toEqual({
			error: true,
			message: 'Run setup-db-insights.sql',
			code: 'SCHEMA_ERROR',
		});
	});

	describe('output schema validation', () => {
		const outputSchema = z.object(GetStatsOutputSchema);

		it('scope=knowledge passes output schema validation', async () => {
			const result = (await callStats('knowledge')) as {
				structuredContent?: Record<string, unknown>;
			};
			const parsed = outputSchema.safeParse(result.structuredContent);
			expect(parsed.success).toBe(true);
		});

		it('scope=all with all features passes output schema validation', async () => {
			(config as { ENABLE_INSIGHTS: boolean }).ENABLE_INSIGHTS = true;
			(config as { ENABLE_MEMORY: boolean }).ENABLE_MEMORY = true;
			(config as { ENABLE_CONVERSATIONS: boolean }).ENABLE_CONVERSATIONS = true;

			vi.mocked(validateInsightSchema).mockResolvedValue({
				valid: true,
				missing: [],
				hint: '',
			});
			vi.mocked(getInsightStats).mockResolvedValue({
				total: 5,
				new: 2,
				seen: 2,
				dismissed: 1,
				byType: { theme_cluster: 3, cross_source: 2 },
				queueState: {
					chunks_pending: 10,
					is_processing: false,
					last_insert_at: '2024-03-01T00:00:00.000Z',
					last_scan_at: '2024-03-01T12:00:00.000Z',
				},
			});
			vi.mocked(getMemoryStats).mockResolvedValue({
				totalEntities: 5,
				totalObservations: 10,
				totalRelations: 3,
				entityTypeCounts: { person: 3 },
			});
			vi.mocked(getConversationSearchStats).mockResolvedValue({
				totalSessions: 2,
				sessionsWithSummary: 1,
				totalTurns: 20,
				turnsWithEmbedding: 15,
			});

			const result = (await callStats('all')) as {
				structuredContent?: Record<string, unknown>;
			};
			const parsed = outputSchema.safeParse(result.structuredContent);
			expect(parsed.success).toBe(true);
		});

		it('scope=all with partial errors passes output schema validation', async () => {
			(config as { ENABLE_INSIGHTS: boolean }).ENABLE_INSIGHTS = true;
			vi.mocked(validateInsightSchema).mockResolvedValue({
				valid: true,
				missing: [],
				hint: '',
			});
			vi.mocked(getInsightStats).mockRejectedValue(new Error('insights broken'));

			const result = (await callStats('all')) as {
				structuredContent?: Record<string, unknown>;
			};
			const parsed = outputSchema.safeParse(result.structuredContent);
			expect(parsed.success).toBe(true);
		});
	});
});

describe('gatherAllStats (JSON resource source)', () => {
	beforeEach(() => {
		vi.clearAllMocks();
		(config as Record<string, unknown>).ENABLE_MEMORY = false;
		(config as Record<string, unknown>).ENABLE_CONVERSATIONS = false;
		(config as Record<string, unknown>).ENABLE_INSIGHTS = false;
		vi.mocked(getKnowledgeStats).mockResolvedValue({
			total: 0,
			bySourceType: {},
			byContentType: {},
			topTags: [],
			dateRange: { oldest: null, newest: null },
		});
	});

	it('returns only knowledge stats for an empty DB with all features disabled', async () => {
		const stats = await gatherAllStats();
		expect(stats).toEqual({
			knowledge: {
				total: 0,
				bySourceType: {},
				byContentType: {},
				topTags: [],
				dateRange: { oldest: null, newest: null },
			},
		});
		expect(stats).not.toHaveProperty('memory');
		expect(stats).not.toHaveProperty('conversations');
		expect(stats).not.toHaveProperty('insights');
	});

	it('reports a per-scope error object instead of throwing when knowledge fails', async () => {
		vi.mocked(getKnowledgeStats).mockRejectedValue(new Error('db down'));
		const stats = await gatherAllStats();
		expect(stats.knowledge).toEqual({
			error: true,
			message: 'db down',
			code: expect.any(String),
		});
	});
});
