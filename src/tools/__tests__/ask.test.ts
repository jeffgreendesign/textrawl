import { beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('../../utils/config.js', () => ({
	config: {
		COMPACT_RESPONSES: false,
		ENABLE_MEMORY: true,
		ENABLE_CONVERSATIONS: true,
		ENABLE_INSIGHTS: true,
	},
}));
vi.mock('../../utils/logger.js', () => ({
	logger: { debug: vi.fn(), info: vi.fn(), warn: vi.fn(), error: vi.fn() },
}));
vi.mock('../../db/pg-client.js', () => ({ isDatabaseConfigured: vi.fn(() => true) }));
vi.mock('../../services/embeddings.js', () => ({
	generateEmbedding: vi.fn(async () => [0.1, 0.2]),
	isEmbeddingsConfigured: vi.fn(() => true),
}));
vi.mock('../../db/search.js', () => ({ hybridSearch: vi.fn(async () => []) }));
vi.mock('../../db/memory-search.js', () => ({ hybridMemorySearch: vi.fn(async () => []) }));
vi.mock('../../db/conversation-search.js', () => ({
	hybridConversationSearch: vi.fn(async () => []),
}));
vi.mock('../../db/insights.js', () => ({ searchInsights: vi.fn(async () => []) }));

import { hybridConversationSearch } from '../../db/conversation-search.js';
import { searchInsights } from '../../db/insights.js';
import { hybridMemorySearch } from '../../db/memory-search.js';
import { hybridSearch } from '../../db/search.js';
import { registerAskTool } from '../ask.js';

type ToolHandler = (args: Record<string, unknown>, extra: unknown) => Promise<unknown>;

function createHandler(): (args: Record<string, unknown>) => Promise<unknown> {
	let handler: ToolHandler | undefined;
	const fakeServer = {
		registerTool: (_n: string, _o: unknown, cb: ToolHandler) => {
			handler = cb;
		},
	};
	registerAskTool(fakeServer as never);
	if (!handler) throw new Error('registerAskTool did not register a handler');
	const h = handler;
	return (args) => h(args, {});
}

function parse(result: unknown): Record<string, unknown> {
	const r = result as { content: Array<{ text: string }> };
	return JSON.parse(r.content[0].text);
}

describe('ask tool — audience enforcement', () => {
	let ask: ReturnType<typeof createHandler>;

	beforeEach(() => {
		vi.clearAllMocks();
		ask = createHandler();
	});

	it('searches all sources for the private owner (scope=auto)', async () => {
		const res = parse(
			await ask({ question: 'q', scope: 'auto', audience: 'private_jeff', limit: 5 }),
		);
		expect(hybridSearch).toHaveBeenCalled();
		expect(hybridMemorySearch).toHaveBeenCalled();
		expect(hybridConversationSearch).toHaveBeenCalled();
		expect(searchInsights).toHaveBeenCalled();
		expect(res.sensitivity).toBe('private');
	});

	it('excludes private sources for a family-shared audience', async () => {
		const res = parse(
			await ask({ question: 'q', scope: 'auto', audience: 'family_shared', limit: 5 }),
		);
		expect(hybridSearch).toHaveBeenCalled();
		expect(hybridMemorySearch).not.toHaveBeenCalled();
		expect(hybridConversationSearch).not.toHaveBeenCalled();
		expect(searchInsights).not.toHaveBeenCalled();
		expect(res.sensitivity).toBe('family');
		expect(Array.isArray(res.warnings)).toBe(true);
		expect((res.warnings as string[]).length).toBeGreaterThan(0);
	});

	it('honors allowCrossProfile for a family-shared audience', async () => {
		await ask({
			question: 'q',
			scope: 'auto',
			audience: 'family_shared',
			allowCrossProfile: true,
			limit: 5,
		});
		expect(hybridMemorySearch).toHaveBeenCalled();
		expect(hybridConversationSearch).toHaveBeenCalled();
	});
});
