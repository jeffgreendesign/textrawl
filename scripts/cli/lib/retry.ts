/**
 * Retry utility with exponential backoff for CLI upload operations
 */

import { logger } from './progress.js';

export interface RetryOptions {
	/** Maximum number of retries (default: 3) */
	maxRetries?: number;
	/** Base delay in milliseconds (default: 1000) */
	baseDelayMs?: number;
	/** Maximum delay in milliseconds (default: 30000) */
	maxDelayMs?: number;
	/** Custom check for retryable errors (default: isRetryableError) */
	retryableCheck?: (error: unknown) => boolean;
	/** Callback invoked on each retry attempt (for tracking) */
	onRetry?: (error: unknown, attempt: number, delayMs: number) => void;
}

/**
 * Check if error is a rate limit error (429 or contains rate limit text)
 */
export function isRateLimitError(error: unknown): boolean {
	if (error instanceof Error) {
		const msg = error.message.toLowerCase();
		return msg.includes('429') || msg.includes('rate limit') || msg.includes('rate_limit');
	}
	return false;
}

/**
 * Parse Retry-After header value and return delay in milliseconds.
 * Supports both delay-seconds (integer) and HTTP-date formats per RFC 7231.
 */
export function parseRetryAfter(retryAfter: string | number): number {
	// Handle numeric value (delay in seconds)
	if (typeof retryAfter === 'number') {
		return retryAfter * 1000;
	}

	// Try parsing as integer seconds first
	const seconds = Number.parseInt(retryAfter, 10);
	if (!Number.isNaN(seconds) && seconds > 0) {
		return seconds * 1000;
	}

	// Try parsing as HTTP date
	const date = new Date(retryAfter);
	if (!Number.isNaN(date.getTime())) {
		const now = Date.now();
		const delayMs = date.getTime() - now;
		// Return at least 1 second if date is in the past or very close
		return Math.max(delayMs, 1000);
	}

	// Fallback to 1 second if unable to parse
	return 1000;
}

/**
 * Extract Retry-After value from error object if present
 */
function getRetryAfterFromError(error: unknown): string | number | null {
	// Check for response.headers (fetch API style)
	const err = error as any;
	if (err?.response?.headers) {
		const headers = err.response.headers;
		// Try both lowercase and capitalized versions
		return headers['retry-after'] || headers['Retry-After'] || null;
	}
	return null;
}

/**
 * Check if an error is retryable (transient network/rate limit issues)
 */
export function isRetryableError(error: unknown): boolean {
	if (error instanceof Error) {
		const msg = error.message.toLowerCase();
		// Rate limits
		if (msg.includes('429') || msg.includes('rate limit') || msg.includes('rate_limit')) {
			return true;
		}
		// Transient network errors
		if (
			msg.includes('econnreset') ||
			msg.includes('etimedout') ||
			msg.includes('econnrefused') ||
			msg.includes('epipe') ||
			msg.includes('fetch failed')
		) {
			return true;
		}
		// Server errors
		if (
			msg.includes('500') ||
			msg.includes('502') ||
			msg.includes('503') ||
			msg.includes('504') ||
			msg.includes('520') ||
			msg.includes('522')
		) {
			return true;
		}
		// Supabase transient
		if (msg.includes('timeout') || msg.includes('too many')) {
			return true;
		}
	}
	return false;
}

/**
 * Execute a function with retry and exponential backoff
 */
export async function withRetry<T>(fn: () => Promise<T>, options: RetryOptions = {}): Promise<T> {
	const {
		maxRetries = 3,
		baseDelayMs = 1000,
		maxDelayMs = 30000,
		retryableCheck = isRetryableError,
		onRetry,
	} = options;

	for (let attempt = 0; attempt <= maxRetries; attempt++) {
		try {
			return await fn();
		} catch (error) {
			if (attempt === maxRetries || !retryableCheck(error)) {
				throw error;
			}

			// Calculate exponential backoff delay
			let delay = Math.min(baseDelayMs * 2 ** attempt + Math.random() * 500, maxDelayMs);

			// For rate limit errors, check for and respect Retry-After header
			if (isRateLimitError(error)) {
				const retryAfter = getRetryAfterFromError(error);
				if (retryAfter !== null) {
					const retryAfterMs = parseRetryAfter(retryAfter);
					// Use the longer of: exponential backoff or retry-after
					delay = Math.max(delay, Math.min(retryAfterMs, maxDelayMs));
				}
			}

			// Invoke tracking callback if provided
			if (onRetry) {
				onRetry(error, attempt + 1, delay);
			}

			logger.warn(
				`Retry ${attempt + 1}/${maxRetries} after ${Math.round(delay)}ms: ${error instanceof Error ? error.message : String(error)}`,
			);
			await new Promise((resolve) => setTimeout(resolve, delay));
		}
	}

	// Unreachable, but satisfies TypeScript
	throw new Error('Retry loop exited unexpectedly');
}
