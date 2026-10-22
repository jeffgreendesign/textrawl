/**
 * The HTTP server must fail closed: with no auth configured it refuses to
 * start unless TEXTRAWL_ALLOW_NO_AUTH=true is set explicitly (never in prod).
 */
import { describe, expect, it } from 'vitest';
import {
	type AuthGuardConfig,
	getStartupAuthError,
	isAuthConfigured,
	isNoAuthAllowed,
	NO_AUTH_STARTUP_ERROR,
} from '../auth-guard.js';

function cfg(overrides: Partial<AuthGuardConfig> = {}): AuthGuardConfig {
	return {
		NODE_ENV: 'development',
		API_BEARER_TOKEN: undefined,
		GOOGLE_CLIENT_ID: undefined,
		TEXTRAWL_ALLOW_NO_AUTH: false,
		...overrides,
	};
}

describe('getStartupAuthError', () => {
	it('refuses to start when no auth is configured (default)', () => {
		expect(getStartupAuthError(cfg())).toBe(NO_AUTH_STARTUP_ERROR);
	});

	it('names the missing settings in the error', () => {
		const msg = getStartupAuthError(cfg()) ?? '';
		expect(msg).toContain('API_BEARER_TOKEN');
		expect(msg).toContain('GOOGLE_CLIENT_ID');
		expect(msg).toContain('TEXTRAWL_ALLOW_NO_AUTH');
	});

	it('refuses in test and production too when nothing is set', () => {
		expect(getStartupAuthError(cfg({ NODE_ENV: 'test' }))).not.toBeNull();
		expect(getStartupAuthError(cfg({ NODE_ENV: 'production' }))).not.toBeNull();
	});

	it('starts when a bearer token is configured', () => {
		expect(getStartupAuthError(cfg({ API_BEARER_TOKEN: 'x'.repeat(32) }))).toBeNull();
	});

	it('starts when OAuth is configured', () => {
		expect(getStartupAuthError(cfg({ GOOGLE_CLIENT_ID: 'client-id' }))).toBeNull();
	});

	it('allows no-auth only with the explicit dev opt-in', () => {
		expect(getStartupAuthError(cfg({ TEXTRAWL_ALLOW_NO_AUTH: true }))).toBeNull();
	});

	it('ignores the opt-in in production', () => {
		expect(getStartupAuthError(cfg({ NODE_ENV: 'production', TEXTRAWL_ALLOW_NO_AUTH: true }))).toBe(
			NO_AUTH_STARTUP_ERROR,
		);
	});
});

describe('isAuthConfigured / isNoAuthAllowed', () => {
	it('reports configured auth', () => {
		expect(isAuthConfigured(cfg())).toBe(false);
		expect(isAuthConfigured(cfg({ API_BEARER_TOKEN: 't' }))).toBe(true);
	});

	it('never reports no-auth allowed when auth is configured', () => {
		expect(isNoAuthAllowed(cfg({ API_BEARER_TOKEN: 't', TEXTRAWL_ALLOW_NO_AUTH: true }))).toBe(
			false,
		);
	});
});
