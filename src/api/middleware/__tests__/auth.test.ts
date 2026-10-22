/**
 * bearerAuth must fail closed when no auth method is configured, passing
 * requests through only on the explicit TEXTRAWL_ALLOW_NO_AUTH dev opt-in.
 */
import type { NextFunction, Request, Response } from 'express';
import { beforeEach, describe, expect, it, vi } from 'vitest';

const { mockConfig } = vi.hoisted(() => ({
	mockConfig: {
		NODE_ENV: 'development' as 'development' | 'production' | 'test',
		API_BEARER_TOKEN: undefined as string | undefined,
		GOOGLE_CLIENT_ID: undefined as string | undefined,
		OAUTH_JWT_SECRET: undefined as string | undefined,
		TEXTRAWL_ALLOW_NO_AUTH: false,
	},
}));

vi.mock('../../../utils/config.js', () => ({ config: mockConfig }));
vi.mock('../../../utils/logger.js', () => ({
	logger: { debug: vi.fn(), info: vi.fn(), warn: vi.fn(), error: vi.fn() },
}));

import { bearerAuth } from '../auth.js';

const res = {} as Response;
const req = (token?: string) =>
	({
		headers: token ? { authorization: `Bearer ${token}` } : {},
		path: '/mcp',
	}) as unknown as Request;

beforeEach(() => {
	mockConfig.NODE_ENV = 'development';
	mockConfig.API_BEARER_TOKEN = undefined;
	mockConfig.GOOGLE_CLIENT_ID = undefined;
	mockConfig.TEXTRAWL_ALLOW_NO_AUTH = false;
});

describe('bearerAuth with no auth configured', () => {
	it('rejects requests by default (fail closed)', async () => {
		const next = vi.fn() as unknown as NextFunction;
		await expect(bearerAuth(req(), res, next)).rejects.toThrow(/not configured/);
		expect(next).not.toHaveBeenCalled();
	});

	it('passes through only with TEXTRAWL_ALLOW_NO_AUTH=true', async () => {
		mockConfig.TEXTRAWL_ALLOW_NO_AUTH = true;
		const next = vi.fn() as unknown as NextFunction;
		await bearerAuth(req(), res, next);
		expect(next).toHaveBeenCalledOnce();
	});

	it('still rejects in production even with the opt-in', async () => {
		mockConfig.NODE_ENV = 'production';
		mockConfig.TEXTRAWL_ALLOW_NO_AUTH = true;
		const next = vi.fn() as unknown as NextFunction;
		await expect(bearerAuth(req(), res, next)).rejects.toThrow();
		expect(next).not.toHaveBeenCalled();
	});
});

describe('bearerAuth with a bearer token configured (unchanged behavior)', () => {
	beforeEach(() => {
		mockConfig.API_BEARER_TOKEN = 'a'.repeat(40);
	});

	it('accepts the configured token', async () => {
		const next = vi.fn() as unknown as NextFunction;
		await bearerAuth(req('a'.repeat(40)), res, next);
		expect(next).toHaveBeenCalledOnce();
	});

	it('rejects a missing header', async () => {
		const next = vi.fn() as unknown as NextFunction;
		await expect(bearerAuth(req(), res, next)).rejects.toThrow(/Missing Authorization/);
	});

	it('rejects a wrong token', async () => {
		const next = vi.fn() as unknown as NextFunction;
		await expect(bearerAuth(req('b'.repeat(40)), res, next)).rejects.toThrow(/Invalid token/);
	});
});
