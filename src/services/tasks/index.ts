import { MemoryTaskQueue } from './memory.js';
import type { TaskQueue } from './types.js';

export type { EnqueueResult, TaskQueue } from './types.js';

let instance: TaskQueue | null = null;

/**
 * Resolve the active {@link TaskQueue}.
 *
 * Returns the in-memory fake until the real Cloud Tasks implementation lands
 * (T4.1). The upload-session router depends only on the interface, so swapping
 * the implementation here requires no router changes.
 */
export function getTaskQueue(): TaskQueue {
	if (!instance) {
		instance = new MemoryTaskQueue();
	}
	return instance;
}

/** Test seam: override the resolved task queue (or reset with `null`). */
export function setTaskQueue(queue: TaskQueue | null): void {
	instance = queue;
}
