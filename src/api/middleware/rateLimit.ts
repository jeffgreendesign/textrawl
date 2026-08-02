import type { Store } from 'express-rate-limit';
import rateLimit from 'express-rate-limit';
import { RedisStore } from 'rate-limit-redis';
import { createClient } from 'redis';
import { config } from '../../utils/config.js';
import { logger } from '../../utils/logger.js';

// Conditionally create Redis-backed store for multi-instance deployments.
// Falls back to the default in-memory store when REDIS_URL is not set.
let store: Store | undefined;

if (config.REDIS_URL) {
	try {
		const client = createClient({ url: config.REDIS_URL });
		client.on('error', (err: Error) => {
			logger.error('Redis rate-limit client error', { error: err.message });
		});
		await client.connect();

		store = new RedisStore({
			sendCommand: (...args: string[]) => client.sendCommand(args),
			prefix: 'textrawl:rl:',
		});
		logger.info('Rate limiting backed by Redis');
	} catch (err) {
		logger.error('Redis connection failed, using in-memory rate limiting', {
			error: err instanceof Error ? err.message : String(err),
		});
	}
}

export const apiLimiter = rateLimit({
	windowMs: 60 * 1000,
	limit: 100,
	standardHeaders: true,
	legacyHeaders: false,
	...(store ? { store } : {}),
	message: { error: { message: 'Too many requests', code: 'RATE_LIMIT_ERROR' } },
});

export const uploadLimiter = rateLimit({
	windowMs: 60 * 1000,
	limit: 10,
	standardHeaders: true,
	legacyHeaders: false,
	...(store ? { store } : {}),
	message: { error: { message: 'Upload rate limit exceeded', code: 'RATE_LIMIT_ERROR' } },
});

// OAuth endpoint rate limiter (stricter to prevent brute-force and abuse)
export const oauthLimiter = rateLimit({
	windowMs: 60 * 1000,
	limit: 20,
	standardHeaders: true,
	legacyHeaders: false,
	...(store ? { store } : {}),
	message: { error: { message: 'OAuth rate limit exceeded', code: 'RATE_LIMIT_ERROR' } },
});

// Health endpoint rate limiter (more permissive but still prevents DoS)
export const healthLimiter = rateLimit({
	windowMs: 60 * 1000,
	limit: 300, // Allow more requests for health checks (monitoring systems poll frequently)
	standardHeaders: true,
	legacyHeaders: false,
	...(store ? { store } : {}),
	message: { error: { message: 'Health check rate limit exceeded', code: 'RATE_LIMIT_ERROR' } },
});
