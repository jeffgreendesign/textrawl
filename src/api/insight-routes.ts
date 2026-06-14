import { Router, type Router as RouterType } from 'express';
import { getInsightStats, getInsights, updateInsightStatus } from '../db/insights.js';
import type { InsightStatus, InsightType } from '../db/insights.js';
import { isDatabaseConfigured } from '../db/pg-client.js';
import { events } from '../services/events.js';
import { config } from '../utils/config.js';
import { logger } from '../utils/logger.js';
import { bearerAuth, insightScanAuth } from './middleware/auth.js';

export const insightRoutes: RouterType = Router();

// ---------------------------------------------------------------------------
// Feature gate — all insight routes require ENABLE_INSIGHTS
// ---------------------------------------------------------------------------

insightRoutes.use('/insights', (_req, res, next) => {
	if (!config.ENABLE_INSIGHTS) {
		res.status(404).json({ error: 'Insights feature is not enabled' });
		return;
	}
	next();
});

// ---------------------------------------------------------------------------
// GET /api/insights/stats — insight statistics
// Must be before /:id to avoid route conflict
// ---------------------------------------------------------------------------

insightRoutes.get('/insights/stats', bearerAuth, async (_req, res) => {
	try {
		if (!isDatabaseConfigured()) {
			res.status(503).json({ error: 'Database not available' });
			return;
		}

		const stats = await getInsightStats();
		res.json(stats);
	} catch (error) {
		logger.error('REST insight stats failed', {
			error: error instanceof Error ? error.message : String(error),
		});
		res.status(500).json({ error: 'Failed to get insight stats' });
	}
});

// ---------------------------------------------------------------------------
// GET /api/insights — list insights with optional status/type filters
// ---------------------------------------------------------------------------

insightRoutes.get('/insights', bearerAuth, async (req, res) => {
	try {
		if (!isDatabaseConfigured()) {
			res.status(503).json({ error: 'Database not available' });
			return;
		}

		const status = req.query.status as InsightStatus | undefined;
		const insightType = req.query.type as InsightType | undefined;
		const limit = Math.min(parseInt(req.query.limit as string, 10) || 20, 100);
		const offset = parseInt(req.query.offset as string, 10) || 0;

		const [insights, stats] = await Promise.all([
			getInsights({ status, insightType, limit, offset }),
			getInsightStats(),
		]);
		res.json({ insights, total: stats.total });
	} catch (error) {
		logger.error('REST list insights failed', {
			error: error instanceof Error ? error.message : String(error),
		});
		res.status(500).json({ error: 'Failed to list insights' });
	}
});

// ---------------------------------------------------------------------------
// POST /api/insights/scan — run an insight scan synchronously
//
// Runs inside the request so it survives on CPU-throttled / scale-to-zero
// serverless (unlike fire-and-forget background work). Intended to be driven by
// an external scheduler (e.g. Cloud Scheduler) hitting this endpoint on a cron.
// ---------------------------------------------------------------------------

insightRoutes.post('/insights/scan', insightScanAuth, async (req, res) => {
	try {
		if (!isDatabaseConfigured()) {
			res.status(503).json({ error: 'Database not available' });
			return;
		}

		const body = (req.body ?? {}) as { fullScan?: boolean; maxChunks?: number };
		const fullScan = body.fullScan === true;
		let maxChunks: number | undefined;
		if (body.maxChunks !== undefined) {
			const parsed = Number(body.maxChunks);
			if (!Number.isFinite(parsed) || parsed < 10 || parsed > 1000) {
				res.status(400).json({ error: 'maxChunks must be an integer between 10 and 1000' });
				return;
			}
			maxChunks = Math.floor(parsed);
		}

		const { runInsightScan } = await import('../services/insight-analysis.js');
		const result = await runInsightScan({ fullScan, maxChunks });

		if (result.insightsCreated > 0) {
			events.emit('insight_discovered', {
				insightCount: result.insightsCreated,
				batchId: result.batchId,
			});
		}

		res.json(result);
	} catch (error) {
		logger.error('REST insight scan failed', {
			error: error instanceof Error ? error.message : String(error),
		});
		res.status(500).json({ error: 'Failed to run insight scan' });
	}
});

// ---------------------------------------------------------------------------
// PATCH /api/insights/:id/status — update insight status
// ---------------------------------------------------------------------------

insightRoutes.patch<{ id: string }>('/insights/:id/status', bearerAuth, async (req, res) => {
	try {
		if (!isDatabaseConfigured()) {
			res.status(503).json({ error: 'Database not available' });
			return;
		}

		const { status } = req.body as { status?: string };
		if (!status || !['new', 'seen', 'dismissed'].includes(status)) {
			res.status(400).json({ error: 'Valid status required: new, seen, or dismissed' });
			return;
		}

		await updateInsightStatus(req.params.id, status as InsightStatus);
		res.json({ id: req.params.id, status });
	} catch (error) {
		const message = error instanceof Error ? error.message : String(error);
		if (message.includes('not found')) {
			res.status(404).json({ error: 'Insight not found' });
			return;
		}
		logger.error('REST update insight status failed', { error: message });
		res.status(500).json({ error: 'Failed to update insight status' });
	}
});
