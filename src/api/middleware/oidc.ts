import type { NextFunction, Request, Response } from 'express';
import { OAuth2Client } from 'google-auth-library';
import { config } from '../../utils/config.js';
import { AuthenticationError, AuthorizationError } from '../../utils/errors.js';
import { logger } from '../../utils/logger.js';

// Single verifier instance — `verifyIdToken` fetches and caches Google's signing
// certs internally, so reuse across requests avoids redundant cert fetches.
let client: OAuth2Client | null = null;
function getClient(): OAuth2Client {
	if (!client) {
		client = new OAuth2Client();
	}
	return client;
}

/**
 * Cloud Tasks OIDC authentication for the internal processing endpoint
 * (plan §4, T4.2). **Strict** — there is no loopback/dev bypass (locked
 * decision 1B): every request must carry a Google-signed OIDC token whose
 * audience matches `UPLOAD_PROCESS_URL` and whose verified email is the
 * configured `CLOUD_TASKS_SERVICE_ACCOUNT`. This is the sole access control for
 * the endpoint; it never falls through to `bearerAuth`.
 *
 * Rejections map to the standard error codes via {@link errorHandler}:
 * missing/invalid token → 401 (`AuthenticationError`); valid token but wrong
 * identity → 403 (`AuthorizationError`).
 */
export async function cloudTasksOidc(
	req: Request,
	_res: Response,
	next: NextFunction,
): Promise<void> {
	const audience = config.UPLOAD_PROCESS_URL;
	const expectedEmail = config.CLOUD_TASKS_SERVICE_ACCOUNT;

	// Fail closed: without an audience + expected identity the token cannot be
	// verified, so the endpoint must reject rather than accept anything.
	if (!audience || !expectedEmail) {
		logger.error(
			'Cloud Tasks OIDC not configured (UPLOAD_PROCESS_URL / CLOUD_TASKS_SERVICE_ACCOUNT)',
		);
		throw new AuthenticationError('Processing endpoint is not configured for OIDC');
	}

	const authHeader = req.headers.authorization;
	if (!authHeader) {
		throw new AuthenticationError('Missing Authorization header');
	}
	const [scheme, token] = authHeader.split(' ');
	if (scheme !== 'Bearer' || !token) {
		throw new AuthenticationError('Invalid Authorization format. Use: Bearer <id_token>');
	}

	let email: string | undefined;
	let emailVerified: boolean | undefined;
	try {
		const ticket = await getClient().verifyIdToken({ idToken: token, audience });
		const payload = ticket.getPayload();
		email = payload?.email;
		emailVerified = payload?.email_verified;
	} catch (error) {
		logger.warn('Cloud Tasks OIDC verification failed', {
			error: error instanceof Error ? error.message : String(error),
		});
		throw new AuthenticationError('Invalid OIDC token');
	}

	if (email !== expectedEmail || emailVerified !== true) {
		logger.warn('Cloud Tasks OIDC rejected: identity not permitted', { email });
		throw new AuthorizationError('OIDC token identity is not permitted');
	}

	next();
}
