import { describe, expect, it, vi } from 'vitest';

vi.mock('../../utils/logger.js', () => ({
	logger: { debug: vi.fn(), info: vi.fn(), warn: vi.fn(), error: vi.fn() },
}));

import { embedBatchesConcurrently } from '../embeddings.js';

/** Yield the microtask queue N times without real timers. */
async function ticks(n: number): Promise<void> {
	for (let i = 0; i < n; i++) {
		await Promise.resolve();
	}
}

describe('embedBatchesConcurrently', () => {
	it('preserves input order even when later batches resolve first', async () => {
		const batches = [['0'], ['1'], ['2'], ['3']];

		// Earlier batches wait longer, so completion order is the reverse of input.
		const embedBatch = async (batch: string[]): Promise<number[][]> => {
			const n = Number(batch[0]);
			await ticks(batches.length - n);
			return [[n]];
		};

		const result = await embedBatchesConcurrently(batches, embedBatch, 4);

		expect(result).toEqual([[0], [1], [2], [3]]);
	});

	it('never exceeds the concurrency bound', async () => {
		const batches = Array.from({ length: 6 }, (_, i) => [String(i)]);
		let inFlight = 0;
		let maxInFlight = 0;

		const embedBatch = async (batch: string[]): Promise<number[][]> => {
			inFlight++;
			maxInFlight = Math.max(maxInFlight, inFlight);
			await ticks(3);
			inFlight--;
			return [[Number(batch[0])]];
		};

		const result = await embedBatchesConcurrently(batches, embedBatch, 2);

		expect(maxInFlight).toBe(2);
		expect(result).toEqual([[0], [1], [2], [3], [4], [5]]);
	});

	it('runs serially when concurrency is 1', async () => {
		const batches = [['a'], ['b']];
		let inFlight = 0;
		let maxInFlight = 0;

		const embedBatch = async (): Promise<number[][]> => {
			inFlight++;
			maxInFlight = Math.max(maxInFlight, inFlight);
			await ticks(2);
			inFlight--;
			return [[1]];
		};

		await embedBatchesConcurrently(batches, embedBatch, 1);

		expect(maxInFlight).toBe(1);
	});
});
