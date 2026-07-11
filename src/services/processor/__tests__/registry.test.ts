/**
 * File-handler registry tests (T5.1).
 *
 * Pins the registry contract the `processor.ts` façade delegates to: resolution
 * by MIME, by extension, and by extension-plus-magic (`resolveForEntry`, the ZIP
 * path); the original four types (pdf/docx/txt/md) still extract; and the newly
 * wired csv/xlsx/json types extract their expected text. `unpdf`/`mammoth`
 * are mocked (binary-parser behaviour is third-party, not ours) —
 * text/csv/json/xlsx use real fixtures.
 */
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it, vi } from 'vitest';

vi.mock('unpdf', () => ({
	extractText: vi.fn(async () => ({ text: 'PDF EXTRACTED', totalPages: 1 })),
}));
vi.mock('mammoth', () => ({
	default: { extractRawText: vi.fn(async () => ({ value: 'DOCX EXTRACTED' })) },
}));

import {
	extractByMime,
	isSupportedMime,
	resolveByExtension,
	resolveByMime,
	resolveForEntry,
	supportedExtensions,
	validateMimeContent,
} from '../registry.js';

const FIXTURES = join(import.meta.dirname, 'fixtures');
const fixture = (name: string): Buffer => readFileSync(join(FIXTURES, name));

const DOCX_MIME = 'application/vnd.openxmlformats-officedocument.wordprocessingml.document';
const XLSX_MIME = 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet';
// A real PDF header — enough for file-type's magic sniff, no body needed.
const PDF_MAGIC = Buffer.from('%PDF-1.4\n%âãÏÓ\n', 'latin1');

describe('registry resolution', () => {
	it('resolves the original four types by MIME', () => {
		expect(resolveByMime('application/pdf')?.key).toBe('pdf');
		expect(resolveByMime(DOCX_MIME)?.key).toBe('docx');
		expect(resolveByMime('text/plain')?.key).toBe('text');
		expect(resolveByMime('text/markdown')?.key).toBe('text');
	});

	it('resolves the newly wired Tier-1 types by MIME', () => {
		expect(resolveByMime('text/csv')?.key).toBe('csv');
		expect(resolveByMime(XLSX_MIME)?.key).toBe('xlsx');
		expect(resolveByMime('application/json')?.key).toBe('json');
	});

	it('returns undefined for an unsupported MIME', () => {
		expect(resolveByMime('application/x-msdownload')).toBeUndefined();
	});

	it('ignores MIME parameters and casing (e.g. charset)', () => {
		expect(resolveByMime('text/html; charset=utf-8')?.key).toBe('html');
		expect(resolveByMime('TEXT/PLAIN; charset=UTF-8')?.key).toBe('text');
		expect(isSupportedMime('application/json; charset=utf-8')).toBe(true);
	});

	it('resolves by extension, case-insensitively', () => {
		expect(resolveByExtension('NOTES.MD')?.key).toBe('text');
		expect(resolveByExtension('report.pdf')?.key).toBe('pdf');
		expect(resolveByExtension('data.csv')?.key).toBe('csv');
		expect(resolveByExtension('book.xlsx')?.key).toBe('xlsx');
		expect(resolveByExtension('weird.exe')).toBeUndefined();
		expect(resolveByExtension('no-extension')).toBeUndefined();
	});

	it('reports supported MIME types and extensions', () => {
		expect(isSupportedMime('application/pdf')).toBe(true);
		expect(isSupportedMime('application/json')).toBe(true);
		expect(isSupportedMime('image/png')).toBe(false);
		const exts = supportedExtensions();
		for (const ext of ['pdf', 'docx', 'txt', 'md', 'csv', 'xlsx', 'json']) {
			expect(exts).toContain(ext);
		}
	});
});

describe('extractByMime', () => {
	it('extracts plain text and markdown verbatim', async () => {
		expect(await extractByMime(fixture('sample.txt'), 'text/plain')).toContain('text fixture');
		expect(await extractByMime(fixture('sample.md'), 'text/markdown')).toContain('# Heading');
	});

	it('extracts csv content', async () => {
		const text = await extractByMime(fixture('sample.csv'), 'text/csv');
		expect(text).toContain('name,age');
		expect(text).toContain('Ada');
	});

	it('extracts json as pretty-printed text', async () => {
		const text = await extractByMime(fixture('sample.json'), 'application/json');
		expect(text).toContain('"title"');
		expect(text).toContain('Note');
		// Pretty-printed → spans multiple lines.
		expect(text.split('\n').length).toBeGreaterThan(1);
	});

	it('extracts xlsx cell values as text', async () => {
		const text = await extractByMime(fixture('sample.xlsx'), XLSX_MIME);
		expect(text).toContain('Name');
		expect(text).toContain('Ada');
		expect(text).toContain('36');
	});

	it('delegates pdf and docx extraction to their parsers', async () => {
		expect(await extractByMime(PDF_MAGIC, 'application/pdf')).toBe('PDF EXTRACTED');
		expect(await extractByMime(Buffer.from('PK'), DOCX_MIME)).toBe('DOCX EXTRACTED');
	});

	it('throws ValidationError for an unsupported MIME', async () => {
		await expect(extractByMime(Buffer.from('x'), 'application/x-msdownload')).rejects.toThrow(
			/unsupported file type/i,
		);
	});
});

describe('validateMimeContent (magic sniff)', () => {
	it('accepts content whose magic matches the declared binary type', async () => {
		expect(await validateMimeContent(PDF_MAGIC, 'application/pdf')).toBe(true);
		expect(await validateMimeContent(fixture('sample.xlsx'), XLSX_MIME)).toBe(true);
	});

	it('accepts text-bearing types that have no magic signature', async () => {
		expect(await validateMimeContent(fixture('sample.txt'), 'text/plain')).toBe(true);
		expect(await validateMimeContent(fixture('sample.csv'), 'text/csv')).toBe(true);
		expect(await validateMimeContent(fixture('sample.json'), 'application/json')).toBe(true);
	});

	it('rejects binary types whose content does not match the magic', async () => {
		expect(await validateMimeContent(Buffer.from('not a pdf at all'), 'application/pdf')).toBe(
			false,
		);
	});

	it('rejects an unsupported MIME outright', async () => {
		expect(await validateMimeContent(PDF_MAGIC, 'application/x-msdownload')).toBe(false);
	});
});

describe('resolveForEntry (extension + magic, the ZIP path)', () => {
	it('resolves supported entries by extension and content', async () => {
		expect((await resolveForEntry('doc.pdf', PDF_MAGIC))?.key).toBe('pdf');
		expect((await resolveForEntry('notes.md', fixture('sample.md')))?.key).toBe('text');
		expect((await resolveForEntry('data.csv', fixture('sample.csv')))?.key).toBe('csv');
		expect((await resolveForEntry('book.xlsx', fixture('sample.xlsx')))?.key).toBe('xlsx');
	});

	it('rejects an entry whose extension lies about its content', async () => {
		// Claims .pdf but the bytes are plain text — content sniff fails.
		expect(await resolveForEntry('fake.pdf', Buffer.from('just text'))).toBeUndefined();
	});

	it('rejects entries with an unsupported extension', async () => {
		expect(await resolveForEntry('malware.exe', Buffer.from('MZ'))).toBeUndefined();
	});
});
