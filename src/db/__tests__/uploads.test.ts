/**
 * Unit tests for the uploads DB module.
 *
 * The Postgres client (pg-client) is fully mocked — no live database. These
 * tests pin the contract the session API (T2.3) depends on: typed create/get/
 * list, the §5 guarded state-transition graph (legal moves succeed, illegal
 * moves throw ValidationError), and the AX rules (missing id → null, dates
 * normalized to ISO strings, bigint → number, aggregates default to zero).
 */
import { beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('../../utils/logger.js', () => ({
	logger: { debug: vi.fn(), info: vi.fn(), warn: vi.fn(), error: vi.fn() },
}));

vi.mock('../pg-client.js', () => ({
	isDatabaseConfigured: vi.fn(() => true),
	pgQuery: vi.fn(),
	queryOne: vi.fn(),
	queryOneOrThrow: vi.fn(),
	queryCount: vi.fn(),
}));

import { ValidationError } from '../../utils/errors.js';
import { pgQuery, queryCount, queryOne, queryOneOrThrow } from '../pg-client.js';
import {
	createUpload,
	getUpload,
	getUploadStatus,
	isLegalUploadTransition,
	listUploads,
	transitionUploadState,
} from '../uploads.js';

const mocked = {
	pgQuery: vi.mocked(pgQuery),
	queryOne: vi.mocked(queryOne),
	queryOneOrThrow: vi.mocked(queryOneOrThrow),
	queryCount: vi.mocked(queryCount),
};

/** A raw uploads row as the Neon driver returns it (Date timestamps, bigint as string). */
function rawUploadRow(overrides: Record<string, unknown> = {}) {
	return {
		id: 'up-1',
		owner_token_hash: 'hash-abc',
		filename: 'Gardening.zip',
		title: null,
		declared_mimetype: 'application/zip',
		normalized_type: 'zip',
		size_bytes: '62914560', // bigint comes back as a string
		checksum_algo: 'sha256',
		checksum_expected: null,
		checksum_computed: null,
		checksum_verified_at: null,
		gcs_crc32c: null,
		bucket: 'textrawl-uploads',
		object_key: 'uploads/2026/05/up-1/Gardening.zip',
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
		created_at: new Date('2026-05-31T12:00:00.000Z'),
		updated_at: new Date('2026-05-31T12:00:00.000Z'),
		expires_at: null,
		completed_at: null,
		...overrides,
	};
}

beforeEach(() => {
	vi.clearAllMocks();
});

describe('createUpload', () => {
	it('inserts and returns a normalized upload (ISO dates, numeric size)', async () => {
		mocked.queryOneOrThrow.mockResolvedValueOnce(rawUploadRow());

		const upload = await createUpload({
			ownerTokenHash: 'hash-abc',
			filename: 'Gardening.zip',
			declaredMimetype: 'application/zip',
			sizeBytes: 62914560,
			bucket: 'textrawl-uploads',
			objectKey: 'uploads/2026/05/up-1/Gardening.zip',
		});

		expect(mocked.queryOneOrThrow).toHaveBeenCalledTimes(1);
		expect(upload.id).toBe('up-1');
		expect(upload.state).toBe('initialized');
		expect(upload.size_bytes).toBe(62914560);
		expect(typeof upload.size_bytes).toBe('number');
		expect(upload.created_at).toBe('2026-05-31T12:00:00.000Z');
		expect(typeof upload.created_at).toBe('string');
		expect(upload.completed_at).toBeNull();
		expect(upload.document_ids).toEqual([]);
	});
});

describe('getUpload', () => {
	it('returns null for a missing id (does not throw)', async () => {
		mocked.queryOne.mockResolvedValueOnce(null);
		await expect(getUpload('missing')).resolves.toBeNull();
	});

	it('maps a present row', async () => {
		mocked.queryOne.mockResolvedValueOnce(rawUploadRow({ state: 'queued' }));
		const upload = await getUpload('up-1');
		expect(upload?.state).toBe('queued');
		expect(upload?.created_at).toBe('2026-05-31T12:00:00.000Z');
	});
});

describe('listUploads', () => {
	it('returns empty defaults when there are no rows', async () => {
		mocked.pgQuery.mockResolvedValueOnce({ rows: [], rowCount: 0 });
		mocked.queryCount.mockResolvedValueOnce(0);
		const result = await listUploads();
		expect(result).toEqual({ uploads: [], total: 0 });
	});

	it('maps rows and total', async () => {
		mocked.pgQuery.mockResolvedValueOnce({ rows: [rawUploadRow()], rowCount: 1 });
		mocked.queryCount.mockResolvedValueOnce(1);
		const result = await listUploads({ state: 'initialized' });
		expect(result.total).toBe(1);
		expect(result.uploads[0].id).toBe('up-1');
	});
});

describe('isLegalUploadTransition (§5 graph)', () => {
	it('permits documented forward moves', () => {
		expect(isLegalUploadTransition('initialized', 'uploaded')).toBe(true);
		expect(isLegalUploadTransition('uploaded', 'queued')).toBe(true);
		expect(isLegalUploadTransition('queued', 'processing')).toBe(true);
		expect(isLegalUploadTransition('processing', 'completed')).toBe(true);
		expect(isLegalUploadTransition('processing', 'partial')).toBe(true);
		expect(isLegalUploadTransition('queued', 'cancelled')).toBe(true);
	});

	it('rejects illegal jumps and moves out of terminal states', () => {
		expect(isLegalUploadTransition('uploaded', 'completed')).toBe(false);
		expect(isLegalUploadTransition('initialized', 'processing')).toBe(false);
		expect(isLegalUploadTransition('completed', 'processing')).toBe(false);
		expect(isLegalUploadTransition('cancelled', 'uploaded')).toBe(false);
		expect(isLegalUploadTransition('processing', 'cancelled')).toBe(false);
	});
});

describe('transitionUploadState', () => {
	it('applies a legal transition via a state-gated CAS and returns the updated row', async () => {
		mocked.queryOne.mockResolvedValueOnce(rawUploadRow({ state: 'initialized' }));
		mocked.pgQuery.mockResolvedValueOnce({
			rows: [rawUploadRow({ state: 'uploaded' })],
			rowCount: 1,
		});

		const updated = await transitionUploadState('up-1', 'uploaded');

		expect(updated?.state).toBe('uploaded');
		expect(mocked.pgQuery).toHaveBeenCalledTimes(1);
		// The UPDATE is gated on the state we read (compare-and-swap).
		const [sql, params] = mocked.pgQuery.mock.calls[0];
		expect(sql).toMatch(/where id = \$1 and state = \$\d+/i);
		expect(params).toContain('initialized');
	});

	it('throws ValidationError on an illegal transition and never updates', async () => {
		mocked.queryOne.mockResolvedValueOnce(rawUploadRow({ state: 'uploaded' }));

		await expect(transitionUploadState('up-1', 'completed')).rejects.toBeInstanceOf(
			ValidationError,
		);
		expect(mocked.pgQuery).not.toHaveBeenCalled();
	});

	it('throws ValidationError when leaving a terminal state', async () => {
		mocked.queryOne.mockResolvedValueOnce(rawUploadRow({ state: 'completed' }));

		await expect(transitionUploadState('up-1', 'processing')).rejects.toBeInstanceOf(
			ValidationError,
		);
		expect(mocked.pgQuery).not.toHaveBeenCalled();
	});

	it('returns null for a missing id (does not throw)', async () => {
		mocked.queryOne.mockResolvedValueOnce(null);
		await expect(transitionUploadState('missing', 'uploaded')).resolves.toBeNull();
		expect(mocked.pgQuery).not.toHaveBeenCalled();
	});

	it('throws ValidationError when the row moved under us (CAS matched 0 rows)', async () => {
		mocked.queryOne.mockResolvedValueOnce(rawUploadRow({ state: 'initialized' }));
		// Concurrent transition/delete: the state-gated UPDATE matches nothing.
		mocked.pgQuery.mockResolvedValueOnce({ rows: [], rowCount: 0 });

		await expect(transitionUploadState('up-1', 'uploaded')).rejects.toBeInstanceOf(ValidationError);
	});
});

describe('getUploadStatus', () => {
	it('returns null for a missing id', async () => {
		mocked.queryOne.mockResolvedValueOnce(null);
		await expect(getUploadStatus('missing')).resolves.toBeNull();
	});

	it('joins per-entry rows and counts, defaulting an empty archive to zeros', async () => {
		mocked.queryOne.mockResolvedValueOnce(rawUploadRow({ state: 'processing' }));
		// entries query
		mocked.pgQuery.mockResolvedValueOnce({ rows: [], rowCount: 0 });
		// counts query — aggregate returns one row of zeros even with no entries
		mocked.queryOne.mockResolvedValueOnce({
			total: 0,
			completed: 0,
			failed: 0,
			pending: 0,
			skipped: 0,
		});

		const status = await getUploadStatus('up-1');
		expect(status?.upload.state).toBe('processing');
		expect(status?.entries).toEqual([]);
		expect(status?.counts).toEqual({
			total: 0,
			completed: 0,
			failed: 0,
			pending: 0,
			skipped: 0,
		});
	});
});
