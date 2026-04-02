import { beforeEach, describe, expect, it, vi } from 'vitest';

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

import { getInsightStats, validateInsightSchema } from '../../db/insights.js';
import { isDatabaseConfigured } from '../../db/pg-client.js';
import { getKnowledgeStats } from '../../db/stats.js';
import { registerStatsTools } from '../../tools/stats.js';
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

	it('handles database error gracefully', async () => {
		vi.mocked(getKnowledgeStats).mockRejectedValue(new Error('connection refused'));
		const result = (await callStats('knowledge')) as {
			isError?: boolean;
			content: { text: string }[];
		};
		expect(result.isError).toBe(true);
		expect(result.content[0].text).toContain('connection refused');
	});
});
