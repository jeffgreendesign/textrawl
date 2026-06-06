import { config } from '../../utils/config.js';
import { logger } from '../../utils/logger.js';
import { CloudTasksQueue } from './cloud-tasks.js';
import { MemoryTaskQueue } from './memory.js';
import type { TaskQueue } from './types.js';

export type { EnqueueResult, TaskQueue } from './types.js';

let instance: TaskQueue | null = null;

/**
 * Resolve the active {@link TaskQueue}.
 *
 * Dispatches on Cloud Tasks config: when `CLOUD_TASKS_QUEUE`,
 * `UPLOAD_PROCESS_URL`, and `CLOUD_TASKS_SERVICE_ACCOUNT` are all set, the real
 * Cloud Tasks queue; otherwise (local dev / tests) the in-memory fake. The
 * service account is mandatory because OIDC has no bypass — a partial config
 * warns and falls back rather than building a queue that would fail at enqueue.
 * The upload-session router depends only on the interface, so this is the single
 * swap point. Memoized — call {@link setTaskQueue} to reset between tests.
 */
export function getTaskQueue(): TaskQueue {
	if (!instance) {
		if (
			config.CLOUD_TASKS_QUEUE &&
			config.UPLOAD_PROCESS_URL &&
			config.CLOUD_TASKS_SERVICE_ACCOUNT
		) {
			logger.info('Tasks: using Cloud Tasks', { queue: config.CLOUD_TASKS_QUEUE });
			instance = new CloudTasksQueue({
				queue: config.CLOUD_TASKS_QUEUE,
				location: config.CLOUD_TASKS_LOCATION,
				serviceAccountEmail: config.CLOUD_TASKS_SERVICE_ACCOUNT,
				processUrl: config.UPLOAD_PROCESS_URL,
				projectId: config.GCS_PROJECT_ID,
			});
		} else {
			if (
				config.CLOUD_TASKS_QUEUE ||
				config.UPLOAD_PROCESS_URL ||
				config.CLOUD_TASKS_SERVICE_ACCOUNT
			) {
				logger.warn(
					'Tasks: Cloud Tasks partially configured — need CLOUD_TASKS_QUEUE + UPLOAD_PROCESS_URL + CLOUD_TASKS_SERVICE_ACCOUNT; using in-memory fake',
				);
			} else {
				logger.info('Tasks: Cloud Tasks env unset — using in-memory fake');
			}
			instance = new MemoryTaskQueue();
		}
	}
	return instance;
}

/** Test seam: override the resolved task queue (or reset with `null`). */
export function setTaskQueue(queue: TaskQueue | null): void {
	instance = queue;
}
