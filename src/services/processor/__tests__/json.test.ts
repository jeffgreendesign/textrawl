import { describe, expect, it } from 'vitest';

import { jsonHandler } from '../handlers/json.js';

describe('json handler extract', () => {
	it('returns valid JSON as-is without pretty-print inflation', async () => {
		// A dense, minified object (the shape that ballooned heap when re-indented).
		const obj = { items: Array.from({ length: 50_000 }, (_, i) => ({ i, t: 1700000000 + i })) };
		const minified = JSON.stringify(obj);
		const out = await jsonHandler.extract(Buffer.from(minified, 'utf-8'));

		// Output must equal input byte-for-byte — no re-serialization, no whitespace blowup.
		expect(out).toBe(minified);
		// Guard against regressing to JSON.stringify(parse, null, 2), which would be
		// far larger than the minified input.
		expect(out.length).toBeLessThanOrEqual(minified.length);
	});

	it('returns invalid JSON as raw text rather than failing', async () => {
		const notJson = '{ this is not: valid json ,,,';
		const out = await jsonHandler.extract(Buffer.from(notJson, 'utf-8'));
		expect(out).toBe(notJson);
	});
});
