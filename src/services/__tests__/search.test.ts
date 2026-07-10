import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { SearchResult } from '../../types/database.js';

vi.mock('../../utils/logger.js', () => ({
	logger: { debug: vi.fn(), info: vi.fn(), warn: vi.fn(), error: vi.fn() },
}));
vi.mock('../../utils/config.js', () => ({
	config: { ENABLE_MEMORY: false, ENABLE_CONVERSATIONS: false },
}));
vi.mock('../../db/pg-client.js', () => ({ isDatabaseConfigured: () => true }));
vi.mock('../embeddings.js', () => ({ isEmbeddingsConfigured: () => true }));
vi.mock('../../utils/query-embedding-cache.js', () => ({
	getQueryEmbedding: vi.fn(async () => [0.1, 0.2, 0.3]),
}));

const hybridSearch = vi.hoisted(() => vi.fn(async (): Promise<SearchResult[]> => []));
vi.mock('../../db/search.js', () => ({ hybridSearch }));
vi.mock('../../db/memory-search.js', () => ({ hybridMemorySearch: vi.fn(async () => []) }));
vi.mock('../../db/conversation-search.js', () => ({
	hybridConversationSearch: vi.fn(async () => []),
}));

import { unifiedSearch } from '../search.js';

function row(overrides: Partial<SearchResult> = {}): SearchResult {
	return {
		chunk_id: 'c1',
		document_id: 'd1',
		content: 'body',
		document_title: 'Title',
		source_type: 'file',
		document_metadata: {},
		score: 0.9,
		...overrides,
	};
}

beforeEach(() => {
	hybridSearch.mockReset();
	hybridSearch.mockResolvedValue([]);
});

describe('unifiedSearch filter pushdown', () => {
	it('forwards sourceType/contentType/tags to hybridSearch and does not over-fetch', async () => {
		await unifiedSearch({
			query: 'q',
			limit: 10,
			sourceType: 'file',
			contentType: 'email',
			tags: ['x'],
		});

		expect(hybridSearch).toHaveBeenCalledWith(
			expect.objectContaining({
				sourceType: 'file',
				contentType: 'email',
				tags: ['x'],
				limit: 10, // no minScore -> no limit*3 over-fetch
			}),
		);
	});

	it('does not re-filter in JS (trusts the SQL result)', async () => {
		// Row whose metadata would FAIL a JS content_type filter; it must still be
		// returned, proving the service no longer post-filters categorically.
		hybridSearch.mockResolvedValue([row({ document_metadata: { content_type: 'webpage' } })]);

		const res = await unifiedSearch({ query: 'q', contentType: 'email' });

		expect(res.results).toHaveLength(1);
		expect(res.results[0].documentId).toBe('d1');
	});

	it('widens the fetch and still applies minScore in JS', async () => {
		hybridSearch.mockResolvedValue([row({ score: 0.9 }), row({ chunk_id: 'c2', score: 0.1 })]);

		const res = await unifiedSearch({ query: 'q', limit: 10, minScore: 0.5 });

		expect(hybridSearch).toHaveBeenCalledWith(expect.objectContaining({ limit: 30 }));
		expect(res.results).toHaveLength(1);
		expect(res.results[0].score).toBe(0.9);
	});
});
