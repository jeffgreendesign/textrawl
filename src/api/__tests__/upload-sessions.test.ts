/**
 * Upload-session API tests (T2.3).
 *
 * Drive the real `uploadSessionsRouter` + `errorHandler` with supertest. The DB
 * module, storage, and task-queue ports are mocked so the tests stay hermetic —
 * no Postgres, GCS, or Cloud Tasks. They pin the §4 contract: init/complete/
 * status/cancel shapes, the stable error codes, idempotent complete (one
 * enqueue), and owner-scoped access.
 */
import { createHash } from 'node:crypto';
import express from 'express';
import request from 'supertest';
import { beforeEach, describe, expect, it, vi } from 'vitest';

// --- Hoisted mock collaborators ---

const { storage, taskQueue, mockConfig } = vi.hoisted(() => ({
	storage: {
		startResumableSession: vi.fn(async () => ({
			resumableUri: 'memory://uploads/key?session=abc',
			expiresAt: '2026-06-01T14:00:00.000Z',
		})),
		headObject: vi.fn(async () => ({
			size: 100,
			generation: '1',
			crc32c: 'AAAAAA==',
			etag: 'e',
		})),
		abortSession: vi.fn(async () => undefined),
	},
	taskQueue: {
		enqueueProcessing: vi.fn(async () => ({ taskName: 'process-x', deduplicated: false })),
	},
	// Mutable config object so individual tests can flip auth on/off.
	mockConfig: {
		MAX_UPLOAD_SIZE_MB: 500,
		UPLOAD_THRESHOLD_MB: 20,
		MAX_SINGLE_FILE_SIZE_MB: 20,
		UPLOAD_SESSION_TTL_MIN: 120,
		GCS_UPLOAD_BUCKET: undefined as string | undefined,
		API_BEARER_TOKEN: 'test-bearer-token-aaaaaaaaaaaaaaaaaaaa' as string | undefined,
		GOOGLE_CLIENT_ID: undefined as string | undefined,
	},
}));

vi.mock('../../utils/config.js', () => ({ config: mockConfig }));

vi.mock('../../utils/logger.js', () => ({
	logger: { debug: vi.fn(), info: vi.fn(), warn: vi.fn(), error: vi.fn() },
}));

// Auth is pass-through; ownership is derived from the Authorization header by the
// router's own owner helper (not by bearerAuth).
vi.mock('../middleware/auth.js', () => ({
	bearerAuth: (_req: unknown, _res: unknown, next: () => void) => next(),
}));

// Rate limiting is pass-through so tests focus on session behavior.
vi.mock('../middleware/rateLimit.js', () => ({
	uploadLimiter: (_req: unknown, _res: unknown, next: () => void) => next(),
}));

vi.mock('../../db/pg-client.js', () => ({
	isDatabaseConfigured: vi.fn(() => true),
}));

vi.mock('../../services/processor.js', () => ({
	isSupportedType: vi.fn(() => false),
}));

vi.mock('../../services/storage/index.js', () => ({ getStorageService: () => storage }));
vi.mock('../../services/tasks/index.js', () => ({ getTaskQueue: () => taskQueue }));

vi.mock('../../db/uploads.js', () => ({
	createUpload: vi.fn(),
	getUpload: vi.fn(),
	getUploadStatus: vi.fn(),
	transitionUploadState: vi.fn(),
}));

// --- Imports (after mocks) ---

import {
	createUpload,
	getUpload,
	getUploadStatus,
	transitionUploadState,
} from '../../db/uploads.js';
import { InvalidUploadStateError } from '../../utils/errors.js';
import { errorHandler } from '../middleware/error.js';
import { uploadSessionsRouter } from '../upload-sessions.js';

const db = {
	createUpload: vi.mocked(createUpload),
	getUpload: vi.mocked(getUpload),
	getUploadStatus: vi.mocked(getUploadStatus),
	transitionUploadState: vi.mocked(transitionUploadState),
};

const OWNER_TOKEN = 'owner-token';
const ownerHash = createHash('sha256').update(OWNER_TOKEN).digest('hex');
const otherHash = createHash('sha256').update('someone-else').digest('hex');

function makeApp() {
	const app = express();
	app.use(express.json());
	app.use(uploadSessionsRouter);
	app.use(errorHandler);
	return app;
}

// biome-ignore lint/suspicious/noExplicitAny: test fixture shape mirrors the Upload row loosely
function buildUpload(overrides: Record<string, any> = {}): any {
	return {
		id: 'up-1',
		owner_token_hash: ownerHash,
		filename: 'Gardening.zip',
		title: null,
		declared_mimetype: 'application/zip',
		normalized_type: null,
		size_bytes: 100,
		checksum_algo: 'sha256',
		checksum_expected: null,
		checksum_computed: null,
		checksum_verified_at: null,
		gcs_crc32c: null,
		bucket: 'textrawl-uploads',
		object_key: 'uploads/2026/06/up-1/Gardening.zip',
		object_generation: null,
		object_etag: null,
		state: 'initialized',
		error_code: null,
		error_message: null,
		entries_total: 0,
		entries_processed: 0,
		entries_failed: 0,
		document_ids: [],
		metadata: {},
		created_at: '2026-06-01T12:00:00.000Z',
		updated_at: '2026-06-01T12:00:00.000Z',
		expires_at: '2026-06-01T14:00:00.000Z',
		completed_at: null,
		...overrides,
	};
}

const auth = (token = OWNER_TOKEN) => ({ Authorization: `Bearer ${token}` });

beforeEach(() => {
	vi.clearAllMocks();
	mockConfig.API_BEARER_TOKEN = 'test-bearer-token-aaaaaaaaaaaaaaaaaaaa';
	mockConfig.GOOGLE_CLIENT_ID = undefined;
	db.transitionUploadState.mockResolvedValue(buildUpload());
});

describe('POST /upload/init', () => {
	it('opens a session and returns a server-generated object key (ignoring any client key)', async () => {
		db.createUpload.mockImplementation(async (input) =>
			buildUpload({
				id: 'up-new',
				object_key: input.objectKey,
				bucket: input.bucket,
				size_bytes: input.sizeBytes,
				expires_at: typeof input.expiresAt === 'string' ? input.expiresAt : null,
			}),
		);

		const res = await request(makeApp()).post('/upload/init').set(auth()).send({
			filename: 'Gardening.zip',
			contentType: 'application/zip',
			size: 100,
			objectKey: 'evil/client/path.zip', // must be ignored
		});

		expect(res.status).toBe(200);
		expect(res.body.uploadId).toBe('up-new');
		expect(res.body.resumableUri).toBe('memory://uploads/key?session=abc');
		expect(res.body.state).toBe('initialized');
		expect(res.body.useDirectUpload).toBe(true); // 100 bytes ≤ threshold

		// Server-generated key, owner hash bound, client key ignored.
		const input = db.createUpload.mock.calls[0][0];
		expect(input.objectKey).toMatch(/^uploads\/\d{4}\/\d{2}\/[\w-]+\/Gardening\.zip$/);
		expect(input.objectKey).not.toContain('evil');
		expect(input.ownerTokenHash).toBe(ownerHash);
	});

	it('rejects a file larger than MAX_UPLOAD_SIZE_MB with 413 FILE_TOO_LARGE', async () => {
		const res = await request(makeApp())
			.post('/upload/init')
			.set(auth())
			.send({ filename: 'huge.zip', contentType: 'application/zip', size: 600 * 1024 * 1024 });

		expect(res.status).toBe(413);
		expect(res.body.error.code).toBe('FILE_TOO_LARGE');
		expect(db.createUpload).not.toHaveBeenCalled();
	});

	it('rejects an unsupported type with 400 UNSUPPORTED_TYPE', async () => {
		const res = await request(makeApp())
			.post('/upload/init')
			.set(auth())
			.send({ filename: 'evil.exe', contentType: 'application/x-msdownload', size: 100 });

		expect(res.status).toBe(400);
		expect(res.body.error.code).toBe('UNSUPPORTED_TYPE');
		expect(db.createUpload).not.toHaveBeenCalled();
	});
});

describe('POST /upload/complete', () => {
	it('verifies, transitions uploaded→queued, and enqueues exactly one task', async () => {
		db.getUpload.mockResolvedValue(buildUpload({ state: 'initialized' }));

		const res = await request(makeApp())
			.post('/upload/complete')
			.set(auth())
			.send({ uploadId: 'up-1' });

		expect(res.status).toBe(202);
		expect(res.body.state).toBe('queued');
		expect(res.body.statusUrl).toBe('/api/upload/up-1/status');
		// initialized → uploaded → queued
		expect(db.transitionUploadState).toHaveBeenCalledWith('up-1', 'uploaded');
		expect(db.transitionUploadState).toHaveBeenCalledWith('up-1', 'queued');
		expect(taskQueue.enqueueProcessing).toHaveBeenCalledTimes(1);
	});

	it('is idempotent on an already-queued upload (no second enqueue)', async () => {
		db.getUpload.mockResolvedValue(buildUpload({ state: 'queued' }));

		const res = await request(makeApp())
			.post('/upload/complete')
			.set(auth())
			.send({ uploadId: 'up-1' });

		expect(res.status).toBe(202);
		expect(res.body.state).toBe('queued');
		expect(db.transitionUploadState).not.toHaveBeenCalled();
		expect(taskQueue.enqueueProcessing).not.toHaveBeenCalled();
	});

	it('rejects completing a terminal (cancelled) upload with 409 INVALID_STATE', async () => {
		db.getUpload.mockResolvedValue(buildUpload({ state: 'cancelled' }));

		const res = await request(makeApp())
			.post('/upload/complete')
			.set(auth())
			.send({ uploadId: 'up-1' });

		expect(res.status).toBe(409);
		expect(res.body.error.code).toBe('INVALID_STATE');
		expect(taskQueue.enqueueProcessing).not.toHaveBeenCalled();
	});

	it('rejects a non-owner with 403 FORBIDDEN_OWNER', async () => {
		db.getUpload.mockResolvedValue(buildUpload({ owner_token_hash: otherHash }));

		const res = await request(makeApp())
			.post('/upload/complete')
			.set(auth())
			.send({ uploadId: 'up-1' });

		expect(res.status).toBe(403);
		expect(res.body.error.code).toBe('FORBIDDEN_OWNER');
	});

	it('rejects an expired session with 410 UPLOAD_EXPIRED', async () => {
		db.getUpload.mockResolvedValue(
			buildUpload({ state: 'initialized', expires_at: '2020-01-01T00:00:00.000Z' }),
		);

		const res = await request(makeApp())
			.post('/upload/complete')
			.set(auth())
			.send({ uploadId: 'up-1' });

		expect(res.status).toBe(410);
		expect(res.body.error.code).toBe('UPLOAD_EXPIRED');
		expect(taskQueue.enqueueProcessing).not.toHaveBeenCalled();
	});

	it('returns 404 for a missing upload', async () => {
		db.getUpload.mockResolvedValue(null);

		const res = await request(makeApp())
			.post('/upload/complete')
			.set(auth())
			.send({ uploadId: 'missing' });

		expect(res.status).toBe(404);
	});
});

describe('GET /upload/:uploadId/status', () => {
	it('returns the full status shape with zeroed progress for an empty upload', async () => {
		db.getUploadStatus.mockResolvedValue({
			upload: buildUpload({ state: 'processing' }),
			entries: [],
			counts: { total: 0, completed: 0, failed: 0, pending: 0, skipped: 0 },
		});

		const res = await request(makeApp()).get('/upload/up-1/status').set(auth());

		expect(res.status).toBe(200);
		expect(res.body).toMatchObject({
			uploadId: 'up-1',
			state: 'processing',
			filename: 'Gardening.zip',
			size: 100,
			progress: { entriesTotal: 0, entriesProcessed: 0, entriesFailed: 0 },
			documentIds: [],
			entries: [],
			error: null,
		});
	});

	it('returns 404 for a missing upload', async () => {
		db.getUploadStatus.mockResolvedValue(null);
		const res = await request(makeApp()).get('/upload/missing/status').set(auth());
		expect(res.status).toBe(404);
	});

	it('returns 404 (not 403) for a non-owner, to avoid leaking existence', async () => {
		db.getUploadStatus.mockResolvedValue({
			upload: buildUpload({ owner_token_hash: otherHash }),
			entries: [],
			counts: { total: 0, completed: 0, failed: 0, pending: 0, skipped: 0 },
		});

		const res = await request(makeApp()).get('/upload/up-1/status').set(auth());
		expect(res.status).toBe(404);
	});
});

describe('DELETE /upload/:uploadId', () => {
	it('cancels an in-progress upload and aborts the storage session', async () => {
		db.getUpload.mockResolvedValue(buildUpload({ state: 'initialized' }));

		const res = await request(makeApp()).delete('/upload/up-1').set(auth());

		expect(res.status).toBe(200);
		expect(res.body.state).toBe('cancelled');
		expect(db.transitionUploadState).toHaveBeenCalledWith('up-1', 'cancelled');
		expect(storage.abortSession).toHaveBeenCalledWith('uploads/2026/06/up-1/Gardening.zip');
	});

	it('rejects cancelling a processing upload with 409 INVALID_STATE', async () => {
		db.getUpload.mockResolvedValue(buildUpload({ state: 'processing' }));
		db.transitionUploadState.mockRejectedValueOnce(new InvalidUploadStateError());

		const res = await request(makeApp()).delete('/upload/up-1').set(auth());

		expect(res.status).toBe(409);
		expect(res.body.error.code).toBe('INVALID_STATE');
		expect(storage.abortSession).not.toHaveBeenCalled();
	});

	it('is idempotent on an already-cancelled upload (no transition)', async () => {
		db.getUpload.mockResolvedValue(buildUpload({ state: 'cancelled' }));

		const res = await request(makeApp()).delete('/upload/up-1').set(auth());

		expect(res.status).toBe(200);
		expect(res.body.state).toBe('cancelled');
		expect(db.transitionUploadState).not.toHaveBeenCalled();
	});

	it('returns 404 for a non-owner', async () => {
		db.getUpload.mockResolvedValue(buildUpload({ owner_token_hash: otherHash }));
		const res = await request(makeApp()).delete('/upload/up-1').set(auth());
		expect(res.status).toBe(404);
	});
});

describe('auth-disabled mode', () => {
	it('skips ownership checks and treats uploads as unowned', async () => {
		mockConfig.API_BEARER_TOKEN = undefined;
		mockConfig.GOOGLE_CLIENT_ID = undefined;
		db.getUploadStatus.mockResolvedValue({
			upload: buildUpload({ owner_token_hash: null }),
			entries: [],
			counts: { total: 0, completed: 0, failed: 0, pending: 0, skipped: 0 },
		});

		// No Authorization header at all.
		const res = await request(makeApp()).get('/upload/up-1/status');

		expect(res.status).toBe(200);
		expect(res.body.uploadId).toBe('up-1');
	});
});
