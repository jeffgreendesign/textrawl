import { createHash } from 'node:crypto';
import { CloudTasksClient } from '@google-cloud/tasks';
import { logger } from '../../utils/logger.js';
import type { EnqueueResult, TaskQueue } from './types.js';

/** Construction options for {@link CloudTasksQueue}. */
export interface CloudTasksQueueOptions {
	/** Queue id (e.g. `textrawl-upload-processing`). */
	queue: string;
	/** Queue location/region (e.g. `us-east4`). */
	location: string;
	/**
	 * OIDC identity minted into the task; verified by the processing endpoint.
	 * Required — OIDC is mandatory (no dev bypass), so a missing identity would
	 * only surface as a `createTask` failure at enqueue time. The factory gates on
	 * it (see `tasks/index.ts`) so callers fail fast / fall back loudly instead.
	 */
	serviceAccountEmail: string;
	/** Base processing URL; the task targets `<processUrl>/<uploadId>`. Also the OIDC audience. */
	processUrl: string;
	/** GCP project id; optional — auto-detected from ADC when omitted. */
	projectId?: string;
}

/** gRPC status code for an already-existing resource (task name collision → dedupe). */
const GRPC_ALREADY_EXISTS = 6;

/** Type guard for the numeric `code` carried on gapic/gRPC errors. */
function grpcCode(error: unknown): number | undefined {
	if (error && typeof error === 'object' && 'code' in error) {
		const code = (error as { code: unknown }).code;
		return typeof code === 'number' ? code : undefined;
	}
	return undefined;
}

/**
 * Real Google Cloud Tasks {@link TaskQueue} (plan §3/§4, T4.1).
 *
 * Enqueues exactly one HTTP task per upload id, targeting the internal
 * `POST <processUrl>/<uploadId>` endpoint with an OIDC token (so Cloud Run can
 * verify the caller is Cloud Tasks). Dedupe is by a deterministic task `name`
 * (`process-<uploadId>`): Cloud Tasks rejects a duplicate name with
 * `ALREADY_EXISTS`, which we swallow and report as `deduplicated: true`. The
 * Cloud Run runtime service account authenticates through ADC — no key files.
 */
export class CloudTasksQueue implements TaskQueue {
	private readonly client: CloudTasksClient;
	private readonly opts: CloudTasksQueueOptions;
	private parentPromise: Promise<string> | null = null;

	constructor(opts: CloudTasksQueueOptions) {
		this.client = new CloudTasksClient();
		this.opts = opts;
	}

	/** Resolve and memoize the fully-qualified queue path (resolves the project lazily). */
	private async parent(): Promise<string> {
		if (!this.parentPromise) {
			this.parentPromise = (async () => {
				try {
					const projectId = this.opts.projectId ?? (await this.client.getProjectId());
					return this.client.queuePath(projectId, this.opts.location, this.opts.queue);
				} catch (error) {
					// Never cache a rejected promise — clear it so a later call retries
					// (e.g. a transient ADC / project-id resolution failure).
					this.parentPromise = null;
					throw error;
				}
			})();
		}
		return this.parentPromise;
	}

	async enqueueProcessing(uploadId: string): Promise<EnqueueResult> {
		const parent = await this.parent();
		// Cloud Tasks task ids allow only [A-Za-z0-9_-]. Derive the dedupe key from a
		// hash of the *full* upload id (base64url is exactly that charset) so the name
		// is deterministic per upload yet collision-free for any id shape — a lossy
		// character-replace could map two distinct ids to the same task.
		const taskId = createHash('sha256').update(uploadId).digest('base64url');
		const taskName = `${parent}/tasks/process-${taskId}`;

		try {
			await this.client.createTask({
				parent,
				task: {
					name: taskName,
					httpRequest: {
						httpMethod: 'POST',
						// Encode only the id segment; the base URL/slashes stay intact.
						url: `${this.opts.processUrl}/${encodeURIComponent(uploadId)}`,
						oidcToken: {
							serviceAccountEmail: this.opts.serviceAccountEmail,
							audience: this.opts.processUrl,
						},
					},
				},
			});
			logger.info('CloudTasksQueue: enqueued processing', { uploadId, taskName });
			return { taskName, deduplicated: false };
		} catch (error) {
			if (grpcCode(error) === GRPC_ALREADY_EXISTS) {
				logger.debug('CloudTasksQueue: deduped enqueue (ALREADY_EXISTS)', { uploadId, taskName });
				return { taskName, deduplicated: true };
			}
			throw error;
		}
	}
}
