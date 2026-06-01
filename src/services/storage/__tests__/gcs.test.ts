/**
 * GCS StorageService tests (T3.1).
 *
 * The `@google-cloud/storage` client is fully mocked — these are hermetic unit
 * tests with no network or real bucket. They pin the plan §4 storage port:
 * server-initiated resumable session, metadata-only `headObject` (with 404 →
 * null), and idempotent `abortSession`. The object key is always the one the
 * caller passes (server-generated upstream) — never derived from client input.
 */
import { beforeEach, describe, expect, it, vi } from 'vitest';

const { storageCtor, bucketFn, fileFn, file } = vi.hoisted(() => {
	const file = {
		createResumableUpload: vi.fn(),
		getMetadata: vi.fn(),
		delete: vi.fn(),
	};
	const fileFn = vi.fn(() => file);
	const bucketFn = vi.fn(() => ({ file: fileFn }));
	// Regular function (not arrow) so `new Storage(...)` is constructable.
	const storageCtor = vi.fn(function StorageMock() {
		return { bucket: bucketFn };
	});
	return { storageCtor, bucketFn, fileFn, file };
});

vi.mock('@google-cloud/storage', () => ({ Storage: storageCtor }));
vi.mock('../../../utils/logger.js', () => ({
	logger: { debug: vi.fn(), info: vi.fn(), warn: vi.fn(), error: vi.fn() },
}));

import { GcsStorageService } from '../gcs.js';

const OBJECT_KEY = 'uploads/2026/06/abc-123/Gardening.zip';

function makeService() {
	return new GcsStorageService({
		bucket: 'textrawl-uploads',
		projectId: 'textrawl',
		sessionTtlMinutes: 120,
	});
}

beforeEach(() => {
	vi.clearAllMocks();
});

describe('GcsStorageService', () => {
	it('constructs the client with the configured project', () => {
		makeService();
		expect(storageCtor).toHaveBeenCalledWith({ projectId: 'textrawl' });
	});

	it('resolves the configured bucket when an operation runs', async () => {
		file.getMetadata.mockResolvedValue([{ size: '1', generation: '1', crc32c: 'x', etag: 'e' }]);
		await makeService().headObject(OBJECT_KEY);
		expect(bucketFn).toHaveBeenCalledWith('textrawl-uploads');
	});

	describe('startResumableSession', () => {
		it('opens a session for the given object key and returns the GCS URI', async () => {
			file.createResumableUpload.mockResolvedValue([
				'https://storage.googleapis.com/upload/resumable?id=xyz',
			]);

			const res = await makeService().startResumableSession(OBJECT_KEY, {
				contentType: 'application/zip',
				size: 100,
				origin: 'https://dashboard-lilac-one-63.vercel.app',
			});

			// Operates on exactly the key it was handed (server-generated upstream).
			expect(fileFn).toHaveBeenCalledWith(OBJECT_KEY);
			expect(res.resumableUri).toBe('https://storage.googleapis.com/upload/resumable?id=xyz');
			expect(typeof res.expiresAt).toBe('string');
			expect(Number.isNaN(Date.parse(res.expiresAt))).toBe(false);
		});

		it('passes content type and origin into the resumable session', async () => {
			file.createResumableUpload.mockResolvedValue(['https://uri']);

			await makeService().startResumableSession(OBJECT_KEY, {
				contentType: 'application/zip',
				size: 100,
				origin: 'https://dashboard-lilac-one-63.vercel.app',
			});

			expect(file.createResumableUpload).toHaveBeenCalledWith(
				expect.objectContaining({
					metadata: expect.objectContaining({ contentType: 'application/zip' }),
					origin: 'https://dashboard-lilac-one-63.vercel.app',
				}),
			);
		});

		it('omits origin when none is provided', async () => {
			file.createResumableUpload.mockResolvedValue(['https://uri']);

			await makeService().startResumableSession(OBJECT_KEY, { size: 100 });

			const opts = file.createResumableUpload.mock.calls[0][0];
			expect(opts.origin).toBeUndefined();
		});
	});

	describe('headObject', () => {
		it('maps GCS metadata to size/generation/crc32c/etag', async () => {
			file.getMetadata.mockResolvedValue([
				{ size: '62914560', generation: '1780326372876548044', crc32c: 'AAAAAA==', etag: 'abc' },
			]);

			const meta = await makeService().headObject(OBJECT_KEY);

			expect(fileFn).toHaveBeenCalledWith(OBJECT_KEY);
			expect(meta).toEqual({
				size: 62914560,
				generation: '1780326372876548044',
				crc32c: 'AAAAAA==',
				etag: 'abc',
			});
		});

		it('returns null when the object does not exist (404)', async () => {
			file.getMetadata.mockRejectedValue(Object.assign(new Error('Not Found'), { code: 404 }));

			const meta = await makeService().headObject(OBJECT_KEY);
			expect(meta).toBeNull();
		});

		it('rethrows non-404 errors', async () => {
			file.getMetadata.mockRejectedValue(Object.assign(new Error('boom'), { code: 500 }));

			await expect(makeService().headObject(OBJECT_KEY)).rejects.toThrow('boom');
		});
	});

	describe('abortSession', () => {
		it('deletes the object, ignoring a missing object', async () => {
			file.delete.mockResolvedValue([{}]);

			await makeService().abortSession(OBJECT_KEY);

			expect(fileFn).toHaveBeenCalledWith(OBJECT_KEY);
			expect(file.delete).toHaveBeenCalledWith(expect.objectContaining({ ignoreNotFound: true }));
		});

		it('does not throw when delete reports the object is already gone', async () => {
			file.delete.mockRejectedValue(Object.assign(new Error('Not Found'), { code: 404 }));

			await expect(makeService().abortSession(OBJECT_KEY)).resolves.toBeUndefined();
		});
	});
});
