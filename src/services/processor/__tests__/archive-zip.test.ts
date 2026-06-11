/**
 * Safe-ZIP validation tests (T5.3).
 *
 * `validateZip` reads the central directory (via a mocked `unzipper`) and
 * enforces every §9 safety rule *before* decompression: archive-level limits
 * (entry count / compressed / expanded / ratio / per-entry size) and per-entry
 * path safety (traversal / absolute / drive / backslash / symlink / over-long
 * name) and nested-archive rejection all throw with a stable `ZIP_*` code; OS
 * junk is silently skipped; unsupported entries are recorded as skipped; and
 * supported entries come back as lazily-read candidates. The real registry
 * resolves extensions (so `normalizedType` is a real handler key).
 */
import { beforeEach, describe, expect, it, vi } from 'vitest';

const { mockOpen, mockConfig } = vi.hoisted(() => ({
	mockOpen: { buffer: vi.fn() },
	mockConfig: {
		ZIP_MAX_ENTRIES: 2000,
		ZIP_MAX_COMPRESSED_BYTES: undefined as number | undefined,
		ZIP_MAX_EXPANDED_BYTES: 2_000_000_000,
		ZIP_MAX_ENTRY_BYTES: 50_000_000,
		ZIP_MAX_COMPRESSION_RATIO: 100,
		ZIP_MAX_FILENAME_LEN: 255,
		MAX_UPLOAD_SIZE_MB: 500,
	},
}));

vi.mock('unzipper', () => ({ Open: mockOpen }));
vi.mock('../../../utils/config.js', () => ({ config: mockConfig }));
vi.mock('../../../utils/logger.js', () => ({
	logger: { debug: vi.fn(), info: vi.fn(), warn: vi.fn(), error: vi.fn() },
}));

import { validateZip } from '../handlers/archive-zip.js';

// externalFileAttributes high 16 bits carry the Unix mode.
const REGULAR_ATTR = 0o100644 * 0x10000;
const SYMLINK_ATTR = 0o120755 * 0x10000;

interface FakeOpts {
	type?: 'File' | 'Directory';
	uSize?: number;
	cSize?: number;
	attr?: number;
	buf?: Buffer;
}

function entry(path: string, opts: FakeOpts = {}) {
	return {
		path,
		type: opts.type ?? 'File',
		uncompressedSize: opts.uSize ?? 10,
		compressedSize: opts.cSize ?? 10,
		compressionMethod: 8,
		externalFileAttributes: opts.attr ?? REGULAR_ATTR,
		buffer: vi.fn(async () => opts.buf ?? Buffer.from('content')),
	};
}

function mockZip(files: ReturnType<typeof entry>[]) {
	mockOpen.buffer.mockResolvedValue({ files });
}

const BUF = Buffer.from('zip-bytes');

beforeEach(() => {
	vi.clearAllMocks();
	mockConfig.ZIP_MAX_ENTRIES = 2000;
	mockConfig.ZIP_MAX_COMPRESSED_BYTES = undefined;
	mockConfig.ZIP_MAX_EXPANDED_BYTES = 2_000_000_000;
	mockConfig.ZIP_MAX_ENTRY_BYTES = 50_000_000;
	mockConfig.ZIP_MAX_COMPRESSION_RATIO = 100;
	mockConfig.ZIP_MAX_FILENAME_LEN = 255;
});

describe('validateZip — entry collection', () => {
	it('returns supported entries as candidates and unsupported as skipped', async () => {
		mockZip([
			entry('notes/a.txt', { uSize: 100 }),
			entry('data/b.json'),
			entry('photo.png'),
			entry('nested/', { type: 'Directory' }),
		]);

		const result = await validateZip(BUF);

		expect(result.candidates.map((c) => c.entryPath)).toEqual(['notes/a.txt', 'data/b.json']);
		expect(result.candidates[0].normalizedType).toBe('text');
		expect(result.candidates[1].normalizedType).toBe('json');
		expect(result.candidates[0].sizeBytes).toBe(100);
		expect(result.skipped.map((s) => s.entryPath)).toEqual(['photo.png']);
		expect(result.skipped[0].errorCode).toBe('UNSUPPORTED_ENTRY');
	});

	it('reads a candidate lazily through its read()', async () => {
		const e = entry('a.txt', { buf: Buffer.from('hello entry') });
		mockZip([e]);

		const { candidates } = await validateZip(BUF);
		expect(e.buffer).not.toHaveBeenCalled(); // not decompressed during validation
		const buf = await candidates[0].read();
		expect(buf.toString()).toBe('hello entry');
		expect(e.buffer).toHaveBeenCalledTimes(1);
	});

	it('silently skips OS junk (not candidate, not recorded)', async () => {
		mockZip([
			entry('__MACOSX/._a.txt'),
			entry('.DS_Store'),
			entry('sub/Thumbs.db'),
			entry('real.txt'),
		]);

		const { candidates, skipped } = await validateZip(BUF);
		expect(candidates.map((c) => c.entryPath)).toEqual(['real.txt']);
		expect(skipped).toEqual([]);
	});

	it('returns no candidates when nothing is supported', async () => {
		mockZip([entry('a.png'), entry('b.exe')]);
		const { candidates, skipped } = await validateZip(BUF);
		expect(candidates).toEqual([]);
		expect(skipped).toHaveLength(2);
	});
});

describe('validateZip — path safety (archive-level)', () => {
	it.each([
		['parent traversal', '../escape.txt'],
		['nested traversal', 'a/../../escape.txt'],
		['absolute path', '/etc/passwd.txt'],
		['windows drive', 'C:\\secret.txt'],
		['backslash separator', 'a\\b.txt'],
	])('rejects %s with ZIP_PATH_TRAVERSAL', async (_label, path) => {
		mockZip([entry(path)]);
		await expect(validateZip(BUF)).rejects.toMatchObject({ code: 'ZIP_PATH_TRAVERSAL' });
	});

	it('rejects symlink entries with ZIP_PATH_TRAVERSAL', async () => {
		mockZip([entry('link.txt', { attr: SYMLINK_ATTR })]);
		await expect(validateZip(BUF)).rejects.toMatchObject({ code: 'ZIP_PATH_TRAVERSAL' });
	});

	it('rejects an over-long entry name with ZIP_PATH_TRAVERSAL', async () => {
		mockConfig.ZIP_MAX_FILENAME_LEN = 20;
		mockZip([entry(`${'x'.repeat(40)}.txt`)]);
		await expect(validateZip(BUF)).rejects.toMatchObject({ code: 'ZIP_PATH_TRAVERSAL' });
	});
});

describe('validateZip — nested archives (archive-level)', () => {
	it.each(['inner.zip', 'bundle.tar', 'data.gz', 'archive.7z'])(
		'rejects nested %s with ZIP_NESTED_ARCHIVE',
		async (path) => {
			mockZip([entry(path)]);
			await expect(validateZip(BUF)).rejects.toMatchObject({ code: 'ZIP_NESTED_ARCHIVE' });
		},
	);
});

describe('validateZip — bomb / size limits (archive-level)', () => {
	it('rejects too many entries with ZIP_TOO_MANY_ENTRIES', async () => {
		mockConfig.ZIP_MAX_ENTRIES = 2;
		mockZip([entry('a.txt'), entry('b.txt'), entry('c.txt')]);
		await expect(validateZip(BUF)).rejects.toMatchObject({ code: 'ZIP_TOO_MANY_ENTRIES' });
	});

	it('rejects an oversized single entry with ZIP_ENTRY_TOO_LARGE', async () => {
		mockConfig.ZIP_MAX_ENTRY_BYTES = 1000;
		mockZip([entry('a.txt', { uSize: 5000, cSize: 5000 })]);
		await expect(validateZip(BUF)).rejects.toMatchObject({ code: 'ZIP_ENTRY_TOO_LARGE' });
	});

	it('rejects excessive total expansion with ZIP_BOMB', async () => {
		mockConfig.ZIP_MAX_EXPANDED_BYTES = 1000;
		mockZip([
			entry('a.txt', { uSize: 800, cSize: 800 }),
			entry('b.txt', { uSize: 800, cSize: 800 }),
		]);
		await expect(validateZip(BUF)).rejects.toMatchObject({ code: 'ZIP_BOMB' });
	});

	it('rejects an excessive compression ratio with ZIP_BOMB', async () => {
		// 80 MB expanded from 100 bytes compressed → ratio 800k ≫ 100; each entry
		// under the per-entry and total-expanded caps.
		mockZip([
			entry('a.txt', { uSize: 40_000_000, cSize: 50 }),
			entry('b.txt', { uSize: 40_000_000, cSize: 50 }),
		]);
		await expect(validateZip(BUF)).rejects.toMatchObject({ code: 'ZIP_BOMB' });
	});

	it('rejects an oversized compressed archive with ZIP_BOMB', async () => {
		mockConfig.ZIP_MAX_COMPRESSED_BYTES = 1000;
		mockZip([entry('a.txt', { uSize: 1500, cSize: 1500 })]);
		await expect(validateZip(BUF)).rejects.toMatchObject({ code: 'ZIP_BOMB' });
	});
});
