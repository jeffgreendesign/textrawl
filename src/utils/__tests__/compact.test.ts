import { beforeEach, describe, expect, it, vi } from 'vitest';

// Mock the config module before importing compact
vi.mock('../config.js', () => ({
	config: { COMPACT_RESPONSES: true },
}));

import { configError, formatId, isCompact, toJSON, toolError, toolResponse } from '../compact.js';
import { config } from '../config.js';

describe('compact utilities', () => {
	beforeEach(() => {
		(config as { COMPACT_RESPONSES: boolean }).COMPACT_RESPONSES = false;
	});

	describe('isCompact', () => {
		it('returns true when COMPACT_RESPONSES is true', () => {
			(config as { COMPACT_RESPONSES: boolean }).COMPACT_RESPONSES = true;
			expect(isCompact()).toBe(true);
		});

		it('returns false when COMPACT_RESPONSES is false', () => {
			(config as { COMPACT_RESPONSES: boolean }).COMPACT_RESPONSES = false;
			expect(isCompact()).toBe(false);
		});
	});

	describe('toJSON', () => {
		it('returns compact JSON when COMPACT_RESPONSES is true', () => {
			(config as { COMPACT_RESPONSES: boolean }).COMPACT_RESPONSES = true;
			const result = toJSON({ a: 1, b: 'hello' });
			expect(result).toBe('{"a":1,"b":"hello"}');
		});

		it('returns pretty-printed JSON when COMPACT_RESPONSES is false', () => {
			(config as { COMPACT_RESPONSES: boolean }).COMPACT_RESPONSES = false;
			const result = toJSON({ a: 1 });
			expect(result).toContain('\n');
			expect(JSON.parse(result)).toEqual({ a: 1 });
		});
	});

	describe('formatId', () => {
		const uuid = 'a1b2c3d4-e5f6-7890-abcd-ef1234567890';

		it('truncates UUID to 8 chars in compact mode', () => {
			(config as { COMPACT_RESPONSES: boolean }).COMPACT_RESPONSES = true;
			expect(formatId(uuid)).toBe('a1b2c3d4');
		});

		it('returns full UUID in verbose mode', () => {
			(config as { COMPACT_RESPONSES: boolean }).COMPACT_RESPONSES = false;
			expect(formatId(uuid)).toBe(uuid);
		});
	});

	describe('toolError', () => {
		it('returns error response with isError: true', () => {
			(config as { COMPACT_RESPONSES: boolean }).COMPACT_RESPONSES = false;
			const result = toolError('Something went wrong');
			expect(result.isError).toBe(true);
			expect(result.content).toHaveLength(1);
			expect(result.content[0].type).toBe('text');
			const parsed = JSON.parse(result.content[0].text);
			expect(parsed.error).toBe('Something went wrong');
		});
	});

	describe('configError', () => {
		it('returns config error with isError: true', () => {
			(config as { COMPACT_RESPONSES: boolean }).COMPACT_RESPONSES = false;
			const result = configError('Database', 'Set SUPABASE_URL');
			expect(result.isError).toBe(true);
			const parsed = JSON.parse(result.content[0].text);
			expect(parsed.error).toBe('Database not configured');
			expect(parsed.message).toContain('Set SUPABASE_URL');
			expect(parsed.message).toContain('do not retry');
		});
	});

	describe('toolResponse', () => {
		it('returns compact response when COMPACT_RESPONSES is true', () => {
			(config as { COMPACT_RESPONSES: boolean }).COMPACT_RESPONSES = true;
			const result = toolResponse({
				compact: { n: 5 },
				verbose: { count: 5, label: 'items' },
			});
			expect(result.content).toHaveLength(1);
			expect(JSON.parse(result.content[0].text)).toEqual({ n: 5 });
			expect(result).not.toHaveProperty('structuredContent');
		});

		it('returns verbose response when COMPACT_RESPONSES is false', () => {
			(config as { COMPACT_RESPONSES: boolean }).COMPACT_RESPONSES = false;
			const result = toolResponse({
				compact: { n: 5 },
				verbose: { count: 5, label: 'items' },
			});
			const parsed = JSON.parse(result.content[0].text);
			expect(parsed).toEqual({ count: 5, label: 'items' });
		});

		it('includes structuredContent when provided', () => {
			(config as { COMPACT_RESPONSES: boolean }).COMPACT_RESPONSES = true;
			const structured = { query: 'test', results: [] };
			const result = toolResponse({
				compact: { n: 0 },
				verbose: structured,
				structuredContent: structured,
			});
			expect(result).toHaveProperty('structuredContent');
			expect((result as { structuredContent: unknown }).structuredContent).toEqual(structured);
		});

		it('omits structuredContent when not provided', () => {
			(config as { COMPACT_RESPONSES: boolean }).COMPACT_RESPONSES = true;
			const result = toolResponse({
				compact: { ok: true },
				verbose: { success: true },
			});
			expect(result).not.toHaveProperty('structuredContent');
		});
	});
});
