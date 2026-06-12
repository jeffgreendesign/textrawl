/**
 * HTML handler tests (T5.2).
 *
 * The handler extracts readable text from HTML: markup is stripped, and the
 * contents of <script>/<style> never leak into the output. Registration is
 * verified through the registry so `.html`/`.htm` are valid single-file and ZIP
 * entry types.
 */
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';

import { htmlHandler } from '../handlers/html.js';
import { resolveByExtension, resolveByMime, resolveForEntry } from '../registry.js';

const FIXTURES = join(import.meta.dirname, 'fixtures');
const sampleHtml = (): Buffer => readFileSync(join(FIXTURES, 'sample.html'));

describe('html handler registration', () => {
	it('resolves by MIME and extension', () => {
		expect(resolveByMime('text/html')?.key).toBe('html');
		expect(resolveByExtension('page.html')?.key).toBe('html');
		expect(resolveByExtension('page.HTM')?.key).toBe('html');
	});

	it('resolves as a ZIP entry by extension + content', async () => {
		expect((await resolveForEntry('index.html', sampleHtml()))?.key).toBe('html');
	});
});

describe('html extraction', () => {
	it('extracts readable text from markup', async () => {
		const text = await htmlHandler.extract(sampleHtml());
		expect(text).toContain('Welcome');
		expect(text).toContain('sample');
		expect(text).toContain('First item');
		expect(text).toContain('Second item');
	});

	it('drops tags and the contents of <script>/<style>', async () => {
		const text = await htmlHandler.extract(sampleHtml());
		expect(text).not.toContain('<');
		expect(text).not.toContain('tracking pixel fired');
		expect(text).not.toContain('display: none');
		expect(text).not.toContain('#f00');
	});
});
