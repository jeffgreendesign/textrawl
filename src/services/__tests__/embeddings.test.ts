import { describe, expect, it, vi } from 'vitest';

// Isolate the batcher from env-dependent config/SDK init.
vi.mock('../../utils/config.js', () => ({
	config: { EMBEDDING_PROVIDER: 'openai' },
}));
vi.mock('../../utils/logger.js', () => ({
	logger: { debug: vi.fn(), info: vi.fn(), warn: vi.fn(), error: vi.fn() },
}));

import { buildTokenBoundedBatches } from '../embeddings.js';

describe('buildTokenBoundedBatches', () => {
	it('splits by item count', () => {
		const texts = Array.from({ length: 250 }, () => 'short');
		const batches = buildTokenBoundedBatches(texts, 100, 1_000_000, 3);
		expect(batches).toHaveLength(3);
		expect(batches[0]).toHaveLength(100);
		expect(batches[2]).toHaveLength(50);
	});

	it('splits by aggregate token ceiling even when item count is fine', () => {
		// 10 inputs of 90k chars each → ~30k est tokens each (chars/3). With a 100k
		// token ceiling, no batch should exceed ~3 of them.
		const texts = Array.from({ length: 10 }, () => 'x'.repeat(90_000));
		const batches = buildTokenBoundedBatches(texts, 2048, 100_000, 3);

		expect(batches.length).toBeGreaterThan(1);
		for (const batch of batches) {
			const tokens = batch.reduce((sum, t) => sum + Math.ceil(t.length / 3), 0);
			// A batch may exceed the ceiling only when it holds a single oversized
			// item (can't be split further); otherwise it must stay under.
			if (batch.length > 1) {
				expect(tokens).toBeLessThanOrEqual(100_000);
			}
		}
	});

	it('keeps a single oversized input as its own batch (never drops it)', () => {
		const texts = ['a'.repeat(500_000)];
		const batches = buildTokenBoundedBatches(texts, 2048, 100_000, 3);
		expect(batches).toHaveLength(1);
		expect(batches[0]).toHaveLength(1);
	});

	it('returns no batches for empty input', () => {
		expect(buildTokenBoundedBatches([], 100, 100_000, 3)).toEqual([]);
	});
});
