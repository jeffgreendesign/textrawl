import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { Chunk } from '../chunker.js';

vi.mock('../../utils/config.js', () => ({ config: { EMBED_WINDOW_CONCURRENCY: 3 } }));

const createChunks = vi.hoisted(() => vi.fn(async (_recs: unknown[]) => {}));
vi.mock('../../db/chunks.js', () => ({ createChunks }));

import { embedAndStoreChunks } from '../embed-store.js';

type StoredChunk = { chunkIndex: number; content: string; embedding: number[] };

function makeChunks(n: number): Chunk[] {
	return Array.from(
		{ length: n },
		(_, i) => ({ index: i, content: String(i), startOffset: i, endOffset: i + 1 }) as Chunk,
	);
}

beforeEach(() => {
	createChunks.mockReset();
	createChunks.mockResolvedValue(undefined);
});

describe('embedAndStoreChunks', () => {
	it('pairs each chunk with its own embedding across many concurrent windows', async () => {
		const stored: StoredChunk[] = [];
		createChunks.mockImplementation(async (recs) => {
			stored.push(...(recs as StoredChunk[]));
		});

		// 300 chunks -> 3 windows of 128/128/44, run with concurrency 3.
		// Embedding for chunk i is [i] (content is String(i)).
		const generateEmbeddings = async (texts: string[]) => texts.map((t) => [Number(t)]);

		await embedAndStoreChunks('doc-1', makeChunks(300), generateEmbeddings);

		expect(stored).toHaveLength(300);
		// Every stored row's embedding must match its own chunkIndex — proves no
		// cross-window misalignment under concurrency.
		for (const rec of stored) {
			expect(rec.embedding[0]).toBe(rec.chunkIndex);
		}
		// All indices 0..299 present exactly once.
		const indices = stored.map((r) => r.chunkIndex).sort((a, b) => a - b);
		expect(indices).toEqual(Array.from({ length: 300 }, (_, i) => i));
	});

	it('throws on an embedding-count mismatch and does not store the window', async () => {
		const generateEmbeddings = async (texts: string[]) => texts.slice(1).map(() => [0]); // short by one

		await expect(embedAndStoreChunks('doc-2', makeChunks(10), generateEmbeddings)).rejects.toThrow(
			/Embedding count mismatch/,
		);
		// The guard must fire before any rows are persisted.
		expect(createChunks).not.toHaveBeenCalled();
	});
});
