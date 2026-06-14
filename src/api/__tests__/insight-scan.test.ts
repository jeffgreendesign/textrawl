/**
 * Tests for POST /api/insights/scan — the synchronous insight-scan endpoint that
 * an external scheduler drives on a cron. Covers the output-schema smoke case
 * (empty DB → zeroed result shape), the not-configured and validation guards, and
 * that an `insight_discovered` event is emitted only when insights are created.
 *
 * Every collaborator (auth, DB, the scan service, events) is mocked so the test is
 * hermetic — no Postgres, OpenAI, Anthropic, or network.
 */
import express from 'express';
import request from 'supertest';
import { beforeEach, describe, expect, it, vi } from 'vitest';

// --- Mocks (must be declared before imports) ---

vi.mock('../../utils/config.js', () => ({
	config: { ENABLE_INSIGHTS: true },
}));

vi.mock('../../utils/logger.js', () => ({
	logger: { debug: vi.fn(), info: vi.fn(), warn: vi.fn(), error: vi.fn() },
}));

vi.mock('../middleware/auth.js', () => ({
	bearerAuth: (_req: unknown, _res: unknown, next: () => void) => next(),
	insightScanAuth: (_req: unknown, _res: unknown, next: () => void) => next(),
}));

vi.mock('../../db/pg-client.js', () => ({
	isDatabaseConfigured: vi.fn(() => true),
}));

// db/insights is imported at the top of insight-routes for the other routes.
vi.mock('../../db/insights.js', () => ({
	getInsightStats: vi.fn(async () => ({ total: 0 })),
	getInsights: vi.fn(async () => []),
	updateInsightStatus: vi.fn(async () => undefined),
}));

vi.mock('../../services/insight-analysis.js', () => ({
	runInsightScan: vi.fn(async () => ({
		insightsCreated: 0,
		chunksAnalyzed: 0,
		batchId: '00000000-0000-0000-0000-000000000000',
	})),
}));

vi.mock('../../services/events.js', () => ({
	events: { emit: vi.fn() },
}));

// --- Imports (after mocks) ---

import { isDatabaseConfigured } from '../../db/pg-client.js';
import { events } from '../../services/events.js';
import { runInsightScan } from '../../services/insight-analysis.js';
import { insightRoutes } from '../insight-routes.js';

function makeApp() {
	const app = express();
	app.use(express.json());
	app.use('/api', insightRoutes);
	return app;
}

describe('POST /api/insights/scan', () => {
	beforeEach(() => {
		vi.clearAllMocks();
		vi.mocked(isDatabaseConfigured).mockReturnValue(true);
		vi.mocked(runInsightScan).mockResolvedValue({
			insightsCreated: 0,
			chunksAnalyzed: 0,
			batchId: '00000000-0000-0000-0000-000000000000',
		});
	});

	it('returns the zeroed result shape on an empty DB (output-schema smoke)', async () => {
		const res = await request(makeApp()).post('/api/insights/scan').send({});

		expect(res.status).toBe(200);
		expect(res.body).toEqual({
			insightsCreated: 0,
			chunksAnalyzed: 0,
			batchId: '00000000-0000-0000-0000-000000000000',
		});
		// No insights created → no event emitted.
		expect(vi.mocked(events.emit)).not.toHaveBeenCalled();
	});

	it('passes fullScan and maxChunks through to runInsightScan', async () => {
		await request(makeApp()).post('/api/insights/scan').send({ fullScan: true, maxChunks: 500 });

		expect(vi.mocked(runInsightScan)).toHaveBeenCalledWith({ fullScan: true, maxChunks: 500 });
	});

	it('emits insight_discovered when insights are created', async () => {
		vi.mocked(runInsightScan).mockResolvedValueOnce({
			insightsCreated: 3,
			chunksAnalyzed: 42,
			batchId: 'batch-1',
		});

		const res = await request(makeApp()).post('/api/insights/scan').send({});

		expect(res.status).toBe(200);
		expect(res.body.insightsCreated).toBe(3);
		expect(vi.mocked(events.emit)).toHaveBeenCalledWith('insight_discovered', {
			insightCount: 3,
			batchId: 'batch-1',
		});
	});

	it('returns 503 when the database is not configured', async () => {
		vi.mocked(isDatabaseConfigured).mockReturnValue(false);

		const res = await request(makeApp()).post('/api/insights/scan').send({});

		expect(res.status).toBe(503);
		expect(vi.mocked(runInsightScan)).not.toHaveBeenCalled();
	});

	it('returns 400 for an out-of-range maxChunks', async () => {
		const res = await request(makeApp()).post('/api/insights/scan').send({ maxChunks: 99999 });

		expect(res.status).toBe(400);
		expect(vi.mocked(runInsightScan)).not.toHaveBeenCalled();
	});

	it('returns 500 when the scan throws', async () => {
		vi.mocked(runInsightScan).mockRejectedValueOnce(new Error('boom'));

		const res = await request(makeApp()).post('/api/insights/scan').send({});

		expect(res.status).toBe(500);
	});
});
