import { beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('../../utils/logger.js', () => ({
	logger: { debug: vi.fn(), info: vi.fn(), warn: vi.fn(), error: vi.fn() },
}));

const pgQuery = vi.hoisted(() =>
	vi.fn(async (_sql: string, _params?: unknown[]) => ({ rows: [] as unknown[], rowCount: 0 })),
);
vi.mock('../pg-client.js', () => ({
	isDatabaseConfigured: () => true,
	pgQuery,
}));

import { hybridSearch } from '../search.js';

beforeEach(() => {
	pgQuery.mockClear();
});

// Positional params: [queryText, embedding, limit, ftw, sw, rrf_k, sourceType, contentType, tags]
describe('hybridSearch SQL params', () => {
	it('calls the 9-arg hybrid_search and defaults filters to null', async () => {
		await hybridSearch({ queryText: 'hello', queryEmbedding: [0.1, 0.2] });

		expect(pgQuery).toHaveBeenCalledTimes(1);
		const [sql, params] = pgQuery.mock.calls[0];
		expect(sql).toContain('hybrid_search($1, $2::vector, $3, $4, $5, $6, $7, $8, $9)');
		expect(params?.[1]).toBe(JSON.stringify([0.1, 0.2]));
		expect(params?.[5]).toBe(60); // rrf_k passed explicitly to reach the filter args
		expect(params?.[6]).toBeNull(); // sourceType
		expect(params?.[7]).toBeNull(); // contentType
		expect(params?.[8]).toBeNull(); // tags
	});

	it('forwards sourceType/contentType and serializes tags to a JSONB array', async () => {
		await hybridSearch({
			queryText: 'hello',
			queryEmbedding: [0.1],
			sourceType: 'file',
			contentType: 'email',
			tags: ['a', 'b'],
		});

		const params = pgQuery.mock.calls[0][1];
		expect(params?.[6]).toBe('file');
		expect(params?.[7]).toBe('email');
		expect(params?.[8]).toBe(JSON.stringify(['a', 'b']));
	});

	it('sends null (not an empty array) when tags is empty', async () => {
		await hybridSearch({ queryText: 'hello', queryEmbedding: [0.1], tags: [] });

		const params = pgQuery.mock.calls[0][1];
		expect(params?.[8]).toBeNull();
	});
});
