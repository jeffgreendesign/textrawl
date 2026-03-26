import { Router, type Router as RouterType } from 'express';
import { isSupabaseConfigured } from '../db/client.js';
import { hybridSearch } from '../db/search.js';
import { generateEmbedding, isEmbeddingsConfigured } from '../services/embeddings.js';
import { config } from '../utils/config.js';
import { logger } from '../utils/logger.js';
import { bearerAuth } from './middleware/auth.js';

export const a2aRoutes: RouterType = Router();

/**
 * A2A Agent Card — describes this agent's capabilities to other agents.
 * Served at /.well-known/agent.json per the A2A protocol specification.
 */
a2aRoutes.get('/.well-known/agent.json', (_req, res) => {
	res.json({
		name: 'Textrawl',
		description:
			'Personal knowledge base agent — search, store, and discover connections across your documents, memories, and conversations.',
		url: config.OAUTH_SERVER_URL ?? `http://localhost:${config.PORT}`,
		version: '0.2.0',
		capabilities: {
			streaming: false,
			pushNotifications: false,
		},
		skills: [
			{
				id: 'search',
				name: 'Search Knowledge',
				description:
					'Search across all personal knowledge including documents, memories, conversations, and insights.',
			},
			{
				id: 'save',
				name: 'Save Knowledge',
				description: 'Save notes, URLs, or documents to the knowledge base.',
			},
			{
				id: 'memory',
				name: 'Memory Graph',
				description:
					'Store and query facts about entities — people, projects, concepts, and their relationships.',
			},
			{
				id: 'insights',
				name: 'Discover Insights',
				description: 'Find connections and patterns across your knowledge base.',
			},
		],
		defaultInputModes: ['text'],
		defaultOutputModes: ['text'],
		authentication: {
			schemes: ['bearer'],
		},
	});
});

/**
 * A2A Task endpoint — accepts task messages from other agents.
 * Routes natural language instructions through the search pipeline.
 */
a2aRoutes.post('/.well-known/agent/tasks', bearerAuth, async (req, res) => {
	try {
		const { message } = req.body ?? {};

		if (!message?.parts || !Array.isArray(message.parts) || message.parts.length === 0) {
			res.status(400).json({
				error: 'Invalid A2A task: message with parts is required',
			});
			return;
		}

		// Extract text from the first text part
		const textPart = message.parts.find((p: { type?: string }) => !p.type || p.type === 'text');
		const query = textPart?.text ?? textPart?.content;

		if (!query || typeof query !== 'string') {
			res.status(400).json({
				error: 'No text content found in task message',
			});
			return;
		}

		logger.info('A2A task received', { queryLength: query.length });

		if (!isSupabaseConfigured() || !isEmbeddingsConfigured()) {
			res.status(503).json({
				error: 'Knowledge base not configured',
			});
			return;
		}

		// TODO: Consider using the unified ask tool for multi-source search (documents + memory + conversations)
		const queryEmbedding = await generateEmbedding(query);
		const results = await hybridSearch({
			queryText: query,
			queryEmbedding,
			limit: 10,
		});

		// Format as A2A task response
		const responseText =
			results.length > 0
				? results
						.map(
							(r, i) =>
								`[${i + 1}] ${r.document_title} (${r.source_type}): ${(r.content ?? '').slice(0, 300)}`,
						)
						.join('\n\n')
				: 'No results found in the knowledge base.';

		res.json({
			id: `task-${Date.now()}`,
			status: { state: 'completed' },
			output: {
				parts: [{ type: 'text', text: responseText }],
			},
			metadata: {
				resultCount: results.length,
				sources: results.map((r) => ({
					documentId: r.document_id,
					title: r.document_title,
					sourceType: r.source_type,
				})),
			},
		});
	} catch (error) {
		logger.error('A2A task failed', {
			error: error instanceof Error ? error.message : String(error),
		});
		res.status(500).json({
			error: 'Task processing failed',
		});
	}
});
