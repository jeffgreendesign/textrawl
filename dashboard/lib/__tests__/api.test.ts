import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import {
	cancelUpload,
	completeUpload,
	describeUploadError,
	friendlyUploadCode,
	getUploadStatus,
	initUpload,
	normalizeUploadContentType,
	pollUploadStatus,
	putResumable,
	resumableUpload,
	SUPPORTED_UPLOAD_EXTENSIONS,
	UPLOAD_ACCEPT_ATTR,
	UPLOAD_THRESHOLD_MB,
	UploadError,
} from '../api.js';

/** Minimal Response-like stub — the real client only touches these members. */
function fakeRes(opts: {
	status: number;
	ok?: boolean;
	json?: unknown;
	headers?: Record<string, string>;
}): Response {
	const headers = opts.headers ?? {};
	return {
		ok: opts.ok ?? (opts.status >= 200 && opts.status < 300),
		status: opts.status,
		statusText: '',
		headers: {
			get: (name: string) => headers[name] ?? headers[name.toLowerCase()] ?? null,
		},
		json: async () => opts.json,
		text: async () => (opts.json != null ? JSON.stringify(opts.json) : ''),
	} as unknown as Response;
}

function makeFile(size: number, name = 'sample.bin', type = 'application/octet-stream'): File {
	return new File([new Uint8Array(size)], name, { type });
}

/** Resolve the mocked fetch's recorded calls as [url, init] tuples. */
function calls(): Array<[string, RequestInit]> {
	return (global.fetch as unknown as { mock: { calls: [string, RequestInit][] } }).mock.calls;
}

function contentRange(init: RequestInit): string | undefined {
	return (init.headers as Record<string, string>)?.['Content-Range'];
}

beforeEach(() => {
	vi.stubGlobal('fetch', vi.fn());
});

afterEach(() => {
	vi.unstubAllGlobals();
	vi.unstubAllEnvs();
	vi.restoreAllMocks();
});

describe('UPLOAD_THRESHOLD_MB', () => {
	it('defaults to 20 (matching the server MAX_SINGLE_FILE_SIZE_MB)', () => {
		expect(UPLOAD_THRESHOLD_MB).toBe(20);
	});

	it('preserves an explicit threshold of 0 (always resumable)', async () => {
		vi.stubEnv('NEXT_PUBLIC_UPLOAD_THRESHOLD_MB', '0');
		vi.resetModules();
		const mod = await import('../api.js');
		expect(mod.UPLOAD_THRESHOLD_MB).toBe(0);
	});

	it('falls back to 20 for a non-numeric threshold', async () => {
		vi.stubEnv('NEXT_PUBLIC_UPLOAD_THRESHOLD_MB', 'not-a-number');
		vi.resetModules();
		const mod = await import('../api.js');
		expect(mod.UPLOAD_THRESHOLD_MB).toBe(20);
	});
});

describe('initUpload', () => {
	it('POSTs filename/size/contentType to /upload/init and returns the session', async () => {
		const session = {
			uploadId: 'u1',
			objectKey: 'uploads/2026/06/u1/sample.bin',
			bucket: 'textrawl-uploads',
			resumableUri: 'https://gcs.example/resumable',
			expiresAt: null,
			state: 'initialized',
			useDirectUpload: false,
		};
		(global.fetch as ReturnType<typeof vi.fn>).mockResolvedValueOnce(
			fakeRes({ status: 200, json: session }),
		);

		const result = await initUpload(makeFile(42, 'sample.bin', 'application/pdf'));

		expect(result).toEqual(session);
		const [url, init] = calls()[0];
		expect(url).toContain('/upload/init');
		expect(init.method).toBe('POST');
		const body = JSON.parse(init.body as string);
		expect(body).toMatchObject({
			filename: 'sample.bin',
			size: 42,
			contentType: 'application/pdf',
		});
	});

	it('maps a nested { error: { code, message } } body to a typed UploadError (never [object Object])', async () => {
		(global.fetch as ReturnType<typeof vi.fn>).mockResolvedValueOnce(
			fakeRes({
				status: 413,
				ok: false,
				json: { error: { code: 'FILE_TOO_LARGE', message: 'File exceeds the maximum size' } },
			}),
		);

		await expect(initUpload(makeFile(10))).rejects.toMatchObject({
			name: 'UploadError',
			code: 'FILE_TOO_LARGE',
			message: 'File exceeds the maximum size',
			status: 413,
		});
	});
});

describe('putResumable', () => {
	it('uploads a sub-chunk file in a single PUT with the right Content-Range', async () => {
		(global.fetch as ReturnType<typeof vi.fn>).mockResolvedValueOnce(fakeRes({ status: 200 }));
		const onProgress = vi.fn();

		await putResumable('https://gcs.example/r', makeFile(1000), {
			chunkSize: 262144,
			onProgress,
		});

		expect(calls()).toHaveLength(1);
		const [url, init] = calls()[0];
		expect(url).toBe('https://gcs.example/r');
		expect(init.method).toBe('PUT');
		// No bearer header on the GCS PUT — the URI is the capability.
		expect((init.headers as Record<string, string>).Authorization).toBeUndefined();
		expect(contentRange(init)).toBe('bytes 0-999/1000');
		expect(onProgress).toHaveBeenLastCalledWith(1000, 1000);
	});

	it('chunks a large file, honoring 308 + Range between chunks', async () => {
		const total = 600000;
		const fetchMock = global.fetch as ReturnType<typeof vi.fn>;
		fetchMock
			.mockResolvedValueOnce(fakeRes({ status: 308, headers: { Range: 'bytes=0-262143' } }))
			.mockResolvedValueOnce(fakeRes({ status: 308, headers: { Range: 'bytes=0-524287' } }))
			.mockResolvedValueOnce(fakeRes({ status: 200 }));
		const onProgress = vi.fn();

		await putResumable('https://gcs.example/r', makeFile(total), {
			chunkSize: 262144,
			onProgress,
		});

		const ranges = calls().map(([, init]) => contentRange(init));
		expect(ranges).toEqual([
			'bytes 0-262143/600000',
			'bytes 262144-524287/600000',
			'bytes 524288-599999/600000',
		]);
		expect(onProgress).toHaveBeenLastCalledWith(total, total);
	});

	it('throws on a malformed 308 Range header instead of silently skipping bytes', async () => {
		(global.fetch as ReturnType<typeof vi.fn>).mockResolvedValueOnce(
			fakeRes({ status: 308, headers: { Range: 'bogus' } }),
		);

		await expect(
			putResumable('https://gcs.example/r', makeFile(600000), {
				chunkSize: 262144,
				maxRetries: 0,
			}),
		).rejects.toThrow(/Malformed resumable Range/);
	});

	it('re-probes the committed offset and resumes after a transient failure', async () => {
		const total = 300000;
		const fetchMock = global.fetch as ReturnType<typeof vi.fn>;
		fetchMock
			.mockRejectedValueOnce(new Error('network dropped')) // chunk 0 PUT fails
			.mockResolvedValueOnce(fakeRes({ status: 308, headers: { Range: 'bytes=0-262143' } })) // probe
			.mockResolvedValueOnce(fakeRes({ status: 200 })); // resumed final chunk

		await putResumable('https://gcs.example/r', makeFile(total), {
			chunkSize: 262144,
			retryDelayMs: 0,
		});

		const reqs = calls();
		expect(reqs).toHaveLength(3);
		// The probe is an empty PUT with `bytes */<total>`.
		expect(contentRange(reqs[1][1])).toBe('bytes */300000');
		// Resume continues from the probed offset.
		expect(contentRange(reqs[2][1])).toBe('bytes 262144-299999/300000');
	});

	it('surfaces a 4xx (non-resumable) immediately without retrying', async () => {
		(global.fetch as ReturnType<typeof vi.fn>).mockResolvedValueOnce(
			fakeRes({
				status: 410,
				ok: false,
				json: { error: { code: 'UPLOAD_EXPIRED', message: 'gone' } },
			}),
		);

		await expect(
			putResumable('https://gcs.example/r', makeFile(1000), { chunkSize: 262144 }),
		).rejects.toMatchObject({ code: 'UPLOAD_EXPIRED', status: 410 });
		expect(calls()).toHaveLength(1);
	});
});

describe('completeUpload / getUploadStatus / cancelUpload', () => {
	it('completeUpload returns the 202 body', async () => {
		(global.fetch as ReturnType<typeof vi.fn>).mockResolvedValueOnce(
			fakeRes({
				status: 202,
				json: { uploadId: 'u1', state: 'queued', statusUrl: '/api/upload/u1/status' },
			}),
		);
		const result = await completeUpload('u1');
		expect(result).toMatchObject({ uploadId: 'u1', state: 'queued' });
		expect(calls()[0][0]).toContain('/upload/complete');
	});

	it('getUploadStatus returns the parsed status', async () => {
		const status = {
			uploadId: 'u1',
			state: 'processing',
			progress: { entriesTotal: 2, entriesProcessed: 1, entriesFailed: 0 },
		};
		(global.fetch as ReturnType<typeof vi.fn>).mockResolvedValueOnce(
			fakeRes({ status: 200, json: status }),
		);
		const result = await getUploadStatus('u1');
		expect(result).toMatchObject({ state: 'processing' });
		expect(calls()[0][0]).toContain('/upload/u1/status');
	});

	it('cancelUpload tolerates 404/409 races but throws on real errors', async () => {
		const fetchMock = global.fetch as ReturnType<typeof vi.fn>;
		fetchMock.mockResolvedValueOnce(fakeRes({ status: 404, ok: false }));
		await expect(cancelUpload('gone')).resolves.toBeUndefined();

		fetchMock.mockResolvedValueOnce(
			fakeRes({ status: 500, ok: false, json: { error: { code: 'X', message: 'boom' } } }),
		);
		await expect(cancelUpload('u1')).rejects.toBeInstanceOf(UploadError);
	});
});

describe('pollUploadStatus', () => {
	it('polls until a terminal state, invoking onUpdate each tick', async () => {
		const fetchMock = global.fetch as ReturnType<typeof vi.fn>;
		fetchMock
			.mockResolvedValueOnce(
				fakeRes({
					status: 200,
					json: {
						uploadId: 'u1',
						state: 'processing',
						progress: { entriesTotal: 2, entriesProcessed: 1, entriesFailed: 0 },
					},
				}),
			)
			.mockResolvedValueOnce(
				fakeRes({
					status: 200,
					json: {
						uploadId: 'u1',
						state: 'completed',
						progress: { entriesTotal: 2, entriesProcessed: 2, entriesFailed: 0 },
					},
				}),
			);
		const onUpdate = vi.fn();

		const final = await pollUploadStatus('u1', { onUpdate, intervalMs: 0 });

		expect(final.state).toBe('completed');
		expect(onUpdate).toHaveBeenCalledTimes(2);
	});

	it('stops on a partial terminal state', async () => {
		(global.fetch as ReturnType<typeof vi.fn>).mockResolvedValueOnce(
			fakeRes({
				status: 200,
				json: {
					uploadId: 'u1',
					state: 'partial',
					progress: { entriesTotal: 3, entriesProcessed: 2, entriesFailed: 1 },
				},
			}),
		);
		const final = await pollUploadStatus('u1', { intervalMs: 0 });
		expect(final.state).toBe('partial');
		expect(calls()).toHaveLength(1);
	});
});

describe('resumableUpload (orchestrator)', () => {
	it('runs init → PUT → complete → poll and exposes the uploadId early', async () => {
		const fetchMock = global.fetch as ReturnType<typeof vi.fn>;
		fetchMock
			.mockResolvedValueOnce(
				fakeRes({
					status: 200,
					json: {
						uploadId: 'u9',
						objectKey: 'k',
						bucket: 'b',
						resumableUri: 'https://gcs.example/r',
						expiresAt: null,
						state: 'initialized',
						useDirectUpload: false,
					},
				}),
			) // init
			.mockResolvedValueOnce(fakeRes({ status: 200 })) // single-chunk PUT
			.mockResolvedValueOnce(
				fakeRes({ status: 202, json: { uploadId: 'u9', state: 'queued', statusUrl: '/x' } }),
			) // complete
			.mockResolvedValueOnce(
				fakeRes({
					status: 200,
					json: {
						uploadId: 'u9',
						state: 'completed',
						progress: { entriesTotal: 1, entriesProcessed: 1, entriesFailed: 0 },
					},
				}),
			); // status

		const onInit = vi.fn();
		const onQueued = vi.fn();
		let resolveDone: (s: { state: string }) => void = () => {};
		const done = new Promise<{ state: string }>((r) => {
			resolveDone = r;
		});

		// Resolves at "queued" (after complete) — NOT after processing finishes.
		const ret = await resumableUpload(makeFile(1000), {
			onInit,
			onQueued,
			onProcessingComplete: (s) => resolveDone(s),
		});

		expect(ret).toBeUndefined();
		expect(onInit).toHaveBeenCalledWith(expect.objectContaining({ uploadId: 'u9' }));
		expect(onQueued).toHaveBeenCalledTimes(1);

		// The background poll then delivers the terminal status via callback.
		const final = await done;
		expect(final.state).toBe('completed');

		const urls = calls().map(([u]) => u);
		expect(urls[0]).toContain('/upload/init');
		expect(urls[1]).toBe('https://gcs.example/r');
		expect(urls[2]).toContain('/upload/complete');
		expect(urls[3]).toContain('/upload/u9/status');
	});
});

describe('support matrix (§8a "Supported now")', () => {
	it('accept attribute matches exactly the supported extension set', () => {
		expect(UPLOAD_ACCEPT_ATTR).toBe('.txt,.md,.pdf,.docx,.csv,.xlsx,.json,.html,.htm,.zip');
		expect([...SUPPORTED_UPLOAD_EXTENSIONS]).toEqual([
			'.txt',
			'.md',
			'.pdf',
			'.docx',
			'.csv',
			'.xlsx',
			'.json',
			'.html',
			'.htm',
			'.zip',
		]);
	});

	it('does not advertise images, audio, MBOX, or EML', () => {
		for (const banned of ['.png', '.jpg', '.mp3', '.wav', '.mbox', '.eml']) {
			expect(UPLOAD_ACCEPT_ATTR).not.toContain(banned);
		}
	});
});

describe('normalizeUploadContentType', () => {
	it('normalizes ZIP by extension regardless of the browser-declared type', () => {
		expect(normalizeUploadContentType(makeFile(1, 'a.zip', ''))).toBe('application/zip');
		expect(normalizeUploadContentType(makeFile(1, 'a.zip', 'application/x-zip-compressed'))).toBe(
			'application/zip',
		);
		expect(normalizeUploadContentType(makeFile(1, 'A.ZIP', ''))).toBe('application/zip');
	});

	it('passes through a known type and maps empty type to undefined', () => {
		expect(normalizeUploadContentType(makeFile(1, 'a.pdf', 'application/pdf'))).toBe(
			'application/pdf',
		);
		expect(normalizeUploadContentType(makeFile(1, 'a.bin', ''))).toBeUndefined();
	});

	it('initUpload sends the normalized ZIP contentType', async () => {
		(global.fetch as ReturnType<typeof vi.fn>).mockResolvedValueOnce(
			fakeRes({ status: 200, json: { uploadId: 'z', resumableUri: 'r' } }),
		);
		await initUpload(makeFile(10, 'archive.zip', ''));
		const body = JSON.parse(calls()[0][1].body as string);
		expect(body.contentType).toBe('application/zip');
	});
});

describe('describeUploadError / friendlyUploadCode', () => {
	it('maps each stable server code to friendly text (never [object Object])', () => {
		const cases: Array<[string, RegExp]> = [
			['FILE_TOO_LARGE', /maximum upload size/i],
			['UNSUPPORTED_TYPE', /isn't supported/i],
			['UNSUPPORTED_ENTRY', /archive contains/i],
			['SIZE_MISMATCH', /didn't finish/i],
			['OBJECT_NOT_FOUND', /didn't finish/i],
			['CHECKSUM_MISMATCH', /integrity check/i],
			['UPLOAD_EXPIRED', /expired/i],
			['ZIP_PATH_TRAVERSAL', /unsafe file path/i],
			['ZIP_BOMB', /expands too much/i],
			['ZIP_TOO_MANY_ENTRIES', /too many files/i],
			['ZIP_ENTRY_TOO_LARGE', /too large/i],
			['ZIP_NESTED_ARCHIVE', /nested/i],
			['ZIP_NO_SUPPORTED_ENTRIES', /no supported files/i],
		];
		for (const [code, pattern] of cases) {
			const text = describeUploadError(new UploadError('raw', code, 400));
			expect(text).toMatch(pattern);
			expect(text).not.toContain('[object Object]');
		}
	});

	it('falls back to the raw message for an unknown code', () => {
		expect(describeUploadError(new UploadError('something specific', 'WEIRD_CODE', 400))).toBe(
			'something specific',
		);
	});

	it('treats a fetch TypeError as a connectivity failure', () => {
		expect(describeUploadError(new TypeError('Load failed'))).toMatch(/couldn't reach the server/i);
	});

	it('friendlyUploadCode returns the fallback when code is null/unknown', () => {
		expect(friendlyUploadCode(null, 'fallback')).toBe('fallback');
		expect(friendlyUploadCode('NOPE', 'fallback')).toBe('fallback');
		expect(friendlyUploadCode('FILE_TOO_LARGE', 'fallback')).toMatch(/maximum upload size/i);
	});
});
