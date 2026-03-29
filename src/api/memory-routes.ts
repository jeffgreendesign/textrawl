import { Router, type Router as RouterType } from 'express';
import { isSupabaseConfigured } from '../db/client.js';
import { listEntities } from '../db/memory-entities.js';
import type { EntityType } from '../db/memory-entities.js';
import { listRelations } from '../db/memory-relations.js';
import { getEntityContext, getMemoryStats, hybridMemorySearch } from '../db/memory-search.js';
import { generateEmbedding, isEmbeddingsConfigured } from '../services/embeddings.js';
import { config } from '../utils/config.js';
import { logger } from '../utils/logger.js';
import { bearerAuth } from './middleware/auth.js';

export const memoryRoutes: RouterType = Router();

// ---------------------------------------------------------------------------
// Feature gate — all memory routes require ENABLE_MEMORY
// ---------------------------------------------------------------------------

memoryRoutes.use('/memory', (_req, res, next) => {
	if (!config.ENABLE_MEMORY) {
		res.status(404).json({ error: 'Memory feature is not enabled' });
		return;
	}
	next();
});

// ---------------------------------------------------------------------------
// GET /api/memory/entities — list entities with pagination + type filter
// ---------------------------------------------------------------------------

memoryRoutes.get('/memory/entities', bearerAuth, async (req, res) => {
	try {
		if (!isSupabaseConfigured()) {
			res.status(503).json({ error: 'Database not available' });
			return;
		}

		const limit = Math.min(parseInt(req.query.limit as string, 10) || 50, 200);
		const offset = parseInt(req.query.offset as string, 10) || 0;
		const typesParam = req.query.types as string | undefined;
		const entityTypes = typesParam
			? (typesParam.split(',').map((t) => t.trim()) as EntityType[])
			: undefined;

		const result = await listEntities({ entityTypes, limit, offset });
		res.json(result);
	} catch (error) {
		logger.error('REST list memory entities failed', {
			error: error instanceof Error ? error.message : String(error),
		});
		res.status(500).json({ error: 'Failed to list entities' });
	}
});

// ---------------------------------------------------------------------------
// GET /api/memory/entities/:name — entity context with observations + relations
// ---------------------------------------------------------------------------

memoryRoutes.get('/memory/entities/:name', bearerAuth, async (req, res) => {
	try {
		if (!isSupabaseConfigured()) {
			res.status(503).json({ error: 'Database not available' });
			return;
		}

		const entityName = decodeURIComponent(req.params.name);
		const context = await getEntityContext(entityName);

		if (!context) {
			res.status(404).json({ error: 'Entity not found' });
			return;
		}

		res.json(context);
	} catch (error) {
		logger.error('REST get entity context failed', {
			error: error instanceof Error ? error.message : String(error),
		});
		res.status(500).json({ error: 'Failed to get entity context' });
	}
});

// ---------------------------------------------------------------------------
// GET /api/memory/graph — entities + relations for force-directed graph
// ---------------------------------------------------------------------------

memoryRoutes.get('/memory/graph', bearerAuth, async (req, res) => {
	try {
		if (!isSupabaseConfigured()) {
			res.status(503).json({ error: 'Database not available' });
			return;
		}

		const limit = Math.min(parseInt(req.query.limit as string, 10) || 200, 500);

		// Fetch entities as nodes
		const { entities } = await listEntities({ limit, offset: 0 });

		const entityIds = entities.map((e) => e.id);

		// Fetch all relations involving these entities in one query
		const relations = entityIds.length > 0 ? await listRelations({ entityIds }) : [];

		const nodes = entities.map((e) => ({
			id: e.id,
			name: e.name,
			type: e.entity_type,
			description: e.description,
		}));

		const edges = relations.map((r) => ({
			id: r.id,
			source: r.from_entity_id,
			target: r.to_entity_id,
			type: r.relation_type,
			strength: r.strength,
		}));

		res.json({ nodes, edges });
	} catch (error) {
		logger.error('REST memory graph failed', {
			error: error instanceof Error ? error.message : String(error),
		});
		res.status(500).json({ error: 'Failed to get memory graph' });
	}
});

// ---------------------------------------------------------------------------
// GET /api/memory/search — hybrid search across memories
// ---------------------------------------------------------------------------

memoryRoutes.get('/memory/search', bearerAuth, async (req, res) => {
	try {
		const q = req.query.q as string;
		if (!q) {
			res.status(400).json({ error: 'Query parameter "q" is required' });
			return;
		}

		if (!isSupabaseConfigured() || !isEmbeddingsConfigured()) {
			res.status(503).json({ error: 'Memory search not available' });
			return;
		}

		const limit = Math.min(parseInt(req.query.limit as string, 10) || 10, 50);
		const queryEmbedding = await generateEmbedding(q);
		const results = await hybridMemorySearch(q, queryEmbedding, { limit });

		res.json({
			query: q,
			totalResults: results.length,
			results,
		});
	} catch (error) {
		logger.error('REST memory search failed', {
			error: error instanceof Error ? error.message : String(error),
		});
		res.status(500).json({ error: 'Memory search failed' });
	}
});

// ---------------------------------------------------------------------------
// GET /api/memory/stats — memory statistics
// ---------------------------------------------------------------------------

memoryRoutes.get('/memory/stats', bearerAuth, async (_req, res) => {
	try {
		if (!isSupabaseConfigured()) {
			res.status(503).json({ error: 'Database not available' });
			return;
		}

		const stats = await getMemoryStats();
		res.json(stats);
	} catch (error) {
		logger.error('REST memory stats failed', {
			error: error instanceof Error ? error.message : String(error),
		});
		res.status(500).json({ error: 'Failed to get memory stats' });
	}
});
