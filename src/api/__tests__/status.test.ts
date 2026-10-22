/**
 * Public /status must be up/down only (no version, tool names, or embedding
 * model). Full detail is served behind auth at /api/status.
 */
import express from 'express';
import request from 'supertest';
import { beforeEach, describe, expect, it, vi } from 'vitest';

const TOKEN = 'status-test-token-aaaaaaaaaaaaaaaaaaaaaaaa';

const { mockConfig, db } = vi.hoisted(() => ({
	mockConfig: {
		NODE_ENV: 'test' as const,
		API_BEARER_TOKEN: 'status-test-token-aaaaaaaaaaaaaaaaaaaaaaaa' as string | undefined,
		GOOGLE_CLIENT_ID: undefined as string | undefined,
		OAUTH_JWT_SECRET: undefined as string | undefined,
		TEXTRAWL_ALLOW_NO_AUTH: false,
		EMBEDDING_PROVIDER: 'google',
		GOOGLE_EMBEDDING_MODEL: 'gemini-embedding-2',
		OLLAMA_MODEL: 'nomic-embed-text',
		OLLAMA_BASE_URL: 'http://localhost:11434',
		ENABLE_MEMORY: false,
		ENABLE_CONVERSATIONS: false,
		ENABLE_INSIGHTS: false,
		ENABLE_MEMORY_EXTRACTION: false,
		COMPACT_RESPONSES: false,
	},
	db: { configured: true, connected: true },
}));

vi.mock('../../utils/config.js', () => ({ config: mockConfig }));
vi.mock('../../utils/logger.js', () => ({
	logger: { debug: vi.fn(), info: vi.fn(), warn: vi.fn(), error: vi.fn() },
}));
vi.mock('../../db/pg-client.js', () => ({
	isDatabaseConfigured: () => db.configured,
	checkDatabaseConnection: async () => db.connected,
	pgQuery: async () => [],
}));
vi.mock('../../services/embeddings.js', () => ({ isEmbeddingsConfigured: () => true }));

import { errorHandler } from '../middleware/error.js';
import { statusRouter } from '../status.js';

function makeApp() {
	const app = express();
	app.use(statusRouter);
	app.use(errorHandler);
	return app;
}

beforeEach(() => {
	db.configured = true;
	db.connected = true;
});

describe('GET /status (public)', () => {
	it('returns only an up indicator', async () => {
		const res = await request(makeApp()).get('/status');
		expect(res.status).toBe(200);
		expect(res.body).toEqual({ status: 'ok' });
	});

	it('does not leak version, tools, or embedding model', async () => {
		const res = await request(makeApp()).get('/status');
		const text = JSON.stringify(res.body);
		expect(text).not.toMatch(/version|tools|embedding|gemini|search/i);
	});

	it('returns 503 down when the database is down', async () => {
		db.connected = false;
		const res = await request(makeApp()).get('/status');
		expect(res.status).toBe(503);
		expect(res.body).toEqual({ status: 'down' });
	});
});

describe('GET /api/status (authenticated detail)', () => {
	it('rejects anonymous requests', async () => {
		const res = await request(makeApp()).get('/api/status');
		expect(res.status).toBe(401);
		expect(res.body).not.toHaveProperty('tools');
	});

	it('returns full detail with a valid token', async () => {
		const res = await request(makeApp()).get('/api/status').set('Authorization', `Bearer ${TOKEN}`);
		expect(res.status).toBe(200);
		expect(res.body.overall).toBe('operational');
		expect(res.body.version).toBeTypeOf('string');
		expect(Array.isArray(res.body.tools)).toBe(true);
		expect(res.body.embedding.model).toBe('gemini-embedding-2');
	});
});
