import { Router, type Router as RouterType } from 'express';
import { z } from 'zod';
import { getDocument, listDocuments } from '../db/documents.js';
import { isDatabaseConfigured } from '../db/pg-client.js';
import { getKnowledgeStats } from '../db/stats.js';
import { unifiedSearch } from '../services/search.js';
import { config } from '../utils/config.js';
import { logger } from '../utils/logger.js';
import { bearerAuth } from './middleware/auth.js';
import { uploadRouter } from './upload.js';

// ---------------------------------------------------------------------------
// Query validation schemas
// ---------------------------------------------------------------------------

const SearchQuerySchema = z.object({
	q: z.string().min(1, 'Query parameter "q" is required'),
	limit: z.coerce.number().int().min(1).max(50).default(10),
	includeMemories: z
		.enum(['true', 'false'])
		.default('false')
		.transform((v) => v === 'true'),
	includeConversations: z
		.enum(['true', 'false'])
		.default('false')
		.transform((v) => v === 'true'),
});

export const apiRoutes: RouterType = Router();

apiRoutes.use(uploadRouter);

// ---------------------------------------------------------------------------
// REST API endpoints for cross-device access (Enhancement 9)
// These are thin wrappers around existing DB functions.
// ---------------------------------------------------------------------------

apiRoutes.get('/search', bearerAuth, async (req, res) => {
	const parsed = SearchQuerySchema.safeParse(req.query);
	if (!parsed.success) {
		res.status(400).json({ error: parsed.error.issues[0].message });
		return;
	}

	try {
		const { q, limit, includeMemories, includeConversations } = parsed.data;
		const response = await unifiedSearch({
			query: q,
			limit,
			includeMemories,
			includeConversations,
		});

		res.json(response);
	} catch (error) {
		const message = error instanceof Error ? error.message : String(error);
		logger.error('REST search failed', { error: message });
		const statusCode =
			error instanceof Error && 'statusCode' in error
				? (error as Error & { statusCode: number }).statusCode
				: 500;
		res.status(statusCode).json({ error: message || 'Search failed' });
	}
});

apiRoutes.get('/documents', bearerAuth, async (req, res) => {
	try {
		if (!isDatabaseConfigured()) {
			res.status(503).json({ error: 'Database not available' });
			return;
		}

		const limit = Math.min(parseInt(req.query.limit as string, 10) || 20, 100);
		const offset = parseInt(req.query.offset as string, 10) || 0;
		const result = await listDocuments({ limit, offset });

		res.json(result);
	} catch (error) {
		logger.error('REST list documents failed', {
			error: error instanceof Error ? error.message : String(error),
		});
		res.status(500).json({ error: 'Failed to list documents' });
	}
});

apiRoutes.get('/documents/:id', bearerAuth, async (req, res) => {
	try {
		if (!isDatabaseConfigured()) {
			res.status(503).json({ error: 'Database not available' });
			return;
		}

		const doc = await getDocument(req.params.id);
		if (!doc) {
			res.status(404).json({ error: 'Document not found' });
			return;
		}

		res.json(doc);
	} catch (error) {
		logger.error('REST get document failed', {
			error: error instanceof Error ? error.message : String(error),
		});
		res.status(500).json({ error: 'Failed to get document' });
	}
});

apiRoutes.get('/stats', bearerAuth, async (_req, res) => {
	try {
		if (!isDatabaseConfigured()) {
			res.status(503).json({ error: 'Database not available' });
			return;
		}

		const knowledge = await getKnowledgeStats();

		const counts: Record<string, unknown> = { documents: knowledge.total };

		if (config.ENABLE_MEMORY) {
			try {
				const { getMemoryStats } = await import('../db/memory-search.js');
				const mem = await getMemoryStats();
				counts.memories = {
					entities: mem.totalEntities,
					observations: mem.totalObservations,
					relations: mem.totalRelations,
					entityTypeCounts: mem.entityTypeCounts,
				};
			} catch {
				counts.memories = null;
			}
		}

		if (config.ENABLE_CONVERSATIONS) {
			try {
				const { getConversationSearchStats } = await import('../db/conversation-search.js');
				const conv = await getConversationSearchStats();
				counts.conversations = {
					sessions: conv.totalSessions,
					turns: conv.totalTurns,
				};
			} catch {
				counts.conversations = null;
			}
		}

		if (config.ENABLE_INSIGHTS) {
			try {
				const { getInsightStats } = await import('../db/insights.js');
				const ins = await getInsightStats();
				counts.insights = {
					total: ins.total,
					new: ins.new,
					seen: ins.seen,
					dismissed: ins.dismissed,
					byType: ins.byType,
				};
			} catch {
				counts.insights = null;
			}
		}

		res.json(counts);
	} catch (error) {
		logger.error('REST stats failed', {
			error: error instanceof Error ? error.message : String(error),
		});
		res.status(500).json({ error: 'Failed to get stats' });
	}
});
