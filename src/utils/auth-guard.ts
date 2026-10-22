/**
 * Fail-closed auth guard for the HTTP server.
 *
 * The server must never run unauthenticated by accident. If neither
 * API_BEARER_TOKEN nor Google OAuth is configured, startup is refused unless
 * the operator explicitly opts in with TEXTRAWL_ALLOW_NO_AUTH=true (local dev
 * only; the opt-in is ignored when NODE_ENV=production).
 */

export interface AuthGuardConfig {
	NODE_ENV: 'development' | 'production' | 'test';
	API_BEARER_TOKEN?: string;
	GOOGLE_CLIENT_ID?: string;
	TEXTRAWL_ALLOW_NO_AUTH: boolean;
}

/** True when at least one auth method (static bearer token or OAuth) is configured. */
export function isAuthConfigured(
	cfg: Pick<AuthGuardConfig, 'API_BEARER_TOKEN' | 'GOOGLE_CLIENT_ID'>,
) {
	return Boolean(cfg.API_BEARER_TOKEN || cfg.GOOGLE_CLIENT_ID);
}

/** True only when no auth is configured AND the explicit dev opt-in is set (never in production). */
export function isNoAuthAllowed(cfg: AuthGuardConfig): boolean {
	return !isAuthConfigured(cfg) && cfg.TEXTRAWL_ALLOW_NO_AUTH && cfg.NODE_ENV !== 'production';
}

export const NO_AUTH_STARTUP_ERROR =
	'Refusing to start: no authentication configured. Set API_BEARER_TOKEN (min 32 chars, e.g. `openssl rand -hex 32`) ' +
	'or Google OAuth (GOOGLE_CLIENT_ID, GOOGLE_CLIENT_SECRET, OAUTH_JWT_SECRET, OAUTH_SERVER_URL). ' +
	'For local development only, TEXTRAWL_ALLOW_NO_AUTH=true runs the server without auth (ignored in production).';

/**
 * Returns an error message if the server must refuse to start, otherwise null.
 */
export function getStartupAuthError(cfg: AuthGuardConfig): string | null {
	if (isAuthConfigured(cfg)) return null;
	if (isNoAuthAllowed(cfg)) return null;
	return NO_AUTH_STARTUP_ERROR;
}
