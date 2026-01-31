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
		if (msg.includes('502') || msg.includes('503') || msg.includes('504')) {
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
	} = options;

	for (let attempt = 0; attempt <= maxRetries; attempt++) {
		try {
			return await fn();
		} catch (error) {
			if (attempt === maxRetries || !retryableCheck(error)) {
				throw error;
			}

			const delay = Math.min(baseDelayMs * 2 ** attempt + Math.random() * 500, maxDelayMs);
			logger.warn(
				`Retry ${attempt + 1}/${maxRetries} after ${Math.round(delay)}ms: ${error instanceof Error ? error.message : String(error)}`,
			);
			await new Promise((resolve) => setTimeout(resolve, delay));
		}
	}

	// Unreachable, but satisfies TypeScript
	throw new Error('Retry loop exited unexpectedly');
}
