/**
 * Cloud Tasks queue tests (T4.1).
 *
 * `@google-cloud/tasks` is fully mocked — hermetic unit tests with no network or
 * real queue. They pin the plan T4.1 contract: exactly one HTTP task per upload
 * id, targeting `UPLOAD_PROCESS_URL/<id>` with an OIDC token, deduped by a
 * deterministic task name; a gRPC `ALREADY_EXISTS` (code 6) is swallowed as a
 * dedupe rather than surfaced as an error.
 */
import { beforeEach, describe, expect, it, vi } from 'vitest';

const { clientCtor, createTask, queuePath, getProjectId } = vi.hoisted(() => {
	const createTask = vi.fn();
	const queuePath = vi.fn(
		(p: string, l: string, q: string) => `projects/${p}/locations/${l}/queues/${q}`,
	);
	const getProjectId = vi.fn(async () => 'textrawl');
	// Regular function (not arrow) so `new CloudTasksClient()` is constructable.
	const clientCtor = vi.fn(function CloudTasksClientMock() {
		return { createTask, queuePath, getProjectId };
	});
	return { clientCtor, createTask, queuePath, getProjectId };
});

vi.mock('@google-cloud/tasks', () => ({ CloudTasksClient: clientCtor }));
vi.mock('../../../utils/logger.js', () => ({
	logger: { debug: vi.fn(), info: vi.fn(), warn: vi.fn(), error: vi.fn() },
}));

import { CloudTasksQueue } from '../cloud-tasks.js';

const OPTS = {
	queue: 'textrawl-upload-processing',
	location: 'us-east4',
	serviceAccountEmail: 'textrawl-tasks@textrawl.iam.gserviceaccount.com',
	processUrl: 'https://textrawl.example.run.app/api/upload/process',
	projectId: 'textrawl',
};

const PARENT = 'projects/textrawl/locations/us-east4/queues/textrawl-upload-processing';
const NAME_RE = new RegExp(`^${PARENT}/tasks/process-[A-Za-z0-9_-]+$`);

beforeEach(() => {
	vi.clearAllMocks();
	createTask.mockResolvedValue([{ name: 'created' }]);
});

describe('CloudTasksQueue', () => {
	it('enqueues one HTTP task targeting the upload id with an OIDC token', async () => {
		const res = await new CloudTasksQueue(OPTS).enqueueProcessing('abc-123');

		expect(createTask).toHaveBeenCalledTimes(1);
		const arg = createTask.mock.calls[0][0];
		expect(arg.parent).toBe(PARENT);
		// Task name is a deterministic hash of the upload id — assert shape, not value,
		// and that the returned taskName matches the one sent to Cloud Tasks.
		expect(arg.task.name).toMatch(NAME_RE);
		expect(arg.task.httpRequest.httpMethod).toBe('POST');
		expect(arg.task.httpRequest.url).toBe(`${OPTS.processUrl}/abc-123`);
		expect(arg.task.httpRequest.oidcToken).toEqual({
			serviceAccountEmail: OPTS.serviceAccountEmail,
			audience: OPTS.processUrl,
		});
		expect(res).toEqual({ taskName: arg.task.name, deduplicated: false });
	});

	it('derives a deterministic, collision-free task name from the full upload id', async () => {
		const a1 = await new CloudTasksQueue(OPTS).enqueueProcessing('abc-123');
		const a2 = await new CloudTasksQueue(OPTS).enqueueProcessing('abc-123');
		const b = await new CloudTasksQueue(OPTS).enqueueProcessing('abc-124');

		// Same id → same name (stable dedupe across instances/retries).
		expect(a1.taskName).toBe(a2.taskName);
		// Different ids → different names (no lossy collision).
		expect(a1.taskName).not.toBe(b.taskName);
		// Always within the Cloud Tasks task-id charset.
		expect(a1.taskName).toMatch(NAME_RE);
	});

	it('url-encodes the upload id segment without corrupting the base URL', async () => {
		await new CloudTasksQueue(OPTS).enqueueProcessing('a/b');
		const arg = createTask.mock.calls[0][0];
		expect(arg.task.httpRequest.url).toBe(`${OPTS.processUrl}/a%2Fb`);
		// The name still only contains safe characters despite the unsafe id.
		expect(arg.task.name).toMatch(NAME_RE);
	});

	it('treats ALREADY_EXISTS (gRPC code 6) as a dedupe, not an error', async () => {
		createTask.mockRejectedValueOnce(Object.assign(new Error('already exists'), { code: 6 }));
		const res = await new CloudTasksQueue(OPTS).enqueueProcessing('abc-123');
		expect(res.deduplicated).toBe(true);
		expect(res.taskName).toMatch(NAME_RE);
	});

	it('rethrows non-ALREADY_EXISTS errors', async () => {
		createTask.mockRejectedValueOnce(Object.assign(new Error('boom'), { code: 13 }));
		await expect(new CloudTasksQueue(OPTS).enqueueProcessing('abc-123')).rejects.toThrow('boom');
	});

	it('resolves the project id from the client when not configured', async () => {
		await new CloudTasksQueue({ ...OPTS, projectId: undefined }).enqueueProcessing('abc-123');
		expect(getProjectId).toHaveBeenCalled();
		expect(queuePath).toHaveBeenCalledWith('textrawl', 'us-east4', 'textrawl-upload-processing');
	});

	it('does not cache a failed project-id resolution — a later enqueue retries', async () => {
		getProjectId.mockRejectedValueOnce(new Error('ADC unavailable'));
		const queue = new CloudTasksQueue({ ...OPTS, projectId: undefined });

		await expect(queue.enqueueProcessing('abc-123')).rejects.toThrow('ADC unavailable');
		// getProjectId resolves on the retry (default mock) → the queue recovers.
		const res = await queue.enqueueProcessing('abc-123');
		expect(res.deduplicated).toBe(false);
		expect(getProjectId).toHaveBeenCalledTimes(2);
	});
});
