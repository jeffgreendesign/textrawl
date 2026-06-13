import { logger } from './logger.js';

/**
 * Bounded retry-with-backoff for external provider calls (embedding providers,
 * Anthropic). Retries only transient failures — HTTP 429 / 5xx and network
 * errors — with exponential backoff + full jitter, honoring a `Retry-After`
 * header when the provider supplies one. Non-retryable errors (4xx input
 * problems, malformed responses) fail fast so bugs are not silently masked.
 */

export interface RetryOptions {
	/** Max retries AFTER the first attempt (default 3 → up to 4 total tries). */
	maxRetries?: number;
	/** Base backoff in ms; grows as base * 2^(attempt-1) (default 500). */
	baseDelayMs?: number;
	/** Backoff ceiling in ms (default 8000). */
	maxDelayMs?: number;
	/** Label used in retry log lines. */
	label?: string;
}

// Transient network failures (no HTTP status). Node's fetch surfaces the code on
// `error.cause.code`; SDKs/sockets surface it on `error.code`.
const NETWORK_ERROR_CODES = new Set([
	'ECONNRESET',
	'ECONNREFUSED',
	'ETIMEDOUT',
	'EAI_AGAIN',
	'EPIPE',
	'ENOTFOUND',
	'UND_ERR_SOCKET',
	'UND_ERR_CONNECT_TIMEOUT',
]);

function errorCode(err: unknown): string | undefined {
	const e = err as { code?: unknown; cause?: { code?: unknown } };
	if (typeof e?.code === 'string') return e.code;
	if (typeof e?.cause?.code === 'string') return e.cause.code;
	return undefined;
}

/** Best-effort HTTP status from the varied shapes providers throw. */
export function httpStatusOf(err: unknown): number | undefined {
	const e = err as {
		status?: unknown;
		statusCode?: unknown;
		response?: { status?: unknown };
		message?: unknown;
	};
	if (typeof e?.status === 'number') return e.status;
	if (typeof e?.statusCode === 'number') return e.statusCode;
	if (typeof e?.response?.status === 'number') return e.response.status;
	// Fall back to parsing common message shapes: "Ollama returned 429: ...",
	// "[429 Too Many Requests]", "status code: 503".
	const msg = typeof e?.message === 'string' ? e.message : '';
	const match = msg.match(/(?:returned|status(?:\s*code)?:?|\[)\s*(\d{3})\b/i);
	return match ? Number(match[1]) : undefined;
}

/** Parse a `Retry-After` header (delta-seconds or HTTP-date) into ms. */
export function retryAfterMs(err: unknown): number | undefined {
	const headers = (err as { headers?: unknown })?.headers;
	let raw: string | null | undefined;
	if (headers && typeof (headers as Headers).get === 'function') {
		raw = (headers as Headers).get('retry-after');
	} else if (headers && typeof headers === 'object') {
		raw = (headers as Record<string, string>)['retry-after'];
	}
	if (!raw) return undefined;
	const seconds = Number(raw);
	if (Number.isFinite(seconds)) return Math.max(0, seconds * 1000);
	const date = Date.parse(raw);
	return Number.isFinite(date) ? Math.max(0, date - Date.now()) : undefined;
}

/** True for HTTP 429 / 5xx or a recognized transient network error. */
export function isRetryableProviderError(err: unknown): boolean {
	const status = httpStatusOf(err);
	if (status !== undefined) return status === 429 || status >= 500;
	return NETWORK_ERROR_CODES.has(errorCode(err) ?? '');
}

const sleep = (ms: number): Promise<void> => new Promise((resolve) => setTimeout(resolve, ms));

/**
 * Run `fn`, retrying transient failures with exponential backoff + jitter.
 * Returns `fn`'s result, or rethrows the last error once retries are exhausted
 * or the error is non-retryable.
 */
export async function withRetry<T>(fn: () => Promise<T>, options: RetryOptions = {}): Promise<T> {
	const { maxRetries = 3, baseDelayMs = 500, maxDelayMs = 8000, label = 'provider call' } = options;

	let attempt = 0;
	while (true) {
		try {
			return await fn();
		} catch (err) {
			attempt++;
			if (attempt > maxRetries || !isRetryableProviderError(err)) {
				throw err;
			}
			const backoff = Math.min(maxDelayMs, baseDelayMs * 2 ** (attempt - 1));
			// Full jitter spreads retries so concurrent workers don't resynchronize.
			const delay = retryAfterMs(err) ?? Math.random() * backoff;
			logger.warn('Retrying after transient provider error', {
				label,
				attempt,
				maxRetries,
				delayMs: Math.round(delay),
				status: httpStatusOf(err),
				code: errorCode(err),
			});
			await sleep(delay);
		}
	}
}
