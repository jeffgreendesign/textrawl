/**
 * Async task-queue port for the large-upload workflow (plan §3/§4).
 *
 * Shaped to match the planned Cloud Tasks implementation (T4.1): `/complete`
 * enqueues exactly one processing task keyed by `uploadId`, and retries/duplicate
 * enqueues for the same id are deduplicated. The in-memory fake used in T2.3 lets
 * the enqueue control flow (and its dedupe) be tested before Cloud Tasks exists.
 */

export interface EnqueueResult {
	/** Stable task name; deduped per upload id. */
	taskName: string;
	/** True when an existing task for this upload id was reused (no new task). */
	deduplicated: boolean;
}

export interface TaskQueue {
	/**
	 * Enqueue processing for `uploadId`. Idempotent: a second enqueue for the same
	 * id returns the existing task name with `deduplicated: true`.
	 */
	enqueueProcessing(uploadId: string): Promise<EnqueueResult>;
}
