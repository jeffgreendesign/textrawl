import { describe, expect, it } from 'vitest';
import { stripCodeFence } from '../json.js';

describe('stripCodeFence', () => {
	it('returns the inner text of a fully fenced ```json block', () => {
		const input = '```json\n{"entities": []}\n```';
		expect(stripCodeFence(input)).toBe('{"entities": []}');
	});

	it('handles a bare ``` fence with no language tag', () => {
		expect(stripCodeFence('```\n[1, 2, 3]\n```')).toBe('[1, 2, 3]');
	});

	it('strips a leading opening fence when the closing ``` is missing (truncated)', () => {
		// The exact shape that produced `Unexpected token '`'` in production: the model
		// hit max_tokens, so there is no closing fence.
		const truncated = '```json\n{\n  "entities": [\n    { "name": "Ada"';
		expect(stripCodeFence(truncated)).toBe('{\n  "entities": [\n    { "name": "Ada"');
	});

	it('returns unfenced text unchanged (trimmed)', () => {
		expect(stripCodeFence('  {"ok": true}  ')).toBe('{"ok": true}');
	});

	it('lets a fenced object parse where a raw parse of the whole response would throw', () => {
		const fenced = '```json\n{"entities": [], "relations": []}\n```';
		expect(() => JSON.parse(fenced)).toThrow();
		expect(() => JSON.parse(stripCodeFence(fenced))).not.toThrow();
	});
});
