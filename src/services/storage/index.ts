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
 * Returns the in-memory fake until the real GCS resumable implementation lands
 * (T3.1), at which point this factory dispatches on `GCS_UPLOAD_BUCKET`. The
 * upload-session router depends only on the interface, so swapping the
 * implementation here requires no router changes.
 */
export function getStorageService(): StorageService {
	if (!instance) {
		instance = new MemoryStorageService();
	}
	return instance;
}

/** Test seam: override the resolved storage service (or reset with `null`). */
export function setStorageService(service: StorageService | null): void {
	instance = service;
}
