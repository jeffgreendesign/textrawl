import { config } from '../../utils/config.js';
import { logger } from '../../utils/logger.js';
import { GcsStorageService } from './gcs.js';
import { MemoryStorageService } from './memory.js';
import type { StorageService } from './types.js';

export type {
	ObjectMetadata,
	ResumableSession,
	StartResumableOptions,
	StorageService,
} from './types.js';

let instance: StorageService | null = null;

/**
 * Resolve the active {@link StorageService}.
 *
 * Dispatches on `GCS_UPLOAD_BUCKET`: when set, real GCS-backed storage; when
 * unset (local dev / tests), the in-memory fake. The upload-session router
 * depends only on the interface, so this is the single swap point. Memoized —
 * call {@link setStorageService} to reset between tests.
 */
export function getStorageService(): StorageService {
	if (!instance) {
		if (config.GCS_UPLOAD_BUCKET) {
			logger.info('Storage: using GCS', { bucket: config.GCS_UPLOAD_BUCKET });
			instance = new GcsStorageService({
				bucket: config.GCS_UPLOAD_BUCKET,
				projectId: config.GCS_PROJECT_ID,
				sessionTtlMinutes: config.UPLOAD_SESSION_TTL_MIN,
			});
		} else {
			logger.info('Storage: GCS_UPLOAD_BUCKET unset — using in-memory fake');
			instance = new MemoryStorageService();
		}
	}
	return instance;
}

/** Test seam: override the resolved storage service (or reset with `null`). */
export function setStorageService(service: StorageService | null): void {
	instance = service;
}
