import { Router, type Router as RouterType } from 'express';
import { z } from 'zod';
import { listEntities } from '../db/memory-entities.js';
import { listRelations } from '../db/memory-relations.js';
import { getEntityContext, getMemoryStats, hybridMemorySearch } from '../db/memory-search.js';
import { isDatabaseConfigured } from '../db/pg-client.js';
import { generateEmbedding, isEmbeddingsConfigured } from '../services/embeddings.js';
import { config } from '../utils/config.js';
import { logger } from '../utils/logger.js';
import { bearerAuth } from './middleware/auth.js';

// ---------------------------------------------------------------------------
// Query validation schemas
// ---------------------------------------------------------------------------

const ENTITY_TYPES = [
	'person',
	'concept',
	'project',
	'preference',
	'fact',
	'location',
	'organization',
] as const;

const EntitiesQuerySchema = z.object({
	limit: z.coerce.number().int().min(1).max(200).default(50),
	offset: z.coerce.number().int().min(0).default(0),
	types: z
		.string()
		.transform((v) =>
			v
				.split(',')
				.map((t) => t.trim())
				.filter(Boolean),
		)
		.pipe(z.array(z.enum(ENTITY_TYPES)).min(1))
		.optional(),
});

const GraphQuerySchema = z.object({
	limit: z.coerce.number().int().min(1).max(500).default(200),
});

const MemorySearchQuerySchema = z.object({
	q: z.string().min(1, 'Query parameter "q" is required'),
	limit: z.coerce.number().int().min(1).max(50).default(10),
});

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
	const parsed = EntitiesQuerySchema.safeParse(req.query);
	if (!parsed.success) {
		res.status(400).json({ error: parsed.error.issues[0].message });
		return;
	}

	try {
		if (!isDatabaseConfigured()) {
			res.status(503).json({ error: 'Database not available' });
			return;
		}

		const { limit, offset, types: entityTypes } = parsed.data;
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

memoryRoutes.get<{ name: string }>('/memory/entities/:name', bearerAuth, async (req, res) => {
	try {
		if (!isDatabaseConfigured()) {
			res.status(503).json({ error: 'Database not available' });
			return;
		}

		const entityName = req.params.name;
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
	const parsed = GraphQuerySchema.safeParse(req.query);
	if (!parsed.success) {
		res.status(400).json({ error: parsed.error.issues[0].message });
		return;
	}

	try {
		if (!isDatabaseConfigured()) {
			res.status(503).json({ error: 'Database not available' });
			return;
		}

		const { limit } = parsed.data;

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

		// Filter out relations where either endpoint is not in the node set
		// (listRelations uses OR logic, so one side may reference an entity outside
		// the fetched set when the graph is paginated)
		const nodeIds = new Set(entityIds);
		const edges = relations
			.filter((r) => nodeIds.has(r.from_entity_id) && nodeIds.has(r.to_entity_id))
			.map((r) => ({
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
	const parsed = MemorySearchQuerySchema.safeParse(req.query);
	if (!parsed.success) {
		res.status(400).json({ error: parsed.error.issues[0].message });
		return;
	}

	try {
		if (!isDatabaseConfigured() || !isEmbeddingsConfigured()) {
			res.status(503).json({ error: 'Memory search not available' });
			return;
		}

		const { q, limit } = parsed.data;
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
		if (!isDatabaseConfigured()) {
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
