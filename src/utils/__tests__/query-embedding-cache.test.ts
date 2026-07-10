import { beforeEach, describe, expect, it, vi } from 'vitest';

// Mutable mock so tests can flip the active provider and assert key isolation.
// `vi.hoisted` lets the (hoisted) mock factory reference it safely.
const mockConfig = vi.hoisted(() => ({
	EMBEDDING_PROVIDER: 'openai' as 'openai' | 'ollama' | 'google',
	OLLAMA_MODEL: 'nomic-embed-text',
	GOOGLE_EMBEDDING_MODEL: 'gemini-embedding-2-preview',
}));

vi.mock('../config.js', () => ({ config: mockConfig }));
// Stub the embeddings module so importing the cache never pulls in provider SDKs;
// every test injects its own `embed`, so the default is unused.
vi.mock('../../services/embeddings.js', () => ({ generateEmbedding: vi.fn() }));

import { createQueryEmbeddingCache } from '../query-embedding-cache.js';

beforeEach(() => {
	mockConfig.EMBEDDING_PROVIDER = 'openai';
});

/** Deterministic embed stub: each call returns a distinct 1-element vector. */
function makeEmbed() {
	let n = 0;
	return vi.fn(async (_text: string) => [++n]);
}

describe('createQueryEmbeddingCache', () => {
	it('serves repeated queries from cache (single embed call)', async () => {
		const embed = makeEmbed();
		const cache = createQueryEmbeddingCache({ embed });

		const first = await cache.get('hello');
		const second = await cache.get('hello');

		expect(embed).toHaveBeenCalledTimes(1);
		expect(second).toEqual(first);
		expect(cache.size).toBe(1);
	});

	it('embeds distinct queries separately', async () => {
		const embed = makeEmbed();
		const cache = createQueryEmbeddingCache({ embed });

		const a = await cache.get('alpha');
		const b = await cache.get('beta');

		expect(embed).toHaveBeenCalledTimes(2);
		expect(a).not.toEqual(b);
		expect(cache.size).toBe(2);
	});

	it('keys by provider so a provider switch does not reuse a vector', async () => {
		const embed = makeEmbed();
		const cache = createQueryEmbeddingCache({ embed });

		await cache.get('same');
		mockConfig.EMBEDDING_PROVIDER = 'ollama';
		await cache.get('same');

		expect(embed).toHaveBeenCalledTimes(2);
		expect(cache.size).toBe(2);
	});

	it('evicts the least-recently-used entry past max', async () => {
		const embed = makeEmbed();
		const cache = createQueryEmbeddingCache({ embed, max: 2 });

		await cache.get('a'); // [1]
		await cache.get('b'); // [2]
		await cache.get('a'); // refresh recency of 'a' (still cached, no embed)
		await cache.get('c'); // [3] -> evicts 'b' (now LRU)

		expect(cache.size).toBe(2);
		expect(embed).toHaveBeenCalledTimes(3);

		await cache.get('a'); // still cached
		expect(embed).toHaveBeenCalledTimes(3);

		await cache.get('b'); // was evicted -> re-embed
		expect(embed).toHaveBeenCalledTimes(4);
	});

	it('expires entries after the TTL', async () => {
		const embed = makeEmbed();
		let clock = 1_000;
		const cache = createQueryEmbeddingCache({ embed, ttlMs: 100, now: () => clock });

		await cache.get('q');
		clock += 50;
		await cache.get('q'); // within TTL -> cached
		expect(embed).toHaveBeenCalledTimes(1);

		clock += 100; // now past expiresAt
		await cache.get('q'); // expired -> re-embed
		expect(embed).toHaveBeenCalledTimes(2);
	});

	it('does not cache a failed embed', async () => {
		const embed = vi
			.fn<(text: string) => Promise<number[]>>()
			.mockRejectedValueOnce(new Error('provider down'))
			.mockResolvedValueOnce([42]);
		const cache = createQueryEmbeddingCache({ embed });

		await expect(cache.get('q')).rejects.toThrow('provider down');
		expect(cache.size).toBe(0);

		const value = await cache.get('q'); // retries, succeeds, now cached
		expect(value).toEqual([42]);
		expect(cache.size).toBe(1);
		expect(embed).toHaveBeenCalledTimes(2);
	});

	it('clear() empties the cache', async () => {
		const embed = makeEmbed();
		const cache = createQueryEmbeddingCache({ embed });

		await cache.get('x');
		expect(cache.size).toBe(1);
		cache.clear();
		expect(cache.size).toBe(0);
	});
});
