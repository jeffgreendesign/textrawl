import { Router, type Router as RouterType } from 'express';
import { isSupabaseConfigured } from '../db/client.js';
import { getInsightStats, getInsights, updateInsightStatus } from '../db/insights.js';
import type { InsightStatus, InsightType } from '../db/insights.js';
import { config } from '../utils/config.js';
import { logger } from '../utils/logger.js';
import { bearerAuth } from './middleware/auth.js';

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
		if (!isSupabaseConfigured()) {
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
		if (!isSupabaseConfigured()) {
			res.status(503).json({ error: 'Database not available' });
			return;
		}

		const status = req.query.status as InsightStatus | undefined;
		const insightType = req.query.type as InsightType | undefined;
		const limit = Math.min(parseInt(req.query.limit as string, 10) || 20, 100);
		const offset = parseInt(req.query.offset as string, 10) || 0;

		const insights = await getInsights({ status, insightType, limit, offset });
		res.json({ insights, total: insights.length });
	} catch (error) {
		logger.error('REST list insights failed', {
			error: error instanceof Error ? error.message : String(error),
		});
		res.status(500).json({ error: 'Failed to list insights' });
	}
});

// ---------------------------------------------------------------------------
// PATCH /api/insights/:id/status — update insight status
// ---------------------------------------------------------------------------

insightRoutes.patch('/insights/:id/status', bearerAuth, async (req, res) => {
	try {
		if (!isSupabaseConfigured()) {
			res.status(503).json({ error: 'Database not available' });
			return;
		}

		const { status } = req.body as { status?: string };
		if (!status || !['new', 'seen', 'dismissed'].includes(status)) {
			res.status(400).json({ error: 'Valid status required: new, seen, or dismissed' });
			return;
		}

		await updateInsightStatus(req.params.id, status as InsightStatus);
		res.json({ ok: true });
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
