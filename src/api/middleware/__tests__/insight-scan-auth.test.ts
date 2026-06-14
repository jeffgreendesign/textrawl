/**
 * Tests for insightScanAuth — the auth used by POST /api/insights/scan. It must
 * accept the dedicated INSIGHT_SCAN_TOKEN (used by the external scheduler) and
 * otherwise fall back to the standard bearerAuth (master API token / OAuth JWT).
 */
import type { NextFunction, Request, Response } from 'express';
import { describe, expect, it, vi } from 'vitest';

vi.mock('../../../utils/config.js', () => ({
	config: {
		INSIGHT_SCAN_TOKEN: 'scan-secret',
		API_BEARER_TOKEN: 'master-token',
		GOOGLE_CLIENT_ID: undefined,
		OAUTH_JWT_SECRET: undefined,
	},
}));

vi.mock('../../../utils/logger.js', () => ({
	logger: { debug: vi.fn(), info: vi.fn(), warn: vi.fn(), error: vi.fn() },
}));

import { insightScanAuth } from '../auth.js';

function reqWith(token?: string): Request {
	return {
		headers: token ? { authorization: `Bearer ${token}` } : {},
		path: '/api/insights/scan',
	} as unknown as Request;
}

const res = {} as Response;

describe('insightScanAuth', () => {
	it('accepts the dedicated scan token', () => {
		const next = vi.fn() as unknown as NextFunction;
		insightScanAuth(reqWith('scan-secret'), res, next);
		expect(next).toHaveBeenCalledOnce();
		expect(next).toHaveBeenCalledWith(); // no error arg
	});

	it('falls back to bearerAuth and accepts the master API token', async () => {
		const next = vi.fn() as unknown as NextFunction;
		await insightScanAuth(reqWith('master-token'), res, next);
		expect(next).toHaveBeenCalledOnce();
	});

	it('rejects a token matching neither', async () => {
		const next = vi.fn() as unknown as NextFunction;
		await expect(Promise.resolve(insightScanAuth(reqWith('bogus'), res, next))).rejects.toThrow();
		expect(next).not.toHaveBeenCalled();
	});
});
