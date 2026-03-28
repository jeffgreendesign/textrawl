import { Router, type Router as RouterType } from 'express';
import { isSupabaseConfigured } from '../db/client.js';
import { getDocument, listDocuments } from '../db/documents.js';
import { hybridSearch } from '../db/search.js';
import { getKnowledgeStats } from '../db/stats.js';
import { generateEmbedding, isEmbeddingsConfigured } from '../services/embeddings.js';
import { config } from '../utils/config.js';
import { logger } from '../utils/logger.js';
import { bearerAuth } from './middleware/auth.js';
import { uploadRouter } from './upload.js';

export const apiRoutes: RouterType = Router();

apiRoutes.use(uploadRouter);

// ---------------------------------------------------------------------------
// REST API endpoints for cross-device access (Enhancement 9)
// These are thin wrappers around existing DB functions.
// ---------------------------------------------------------------------------

apiRoutes.get('/search', bearerAuth, async (req, res) => {
	try {
		const q = req.query.q as string;
		if (!q) {
			res.status(400).json({ error: 'Query parameter "q" is required' });
			return;
		}

		if (!isSupabaseConfigured() || !isEmbeddingsConfigured()) {
			res.status(503).json({ error: 'Search not available' });
			return;
		}

		const limit = Math.min(parseInt(req.query.limit as string, 10) || 10, 50);
		const queryEmbedding = await generateEmbedding(q);
		const results = await hybridSearch({ queryText: q, queryEmbedding, limit });

		res.json({
			query: q,
			totalResults: results.length,
			results: results.map((r) => ({
				documentId: r.document_id,
				documentTitle: r.document_title,
				content: r.content.slice(0, 500),
				sourceType: r.source_type,
				score: r.score,
			})),
		});
	} catch (error) {
		logger.error('REST search failed', {
			error: error instanceof Error ? error.message : String(error),
		});
		res.status(500).json({ error: 'Search failed' });
	}
});

apiRoutes.get('/documents', bearerAuth, async (req, res) => {
	try {
		if (!isSupabaseConfigured()) {
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
		if (!isSupabaseConfigured()) {
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
		if (!isSupabaseConfigured()) {
			res.status(503).json({ error: 'Database not available' });
			return;
		}

		const knowledge = await getKnowledgeStats();

		const counts: Record<string, unknown> = { documents: knowledge.total };

		if (config.ENABLE_MEMORY) {
			try {
				const { getMemoryStats } = await import('../db/memory-search.js');
				const mem = await getMemoryStats();
				counts.memories = mem.totalEntities;
			} catch {
				counts.memories = null;
			}
		}

		if (config.ENABLE_CONVERSATIONS) {
			try {
				const { getConversationSearchStats } = await import('../db/conversation-search.js');
				const conv = await getConversationSearchStats();
				counts.conversations = conv.totalSessions;
			} catch {
				counts.conversations = null;
			}
		}

		if (config.ENABLE_INSIGHTS) {
			try {
				const { getInsightStats } = await import('../db/insights.js');
				const ins = await getInsightStats();
				counts.insights = ins.total;
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
