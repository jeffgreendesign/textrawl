/**
 * Storage factory dispatch tests (T3.2).
 *
 * `getStorageService()` is the single swap point: GCS when `GCS_UPLOAD_BUCKET`
 * is set, the in-memory fake otherwise. Config and the GCS client are mocked so
 * the GcsStorageService branch constructs without touching real credentials.
 */
import { afterEach, describe, expect, it, vi } from 'vitest';

const { mockConfig } = vi.hoisted(() => ({
	mockConfig: {
		GCS_UPLOAD_BUCKET: undefined as string | undefined,
		GCS_PROJECT_ID: undefined as string | undefined,
		UPLOAD_SESSION_TTL_MIN: 120,
	},
}));

vi.mock('../../../utils/config.js', () => ({ config: mockConfig }));
vi.mock('../../../utils/logger.js', () => ({
	logger: { debug: vi.fn(), info: vi.fn(), warn: vi.fn(), error: vi.fn() },
}));
vi.mock('@google-cloud/storage', () => ({
	Storage: vi.fn(function StorageMock() {
		return { bucket: vi.fn() };
	}),
}));

import { GcsStorageService } from '../gcs.js';
import { getStorageService, setStorageService } from '../index.js';
import { MemoryStorageService } from '../memory.js';

afterEach(() => {
	setStorageService(null);
	mockConfig.GCS_UPLOAD_BUCKET = undefined;
});

describe('getStorageService', () => {
	it('returns the in-memory fake when GCS_UPLOAD_BUCKET is unset', () => {
		mockConfig.GCS_UPLOAD_BUCKET = undefined;
		expect(getStorageService()).toBeInstanceOf(MemoryStorageService);
	});

	it('returns the GCS service when GCS_UPLOAD_BUCKET is set', () => {
		mockConfig.GCS_UPLOAD_BUCKET = 'textrawl-uploads';
		expect(getStorageService()).toBeInstanceOf(GcsStorageService);
	});

	it('memoizes the resolved instance', () => {
		mockConfig.GCS_UPLOAD_BUCKET = 'textrawl-uploads';
		expect(getStorageService()).toBe(getStorageService());
	});
});
