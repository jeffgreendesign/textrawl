import { timingSafeEqual } from 'node:crypto';
import type { NextFunction, Request, Response } from 'express';
import { config } from '../../utils/config.js';
import { AuthenticationError, AuthorizationError } from '../../utils/errors.js';
import { logger } from '../../utils/logger.js';

let verifyJwt: typeof import('../oauth/jwt.js').verifyJwt | null = null;

// Lazy-load JWT verification only when OAuth is configured
async function getJwtVerifier() {
	if (!verifyJwt) {
		const mod = await import('../oauth/jwt.js');
		verifyJwt = mod.verifyJwt;
	}
	return verifyJwt;
}

/**
 * Bearer token authentication middleware.
 * Supports both static API tokens and OAuth JWTs.
 */
export async function bearerAuth(req: Request, _res: Response, next: NextFunction): Promise<void> {
	// Skip auth if neither bearer token nor OAuth is configured (development mode)
	if (!config.API_BEARER_TOKEN && !config.GOOGLE_CLIENT_ID) {
		logger.debug('Auth skipped - no auth configured');
		next();
		return;
	}

	const authHeader = req.headers.authorization;

	if (!authHeader) {
		throw new AuthenticationError('Missing Authorization header');
	}

	const [scheme, token] = authHeader.split(' ');

	if (scheme !== 'Bearer' || !token) {
		throw new AuthenticationError('Invalid Authorization format. Use: Bearer <token>');
	}

	// Strategy 1: Static bearer token match
	if (config.API_BEARER_TOKEN) {
		const tokenBuffer = Buffer.from(token);
		const expectedBuffer = Buffer.from(config.API_BEARER_TOKEN);
		if (
			tokenBuffer.length === expectedBuffer.length &&
			timingSafeEqual(tokenBuffer, expectedBuffer)
		) {
			next();
			return;
		}
	}

	// Strategy 2: OAuth JWT verification
	if (config.GOOGLE_CLIENT_ID && config.OAUTH_JWT_SECRET) {
		try {
			const verify = await getJwtVerifier();
			await verify(token);
			next();
			return;
		} catch {
			// JWT verification failed, fall through to rejection
		}
	}

	logger.warn('Invalid token attempt', { path: req.path });
	throw new AuthorizationError('Invalid token');
}
