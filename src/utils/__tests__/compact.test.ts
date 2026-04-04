import { beforeEach, describe, expect, it, vi } from 'vitest';

// Mock the config module before importing compact
vi.mock('../config.js', () => ({
	config: { COMPACT_RESPONSES: true },
}));

vi.mock('../logger.js', () => ({
	logger: { debug: vi.fn(), info: vi.fn(), warn: vi.fn(), error: vi.fn() },
}));

import {
	classifyError,
	configError,
	formatId,
	isCompact,
	serializeDates,
	serializeResponse,
	toJSON,
	toolError,
	toolResponse,
} from '../compact.js';
import { config } from '../config.js';
import {
	DatabaseError,
	ExternalServiceError,
	NotFoundError,
	TextrawlError,
	ValidationError,
} from '../errors.js';
import { logger } from '../logger.js';

describe('compact utilities', () => {
	beforeEach(() => {
		(config as { COMPACT_RESPONSES: boolean }).COMPACT_RESPONSES = false;
		vi.clearAllMocks();
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

	describe('classifyError', () => {
		it('classifies DatabaseError', () => {
			expect(classifyError(new DatabaseError('conn failed'))).toBe('DATABASE_ERROR');
		});

		it('classifies ValidationError', () => {
			expect(classifyError(new ValidationError('bad input'))).toBe('VALIDATION_ERROR');
		});

		it('classifies NotFoundError', () => {
			expect(classifyError(new NotFoundError('missing'))).toBe('NOT_FOUND');
		});

		it('classifies ExternalServiceError', () => {
			expect(classifyError(new ExternalServiceError('timeout'))).toBe('EXTERNAL_SERVICE_ERROR');
		});

		it('classifies unknown TextrawlError as RUNTIME_ERROR', () => {
			expect(classifyError(new TextrawlError('oops', 500, 'UNKNOWN_CODE'))).toBe('RUNTIME_ERROR');
		});

		it('detects CONFIG_ERROR from message pattern', () => {
			expect(classifyError(new Error('DATABASE_URL not configured'))).toBe('CONFIG_ERROR');
			expect(classifyError(new Error('API key not set'))).toBe('CONFIG_ERROR');
		});

		it('detects SCHEMA_ERROR from message pattern', () => {
			expect(classifyError(new Error('relation "insights" does not exist'))).toBe('SCHEMA_ERROR');
			expect(classifyError(new Error('schema validation failed'))).toBe('SCHEMA_ERROR');
		});

		it('defaults to RUNTIME_ERROR for generic errors', () => {
			expect(classifyError(new Error('something broke'))).toBe('RUNTIME_ERROR');
		});

		it('defaults to RUNTIME_ERROR for non-Error values', () => {
			expect(classifyError('string error')).toBe('RUNTIME_ERROR');
			expect(classifyError(42)).toBe('RUNTIME_ERROR');
			expect(classifyError(null)).toBe('RUNTIME_ERROR');
		});
	});

	describe('toolError', () => {
		it('returns error response with isError: true (legacy form)', () => {
			(config as { COMPACT_RESPONSES: boolean }).COMPACT_RESPONSES = false;
			const result = toolError('Something went wrong');
			expect(result.isError).toBe(true);
			expect(result.content).toHaveLength(1);
			expect(result.content[0].type).toBe('text');
			const parsed = JSON.parse(result.content[0].text);
			expect(parsed.error).toBe('Something went wrong');
		});

		it('returns structured error response (new form)', () => {
			const result = toolError('get_stats', new Error('connection refused'), {
				scope: 'knowledge',
				hint: 'Check DATABASE_URL',
			});
			expect(result.isError).toBe(true);
			const parsed = JSON.parse(result.content[0].text);
			expect(parsed.error).toBe(true);
			expect(parsed.tool).toBe('get_stats');
			expect(parsed.message).toBe('connection refused');
			expect(parsed.code).toBe('RUNTIME_ERROR');
			expect(parsed.scope).toBe('knowledge');
			expect(parsed.hint).toBe('Check DATABASE_URL');
		});

		it('classifies error type in structured form', () => {
			const result = toolError('search', new DatabaseError('query failed'));
			const parsed = JSON.parse(result.content[0].text);
			expect(parsed.code).toBe('DATABASE_ERROR');
		});

		it('logs full stack trace in structured form', () => {
			const err = new Error('test error');
			toolError('my_tool', err, { scope: 'test' });
			expect(logger.error).toHaveBeenCalledWith(
				'my_tool: test error',
				expect.objectContaining({
					tool: 'my_tool',
					scope: 'test',
					stack: expect.stringContaining('test error'),
				}),
			);
		});

		it('handles non-Error values in structured form', () => {
			const result = toolError('my_tool', 'string error');
			const parsed = JSON.parse(result.content[0].text);
			expect(parsed.message).toBe('string error');
			expect(parsed.code).toBe('RUNTIME_ERROR');
		});

		it('omits scope and hint when not provided', () => {
			const result = toolError('my_tool', new Error('fail'));
			const parsed = JSON.parse(result.content[0].text);
			expect(parsed).not.toHaveProperty('scope');
			expect(parsed).not.toHaveProperty('hint');
		});
	});

	describe('configError', () => {
		it('returns config error with isError: true', () => {
			(config as { COMPACT_RESPONSES: boolean }).COMPACT_RESPONSES = false;
			const result = configError('Database', 'Set SUPABASE_URL');
			expect(result.isError).toBe(true);
			const parsed = JSON.parse(result.content[0].text);
			expect(parsed.error).toBe('Database not configured');
			expect(parsed.code).toBe('CONFIG_ERROR');
			expect(parsed.message).toContain('Set SUPABASE_URL');
			expect(parsed.message).toContain('do not retry');
		});
	});

	describe('serializeResponse', () => {
		it('converts Date objects to ISO strings', () => {
			const date = new Date('2024-01-15T10:30:00.000Z');
			expect(serializeResponse(date)).toBe('2024-01-15T10:30:00.000Z');
		});

		it('converts nested Date objects in objects', () => {
			const obj = {
				name: 'test',
				createdAt: new Date('2024-01-15T10:30:00.000Z'),
				nested: {
					updatedAt: new Date('2024-06-01T00:00:00.000Z'),
				},
			};
			const result = serializeResponse(obj);
			expect(result.createdAt).toBe('2024-01-15T10:30:00.000Z');
			expect(result.nested.updatedAt).toBe('2024-06-01T00:00:00.000Z');
			expect(result.name).toBe('test');
		});

		it('converts Date objects in arrays', () => {
			const arr = [
				{ id: '1', createdAt: new Date('2024-01-01T00:00:00.000Z') },
				{ id: '2', createdAt: new Date('2024-02-01T00:00:00.000Z') },
			];
			const result = serializeResponse(arr);
			expect(result[0].createdAt).toBe('2024-01-01T00:00:00.000Z');
			expect(result[1].createdAt).toBe('2024-02-01T00:00:00.000Z');
		});

		it('passes through primitives unchanged', () => {
			expect(serializeResponse('hello')).toBe('hello');
			expect(serializeResponse(42)).toBe(42);
			expect(serializeResponse(true)).toBe(true);
			expect(serializeResponse(null)).toBe(null);
		});

		it('converts undefined to null', () => {
			expect(serializeResponse(undefined)).toBe(null);
		});

		it('converts undefined fields in objects to null', () => {
			const obj = { a: 'ok', b: undefined, c: 42 };
			const result = serializeResponse(obj);
			expect(result.a).toBe('ok');
			expect(result.b).toBe(null);
			expect(result.c).toBe(42);
		});

		it('converts invalid Date to null', () => {
			expect(serializeResponse(new Date('not-a-date'))).toBe(null);
			expect(serializeResponse(new Date(NaN))).toBe(null);
		});

		it('handles null values in objects', () => {
			const obj = { oldest: null, newest: new Date('2024-01-01T00:00:00.000Z') };
			const result = serializeResponse(obj);
			expect(result.oldest).toBe(null);
			expect(result.newest).toBe('2024-01-01T00:00:00.000Z');
		});

		it('converts BigInt to number', () => {
			expect(serializeResponse(42n)).toBe(42);
			expect(serializeResponse(0n)).toBe(0);
		});

		it('converts BigInt in nested objects', () => {
			const obj = { count: 100n, items: [{ total: 5n }] };
			const result = serializeResponse(obj);
			expect(result.count).toBe(100);
			expect(result.items[0].total).toBe(5);
		});

		it('converts Buffer to base64 string', () => {
			const buf = Buffer.from('hello world');
			expect(serializeResponse(buf)).toBe(buf.toString('base64'));
		});

		it('converts Buffer in nested objects', () => {
			const obj = { data: Buffer.from('test'), name: 'file' };
			const result = serializeResponse(obj);
			expect(result.data).toBe(Buffer.from('test').toString('base64'));
			expect(result.name).toBe('file');
		});
	});

	describe('serializeDates (deprecated alias)', () => {
		it('is the same function as serializeResponse', () => {
			expect(serializeDates).toBe(serializeResponse);
		});

		it('still works for Date conversion', () => {
			const date = new Date('2024-01-15T10:30:00.000Z');
			expect(serializeDates(date)).toBe('2024-01-15T10:30:00.000Z');
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

		it('serializes Date objects in structuredContent', () => {
			const structured = {
				documents: [
					{
						id: '1',
						createdAt: new Date('2024-01-15T10:30:00.000Z'),
						updatedAt: new Date('2024-06-01T00:00:00.000Z'),
					},
				],
			};
			const result = toolResponse({
				compact: { n: 1 },
				verbose: structured,
				structuredContent: structured as unknown as Record<string, unknown>,
			});
			const sc = result.structuredContent as {
				documents: Array<{ createdAt: string; updatedAt: string }>;
			};
			expect(sc.documents[0].createdAt).toBe('2024-01-15T10:30:00.000Z');
			expect(sc.documents[0].updatedAt).toBe('2024-06-01T00:00:00.000Z');
		});

		it('serializes Date objects in text content too', () => {
			(config as { COMPACT_RESPONSES: boolean }).COMPACT_RESPONSES = false;
			const result = toolResponse({
				compact: { d: new Date('2024-01-01T00:00:00.000Z') },
				verbose: { date: new Date('2024-01-01T00:00:00.000Z') },
			});
			const parsed = JSON.parse(result.content[0].text);
			expect(parsed.date).toBe('2024-01-01T00:00:00.000Z');
		});

		it('serializes BigInt values in text content', () => {
			(config as { COMPACT_RESPONSES: boolean }).COMPACT_RESPONSES = false;
			const result = toolResponse({
				compact: { n: 42n },
				verbose: { count: 42n },
			});
			const parsed = JSON.parse(result.content[0].text);
			expect(parsed.count).toBe(42);
		});
	});
});
