import { logger } from '../../utils/logger.js';
import type { EnqueueResult, TaskQueue } from './types.js';

/**
 * In-memory {@link TaskQueue} fake for development and tests.
 *
 * Records enqueued upload ids and dedupes by id, mirroring the Cloud Tasks
 * dedupe-by-name guarantee the real implementation (T4.1) will provide. Exposes
 * `enqueued` so tests can assert a task was scheduled exactly once.
 */
export class MemoryTaskQueue implements TaskQueue {
	readonly enqueued: string[] = [];
	private readonly seen = new Set<string>();

	async enqueueProcessing(uploadId: string): Promise<EnqueueResult> {
		const taskName = `process-${uploadId}`;
		if (this.seen.has(uploadId)) {
			logger.debug('MemoryTaskQueue: deduped enqueue', { uploadId });
			return { taskName, deduplicated: true };
		}
		this.seen.add(uploadId);
		this.enqueued.push(uploadId);
		logger.debug('MemoryTaskQueue: enqueued processing', { uploadId });
		return { taskName, deduplicated: false };
	}
}
