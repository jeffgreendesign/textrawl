/**
 * Upload size-limit and error-shape tests.
 *
 * The T1.1 case asserts the multer byte limit derives from config. The T1.2
 * cases drive the real `uploadRouter` + `errorHandler` with supertest to confirm
 * oversized and unsupported-type uploads return structured JSON instead of a
 * bare 500. Every collaborator (auth, rate limiting, DB, embeddings, processor)
 * is mocked so the tests stay hermetic — no Postgres, OpenAI, or network.
 * `config.MAX_SINGLE_FILE_SIZE_MB` is mocked to 1 MB so an oversized upload can
 * be triggered with a small in-memory buffer.
 */
import express from 'express';
import request from 'supertest';
import { describe, expect, it, vi } from 'vitest';

// --- Mocks (must be declared before imports) ---

vi.mock('../../utils/config.js', () => ({
	config: { MAX_SINGLE_FILE_SIZE_MB: 1 },
}));

vi.mock('../../utils/logger.js', () => ({
	logger: { debug: vi.fn(), info: vi.fn(), warn: vi.fn(), error: vi.fn() },
}));

// Auth and rate limiting are pass-through so tests focus on upload behavior.
vi.mock('../middleware/auth.js', () => ({
	bearerAuth: (_req: unknown, _res: unknown, next: () => void) => next(),
}));

vi.mock('../middleware/rateLimit.js', () => ({
	uploadLimiter: (_req: unknown, _res: unknown, next: () => void) => next(),
}));

vi.mock('../../services/processor.js', () => ({
	isSupportedType: vi.fn(() => true),
	validateFileType: vi.fn(async () => true),
	extractText: vi.fn(async () => 'extracted text'),
}));

vi.mock('../../services/embeddings.js', () => ({
	generateEmbeddings: vi.fn(async (texts: string[]) => texts.map(() => [0.1, 0.2, 0.3])),
	isOpenAIConfigured: vi.fn(() => true),
}));

vi.mock('../../services/chunker.js', () => ({
	smartChunk: vi.fn(async () => [{ content: 'chunk', index: 0, startOffset: 0, endOffset: 5 }]),
}));

vi.mock('../../db/pg-client.js', () => ({
	isDatabaseConfigured: vi.fn(() => true),
}));

vi.mock('../../db/documents.js', () => ({
	createDocument: vi.fn(async () => ({ id: 'doc-1', title: 'big.txt' })),
}));

vi.mock('../../db/chunks.js', () => ({
	createChunks: vi.fn(async () => undefined),
}));

// --- Imports (after mocks) ---

import { isSupportedType } from '../../services/processor.js';
import { config } from '../../utils/config.js';
import { errorHandler } from '../middleware/error.js';
import { maxUploadBytes, uploadRouter } from '../upload.js';

function makeApp() {
	const app = express();
	app.use(uploadRouter);
	app.use(errorHandler);
	return app;
}

describe('upload size limit (T1.1)', () => {
	it('derives the multer byte limit from config, not a hardcoded literal', () => {
		expect(maxUploadBytes).toBe(config.MAX_SINGLE_FILE_SIZE_MB * 1024 * 1024);
	});
});

describe('upload error shape (T1.2)', () => {
	it('returns 413 FILE_TOO_LARGE for an oversized upload', async () => {
		const oversized = Buffer.alloc(maxUploadBytes + 1024, 'a');
		const res = await request(makeApp())
			.post('/upload')
			.attach('file', oversized, { filename: 'big.txt', contentType: 'text/plain' });

		expect(res.status).toBe(413);
		expect(res.body.error.code).toBe('FILE_TOO_LARGE');
		expect(res.body.error.statusCode).toBe(413);
		expect(typeof res.body.error.message).toBe('string');
	});

	it('returns 400 UNSUPPORTED_TYPE for a rejected file type', async () => {
		vi.mocked(isSupportedType).mockReturnValueOnce(false);
		const res = await request(makeApp()).post('/upload').attach('file', Buffer.from('hello'), {
			filename: 'evil.exe',
			contentType: 'application/x-msdownload',
		});

		expect(res.status).toBe(400);
		expect(res.body.error.code).toBe('UNSUPPORTED_TYPE');
		expect(res.body.error.statusCode).toBe(400);
	});
});
