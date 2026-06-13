import { describe, expect, it, vi } from 'vitest';

vi.mock('../logger.js', () => ({
	logger: { debug: vi.fn(), info: vi.fn(), warn: vi.fn(), error: vi.fn() },
}));

import { httpStatusOf, isRetryableProviderError, retryAfterMs, withRetry } from '../retry.js';

// Zero-delay options keep the tests fast and deterministic.
const FAST = { baseDelayMs: 0, maxDelayMs: 0 };

describe('isRetryableProviderError', () => {
	it('retries 429 and 5xx', () => {
		expect(isRetryableProviderError({ status: 429 })).toBe(true);
		expect(isRetryableProviderError({ status: 503 })).toBe(true);
		expect(isRetryableProviderError({ statusCode: 500 })).toBe(true);
	});

	it('does not retry 4xx input errors', () => {
		expect(isRetryableProviderError({ status: 400 })).toBe(false);
		expect(isRetryableProviderError({ status: 401 })).toBe(false);
		expect(isRetryableProviderError({ status: 422 })).toBe(false);
	});

	it('retries recognized network errors', () => {
		expect(isRetryableProviderError({ code: 'ECONNRESET' })).toBe(true);
		expect(isRetryableProviderError({ cause: { code: 'ECONNREFUSED' } })).toBe(true);
	});

	it('does not retry unknown errors with no status/code', () => {
		expect(isRetryableProviderError(new Error('Invalid response format'))).toBe(false);
	});

	it('retries timeout/abort errors (AbortSignal.timeout)', () => {
		expect(isRetryableProviderError({ name: 'TimeoutError' })).toBe(true);
		expect(isRetryableProviderError({ name: 'AbortError' })).toBe(true);
	});

	it('parses status out of common message shapes', () => {
		expect(httpStatusOf(new Error('Ollama returned 429: rate limited'))).toBe(429);
		expect(httpStatusOf(new Error('[503 Service Unavailable]'))).toBe(503);
	});

	it('extracts status from a nested response object (axios-style)', () => {
		expect(httpStatusOf({ response: { status: 502 } })).toBe(502);
		expect(isRetryableProviderError({ response: { status: 502 } })).toBe(true);
	});
});

describe('retryAfterMs', () => {
	it('parses delta-seconds', () => {
		expect(retryAfterMs({ headers: { 'retry-after': '2' } })).toBe(2000);
	});

	it('parses a Headers object', () => {
		const headers = new Headers({ 'retry-after': '5' });
		expect(retryAfterMs({ headers })).toBe(5000);
	});

	it('parses an HTTP-date Retry-After', () => {
		const future = new Date(Date.now() + 3000).toUTCString();
		const result = retryAfterMs({ headers: { 'retry-after': future } });
		expect(result).toBeGreaterThan(1500);
		expect(result).toBeLessThanOrEqual(3000);
	});

	it('returns undefined when absent', () => {
		expect(retryAfterMs({ headers: {} })).toBeUndefined();
		expect(retryAfterMs(new Error('nope'))).toBeUndefined();
	});
});

describe('withRetry', () => {
	it('retries a transient 429 then succeeds', async () => {
		let calls = 0;
		const fn = vi.fn(async () => {
			calls++;
			if (calls < 3) throw { status: 429, message: 'rate limited' };
			return 'ok';
		});

		await expect(withRetry(fn, FAST)).resolves.toBe('ok');
		expect(fn).toHaveBeenCalledTimes(3);
	});

	it('fails fast on a non-retryable 4xx (single attempt)', async () => {
		const fn = vi.fn(async () => {
			throw { status: 400, message: 'bad request' };
		});

		await expect(withRetry(fn, FAST)).rejects.toMatchObject({ status: 400 });
		expect(fn).toHaveBeenCalledTimes(1);
	});

	it('gives up after maxRetries and rethrows the last error', async () => {
		const fn = vi.fn(async () => {
			throw { status: 503, message: 'unavailable' };
		});

		await expect(withRetry(fn, { ...FAST, maxRetries: 2 })).rejects.toMatchObject({ status: 503 });
		// 1 initial + 2 retries
		expect(fn).toHaveBeenCalledTimes(3);
	});

	it('honors Retry-After over the computed backoff', async () => {
		let calls = 0;
		const fn = vi.fn(async () => {
			calls++;
			if (calls < 2) throw { status: 429, headers: { 'retry-after': '0' } };
			return 'done';
		});

		await expect(withRetry(fn, FAST)).resolves.toBe('done');
		expect(fn).toHaveBeenCalledTimes(2);
	});
});
