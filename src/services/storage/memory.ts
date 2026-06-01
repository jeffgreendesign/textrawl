import { randomUUID } from 'node:crypto';
import { logger } from '../../utils/logger.js';
import type {
	ObjectMetadata,
	ResumableSession,
	StartResumableOptions,
	StorageService,
} from './types.js';

/**
 * In-memory {@link StorageService} fake for development and tests.
 *
 * Stands in for GCS until the real resumable implementation lands (T3.1). On
 * `startResumableSession` it records the declared size keyed by object key, then
 * `headObject` reports that same size — simulating a browser that PUT exactly the
 * declared bytes. This lets the `/complete` size-verification control flow exist
 * and be tested before any real object store is wired in.
 */
export class MemoryStorageService implements StorageService {
	private readonly sessions = new Map<
		string,
		{ size: number; generation: string; crc32c: string; etag: string }
	>();

	async startResumableSession(
		objectKey: string,
		opts: StartResumableOptions,
	): Promise<ResumableSession> {
		const sessionId = randomUUID();
		this.sessions.set(objectKey, {
			size: opts.size,
			generation: Date.now().toString(),
			crc32c: 'AAAAAA==',
			etag: sessionId,
		});
		logger.debug('MemoryStorage: started resumable session', { objectKey });
		return {
			resumableUri: `memory://uploads/${encodeURIComponent(objectKey)}?session=${sessionId}`,
			expiresAt: new Date(Date.now() + 2 * 60 * 60 * 1000).toISOString(),
		};
	}

	async headObject(objectKey: string): Promise<ObjectMetadata | null> {
		const session = this.sessions.get(objectKey);
		return session ? { ...session } : null;
	}

	async abortSession(objectKey: string): Promise<void> {
		this.sessions.delete(objectKey);
		logger.debug('MemoryStorage: aborted session', { objectKey });
	}
}
