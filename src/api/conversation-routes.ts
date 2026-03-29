import { Router, type Router as RouterType } from 'express';
import { isSupabaseConfigured } from '../db/client.js';
import {
	getConversationWithTurns,
	getRecentConversations,
	hybridConversationSearch,
} from '../db/conversation-search.js';
import { generateEmbedding, isEmbeddingsConfigured } from '../services/embeddings.js';
import { config } from '../utils/config.js';
import { logger } from '../utils/logger.js';
import { bearerAuth } from './middleware/auth.js';

export const conversationRoutes: RouterType = Router();

// ---------------------------------------------------------------------------
// Feature gate — all conversation routes require ENABLE_CONVERSATIONS
// ---------------------------------------------------------------------------

conversationRoutes.use('/conversations', (_req, res, next) => {
	if (!config.ENABLE_CONVERSATIONS) {
		res.status(404).json({ error: 'Conversations feature is not enabled' });
		return;
	}
	next();
});

// ---------------------------------------------------------------------------
// GET /api/conversations/search — hybrid search across conversation summaries
// Must be before /:id to avoid route conflict
// ---------------------------------------------------------------------------

conversationRoutes.get('/conversations/search', bearerAuth, async (req, res) => {
	try {
		const q = req.query.q as string;
		if (!q) {
			res.status(400).json({ error: 'Query parameter "q" is required' });
			return;
		}

		if (!isSupabaseConfigured() || !isEmbeddingsConfigured()) {
			res.status(503).json({ error: 'Conversation search not available' });
			return;
		}

		const limit = Math.min(parseInt(req.query.limit as string, 10) || 10, 50);
		const queryEmbedding = await generateEmbedding(q);
		const results = await hybridConversationSearch(q, queryEmbedding, { limit });

		res.json({
			query: q,
			totalResults: results.length,
			results,
		});
	} catch (error) {
		logger.error('REST conversation search failed', {
			error: error instanceof Error ? error.message : String(error),
		});
		res.status(500).json({ error: 'Conversation search failed' });
	}
});

// ---------------------------------------------------------------------------
// GET /api/conversations — list recent conversations with pagination
// ---------------------------------------------------------------------------

conversationRoutes.get('/conversations', bearerAuth, async (req, res) => {
	try {
		if (!isSupabaseConfigured()) {
			res.status(503).json({ error: 'Database not available' });
			return;
		}

		const limit = Math.min(parseInt(req.query.limit as string, 10) || 20, 100);
		const offset = parseInt(req.query.offset as string, 10) || 0;

		const result = await getRecentConversations({ limit, offset });
		res.json(result);
	} catch (error) {
		logger.error('REST list conversations failed', {
			error: error instanceof Error ? error.message : String(error),
		});
		res.status(500).json({ error: 'Failed to list conversations' });
	}
});

// ---------------------------------------------------------------------------
// GET /api/conversations/:id — get conversation with turns
// ---------------------------------------------------------------------------

conversationRoutes.get('/conversations/:id', bearerAuth, async (req, res) => {
	try {
		if (!isSupabaseConfigured()) {
			res.status(503).json({ error: 'Database not available' });
			return;
		}

		const maxTurns = Math.min(parseInt(req.query.maxTurns as string, 10) || 50, 200);
		const result = await getConversationWithTurns(req.params.id, { maxTurns });

		if (!result) {
			res.status(404).json({ error: 'Conversation not found' });
			return;
		}

		res.json(result);
	} catch (error) {
		logger.error('REST get conversation failed', {
			error: error instanceof Error ? error.message : String(error),
		});
		res.status(500).json({ error: 'Failed to get conversation' });
	}
});
