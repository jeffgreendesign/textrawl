/**
 * Internal Cloud Tasks processing-endpoint tests (T4.2).
 *
 * Drive the real `uploadProcessRouter` + the real `cloudTasksOidc` middleware +
 * `errorHandler` with supertest. Only `google-auth-library` (`verifyIdToken`),
 * config, the db module, and the processing pipeline are mocked, so the OIDC
 * gate itself is exercised end-to-end. Pins the §4 contract: strict OIDC (no
 * bypass), idempotent no-op on terminal state, and `queued → processing` before
 * the pipeline runs.
 */
import express from 'express';
import request from 'supertest';
import { beforeEach, describe, expect, it, vi } from 'vitest';

const AUDIENCE = 'https://textrawl.example.run.app/api/upload/process';
const SA_EMAIL = 'textrawl-tasks@textrawl.iam.gserviceaccount.com';

// --- Hoisted mock collaborators ---

const { verifyIdToken, mockConfig } = vi.hoisted(() => ({
	verifyIdToken: vi.fn(),
	mockConfig: {
		UPLOAD_PROCESS_URL: 'https://textrawl.example.run.app/api/upload/process' as string | undefined,
		CLOUD_TASKS_SERVICE_ACCOUNT: 'textrawl-tasks@textrawl.iam.gserviceaccount.com' as
			| string
			| undefined,
	},
}));

vi.mock('google-auth-library', () => ({
	// Regular function so `new OAuth2Client()` is constructable.
	OAuth2Client: vi.fn(function OAuth2ClientMock() {
		return { verifyIdToken };
	}),
}));

vi.mock('../../utils/config.js', () => ({ config: mockConfig }));
vi.mock('../../utils/logger.js', () => ({
	logger: { debug: vi.fn(), info: vi.fn(), warn: vi.fn(), error: vi.fn() },
}));
vi.mock('../../db/pg-client.js', () => ({ isDatabaseConfigured: vi.fn(() => true) }));
vi.mock('../../db/uploads.js', () => ({
	getUpload: vi.fn(),
	transitionUploadState: vi.fn(),
}));
vi.mock('../../services/upload-processor.js', () => ({ processUpload: vi.fn() }));

// --- Imports (after mocks) ---

import { getUpload, transitionUploadState } from '../../db/uploads.js';
import { processUpload } from '../../services/upload-processor.js';
import { errorHandler } from '../middleware/error.js';
import { uploadProcessRouter } from '../upload-process.js';

const db = {
	getUpload: vi.mocked(getUpload),
	transitionUploadState: vi.mocked(transitionUploadState),
};
const pipeline = vi.mocked(processUpload);

function makeApp() {
	const app = express();
	app.use(express.json());
	app.use(uploadProcessRouter);
	app.use(errorHandler);
	return app;
}

// biome-ignore lint/suspicious/noExplicitAny: loose test fixture for the Upload row
function buildUpload(state: string, overrides: Record<string, any> = {}): any {
	return { id: 'up-1', state, ...overrides };
}

/** A valid Cloud Tasks OIDC ticket: correct SA + verified email. */
function validTicket() {
	return { getPayload: () => ({ email: SA_EMAIL, email_verified: true, aud: AUDIENCE }) };
}

function call(token?: string) {
	const req = request(makeApp()).post('/upload/process/up-1');
	return token ? req.set('Authorization', `Bearer ${token}`) : req;
}

beforeEach(() => {
	vi.clearAllMocks();
	mockConfig.UPLOAD_PROCESS_URL = AUDIENCE;
	mockConfig.CLOUD_TASKS_SERVICE_ACCOUNT = SA_EMAIL;
	db.transitionUploadState.mockResolvedValue(buildUpload('processing'));
	pipeline.mockResolvedValue(undefined);
});

describe('POST /upload/process/:uploadId — OIDC gate', () => {
	it('rejects a request with no Authorization header (401)', async () => {
		const res = await call();
		expect(res.status).toBe(401);
		expect(res.body.error.code).toBe('AUTHENTICATION_ERROR');
		expect(verifyIdToken).not.toHaveBeenCalled();
	});

	it('rejects a malformed Authorization header (401)', async () => {
		const res = await call().set('Authorization', 'NotBearer xyz');
		expect(res.status).toBe(401);
		expect(verifyIdToken).not.toHaveBeenCalled();
	});

	it('rejects when token verification fails / bad audience (401)', async () => {
		verifyIdToken.mockRejectedValueOnce(
			new Error('Wrong recipient, payload audience != requested'),
		);
		const res = await call('bad-token');
		expect(res.status).toBe(401);
		expect(verifyIdToken).toHaveBeenCalledWith({ idToken: 'bad-token', audience: AUDIENCE });
		expect(db.getUpload).not.toHaveBeenCalled();
	});

	it('rejects a token from the wrong service account (403)', async () => {
		verifyIdToken.mockResolvedValueOnce({
			getPayload: () => ({ email: 'attacker@evil.example.com', email_verified: true }),
		});
		const res = await call('good-token');
		expect(res.status).toBe(403);
		expect(res.body.error.code).toBe('AUTHORIZATION_ERROR');
		expect(db.getUpload).not.toHaveBeenCalled();
	});

	it('rejects a token whose email is not verified (403)', async () => {
		verifyIdToken.mockResolvedValueOnce({
			getPayload: () => ({ email: SA_EMAIL, email_verified: false }),
		});
		const res = await call('good-token');
		expect(res.status).toBe(403);
		expect(db.getUpload).not.toHaveBeenCalled();
	});
});

describe('POST /upload/process/:uploadId — processing', () => {
	beforeEach(() => {
		verifyIdToken.mockResolvedValue(validTicket());
	});

	it('404s when the upload does not exist', async () => {
		db.getUpload.mockResolvedValueOnce(null);
		const res = await call('good-token');
		expect(res.status).toBe(404);
		expect(pipeline).not.toHaveBeenCalled();
	});

	it.each(['completed', 'partial', 'failed', 'cancelled', 'expired'])(
		'is a no-op 200 when already terminal (%s) — pipeline not invoked',
		async (state) => {
			db.getUpload.mockResolvedValueOnce(buildUpload(state));
			const res = await call('good-token');
			expect(res.status).toBe(200);
			expect(res.body.state).toBe(state);
			expect(db.transitionUploadState).not.toHaveBeenCalled();
			expect(pipeline).not.toHaveBeenCalled();
		},
	);

	it('transitions queued → processing (CAS) and invokes the pipeline', async () => {
		db.getUpload.mockResolvedValueOnce(buildUpload('queued'));
		const res = await call('good-token');
		expect(res.status).toBe(200);
		expect(db.transitionUploadState).toHaveBeenCalledWith('up-1', 'processing');
		expect(pipeline).toHaveBeenCalledWith('up-1');
	});

	it('re-runs the idempotent pipeline without re-transitioning when already processing', async () => {
		db.getUpload.mockResolvedValueOnce(buildUpload('processing'));
		const res = await call('good-token');
		expect(res.status).toBe(200);
		expect(db.transitionUploadState).not.toHaveBeenCalled();
		expect(pipeline).toHaveBeenCalledWith('up-1');
	});
});
