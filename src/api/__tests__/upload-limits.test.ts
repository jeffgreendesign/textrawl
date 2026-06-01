/**
 * Upload size-limit test (T1.1).
 *
 * `config.MAX_SINGLE_FILE_SIZE_MB` is mocked so the derived multer byte limit is
 * deterministic regardless of the host environment. Behavioral upload/error-shape
 * tests (supertest against uploadRouter + errorHandler) are added in T1.2.
 */
import { describe, expect, it, vi } from 'vitest';

vi.mock('../../utils/config.js', () => ({
	config: { MAX_SINGLE_FILE_SIZE_MB: 1 },
}));

import { config } from '../../utils/config.js';
import { maxUploadBytes } from '../upload.js';

describe('upload size limit (T1.1)', () => {
	it('derives the multer byte limit from config, not a hardcoded literal', () => {
		expect(maxUploadBytes).toBe(config.MAX_SINGLE_FILE_SIZE_MB * 1024 * 1024);
	});
});
