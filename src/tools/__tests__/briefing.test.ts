import { beforeEach, describe, expect, it, vi } from 'vitest';

// --- Mocks (must be declared before imports) ---

vi.mock('../../utils/config.js', () => ({
	config: {
		COMPACT_RESPONSES: false,
		ENABLE_INSIGHTS: false,
	},
}));

vi.mock('../../utils/logger.js', () => ({
	logger: { debug: vi.fn(), info: vi.fn(), warn: vi.fn(), error: vi.fn() },
}));

vi.mock('../../db/pg-client.js', () => ({
	isDatabaseConfigured: vi.fn(() => true),
}));

vi.mock('../../db/documents.js', () => ({
	listDocuments: vi.fn(),
}));

vi.mock('../../db/insights.js', () => ({
	getInsights: vi.fn(),
}));

// --- Imports ---

import { listDocuments } from '../../db/documents.js';
import { getInsights } from '../../db/insights.js';
import { isDatabaseConfigured } from '../../db/pg-client.js';
import { config } from '../../utils/config.js';
import { registerBriefingTool } from '../briefing.js';

// --- Helpers ---

type ToolHandler = (
	args: { includeOnThisDay: boolean; recentDays: number },
	extra: unknown,
) => Promise<unknown>;

function createHandler(): (includeOnThisDay: boolean, recentDays: number) => Promise<unknown> {
	let handler: ToolHandler | undefined;

	const fakeServer = {
		registerTool: (_name: string, _opts: unknown, cb: ToolHandler) => {
			handler = cb;
		},
	};

	registerBriefingTool(fakeServer as never);

	if (!handler) throw new Error('registerBriefingTool did not register a handler');
	const h = handler;
	return (includeOnThisDay: boolean, recentDays: number) => h({ includeOnThisDay, recentDays }, {});
}

// --- Fixtures ---

function makeDoc(
	overrides: Partial<{ id: string; title: string; source_type: string; created_at: string }> = {},
) {
	return {
		id: overrides.id ?? 'doc-1',
		title: overrides.title ?? 'Test Doc',
		source_type: (overrides.source_type ?? 'file') as 'note' | 'file' | 'url',
		source_url: null,
		file_path: null,
		raw_content: 'test content',
		metadata: {},
		created_at: overrides.created_at ?? new Date().toISOString(),
		updated_at: overrides.created_at ?? new Date().toISOString(),
	};
}

// --- Tests ---

describe('daily_briefing tool', () => {
	let callBriefing: ReturnType<typeof createHandler>;

	beforeEach(() => {
		vi.clearAllMocks();
		vi.mocked(isDatabaseConfigured).mockReturnValue(true);
		(config as Record<string, unknown>).ENABLE_INSIGHTS = false;
		(config as Record<string, unknown>).COMPACT_RESPONSES = false;

		// Default: empty DB
		vi.mocked(listDocuments).mockResolvedValue({ documents: [], total: 0 });

		callBriefing = createHandler();
	});

	it('returns config error when database is not configured', async () => {
		vi.mocked(isDatabaseConfigured).mockReturnValue(false);
		const result = (await callBriefing(true, 7)) as {
			isError?: boolean;
			content: { text: string }[];
		};
		expect(result.isError).toBe(true);
		expect(result.content[0].text).toContain('not configured');
	});

	it('returns happy path with all sections', async () => {
		const recentDoc = makeDoc({ created_at: new Date().toISOString() });
		vi.mocked(listDocuments).mockResolvedValue({
			documents: [recentDoc],
			total: 1,
		});

		const result = (await callBriefing(true, 7)) as {
			content: { text: string }[];
		};
		const parsed = JSON.parse(result.content[0].text);
		expect(parsed.recentAdditions).toBeDefined();
		expect(parsed.recentAdditions.count).toBe(1);
		expect(parsed.onThisDay).toBeDefined();
		expect(parsed.generatedAt).toBeDefined();
	});

	it('returns partial results when recentAdditions fails', async () => {
		// First call (recentAdditions) fails, second call (onThisDay) succeeds
		vi.mocked(listDocuments)
			.mockRejectedValueOnce(new Error('connection lost'))
			.mockResolvedValueOnce({ documents: [], total: 0 });

		const result = (await callBriefing(true, 7)) as {
			content: { text: string }[];
			isError?: boolean;
		};
		// Should NOT be a top-level error
		expect(result.isError).toBeUndefined();
		const parsed = JSON.parse(result.content[0].text);
		expect(parsed.recentAdditions).toEqual({
			error: true,
			message: 'connection lost',
		});
		// onThisDay should still succeed
		expect(parsed.onThisDay).toBeDefined();
		expect(parsed.onThisDay.error).toBeUndefined();
	});

	it('returns partial results when insights fails', async () => {
		(config as { ENABLE_INSIGHTS: boolean }).ENABLE_INSIGHTS = true;
		vi.mocked(getInsights).mockRejectedValue(new Error('insights table missing'));

		const result = (await callBriefing(false, 7)) as {
			content: { text: string }[];
		};
		const parsed = JSON.parse(result.content[0].text);
		// recentAdditions should succeed (empty)
		expect(parsed.recentAdditions.count).toBe(0);
		// newInsights should have error
		expect(parsed.newInsights).toEqual({
			error: true,
			message: 'insights table missing',
		});
	});

	it('returns partial results when onThisDay fails', async () => {
		// First call (recentAdditions) succeeds, second call (onThisDay) fails
		vi.mocked(listDocuments)
			.mockResolvedValueOnce({ documents: [], total: 0 })
			.mockRejectedValueOnce(new Error('timeout'));

		const result = (await callBriefing(true, 7)) as {
			content: { text: string }[];
		};
		const parsed = JSON.parse(result.content[0].text);
		expect(parsed.recentAdditions.count).toBe(0);
		expect(parsed.onThisDay).toEqual({
			error: true,
			message: 'timeout',
		});
	});

	it('skips onThisDay when includeOnThisDay is false', async () => {
		const result = (await callBriefing(false, 7)) as {
			content: { text: string }[];
		};
		const parsed = JSON.parse(result.content[0].text);
		expect(parsed.onThisDay).toBeUndefined();
	});

	it('skips insights when ENABLE_INSIGHTS is false', async () => {
		(config as { ENABLE_INSIGHTS: boolean }).ENABLE_INSIGHTS = false;
		const result = (await callBriefing(false, 7)) as {
			content: { text: string }[];
		};
		const parsed = JSON.parse(result.content[0].text);
		expect(parsed.newInsights).toBeUndefined();
	});

	it('includes insights when enabled and available', async () => {
		(config as { ENABLE_INSIGHTS: boolean }).ENABLE_INSIGHTS = true;
		vi.mocked(getInsights).mockResolvedValue([
			{
				id: 'ins-1',
				insight_type: 'theme',
				title: 'Test Insight',
				summary: 'A test insight summary that could be long',
				status: 'new',
				created_at: new Date().toISOString(),
				source_document_ids: [],
				confidence: 0.8,
			},
		] as never);

		const result = (await callBriefing(false, 7)) as {
			content: { text: string }[];
		};
		const parsed = JSON.parse(result.content[0].text);
		expect(parsed.newInsights.count).toBe(1);
		expect(parsed.newInsights.insights[0].title).toBe('Test Insight');
	});
});
