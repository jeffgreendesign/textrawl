/**
 * Tests for dedupeInsights — the near-duplicate filter used by the live scan and the
 * backfill CLI. An insight is dropped when its embedding is >= threshold cosine-similar
 * to (a) an insight already in the DB or (b) an earlier insight kept in the same batch.
 */
import { beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('../../db/insights.js', () => ({
	searchInsights: vi.fn(async () => []),
	createInsights: vi.fn(),
	setInsightQueueProcessing: vi.fn(),
}));

vi.mock('../../utils/logger.js', () => ({
	logger: { debug: vi.fn(), info: vi.fn(), warn: vi.fn(), error: vi.fn() },
}));

import { searchInsights } from '../../db/insights.js';
import { dedupeInsights } from '../insight-analysis.js';

function insight(embedding: number[] | undefined, title = 't') {
	return {
		insightType: 'outlier' as const,
		title,
		summary: 's',
		evidence: [],
		entities: [],
		embedding,
		batchId: 'b',
	};
}

describe('dedupeInsights', () => {
	beforeEach(() => {
		vi.clearAllMocks();
		vi.mocked(searchInsights).mockResolvedValue([]);
	});

	it('drops an in-batch near-duplicate (identical embeddings)', async () => {
		const kept = await dedupeInsights([insight([1, 0, 0], 'a'), insight([1, 0, 0], 'b')], 0.92);
		expect(kept).toHaveLength(1);
		expect(kept[0].title).toBe('a');
	});

	it('keeps distinct insights', async () => {
		const kept = await dedupeInsights([insight([1, 0, 0], 'a'), insight([0, 1, 0], 'b')], 0.92);
		expect(kept).toHaveLength(2);
	});

	it('drops a candidate that matches an existing DB insight', async () => {
		// @ts-expect-error — searchInsights rows carry a score from insight_semantic_search
		vi.mocked(searchInsights).mockResolvedValue([{ score: 0.97 }]);
		const kept = await dedupeInsights([insight([1, 0, 0])], 0.92);
		expect(kept).toHaveLength(0);
	});

	it('keeps a candidate whose best DB match is below threshold', async () => {
		// @ts-expect-error — minimal row with just the score field
		vi.mocked(searchInsights).mockResolvedValue([{ score: 0.5 }]);
		const kept = await dedupeInsights([insight([1, 0, 0])], 0.92);
		expect(kept).toHaveLength(1);
	});

	it('always keeps insights without an embedding', async () => {
		const kept = await dedupeInsights([insight(undefined), insight(undefined)], 0.92);
		expect(kept).toHaveLength(2);
		expect(vi.mocked(searchInsights)).not.toHaveBeenCalled();
	});

	it('keeps the candidate when the DB lookup throws', async () => {
		vi.mocked(searchInsights).mockRejectedValue(new Error('db down'));
		const kept = await dedupeInsights([insight([1, 0, 0])], 0.92);
		expect(kept).toHaveLength(1);
	});
});
