/**
 * Task-queue factory dispatch tests (T4.1).
 *
 * `getTaskQueue()` is the single swap point: the real Cloud Tasks queue when
 * both `CLOUD_TASKS_QUEUE` and `UPLOAD_PROCESS_URL` are set, the in-memory fake
 * otherwise. Config and the Cloud Tasks client are mocked so the CloudTasksQueue
 * branch constructs without touching real credentials.
 */
import { afterEach, describe, expect, it, vi } from 'vitest';

const { mockConfig } = vi.hoisted(() => ({
	mockConfig: {
		CLOUD_TASKS_QUEUE: undefined as string | undefined,
		CLOUD_TASKS_LOCATION: 'us-central1',
		CLOUD_TASKS_SERVICE_ACCOUNT: undefined as string | undefined,
		UPLOAD_PROCESS_URL: undefined as string | undefined,
		GCS_PROJECT_ID: undefined as string | undefined,
	},
}));

vi.mock('../../../utils/config.js', () => ({ config: mockConfig }));
vi.mock('../../../utils/logger.js', () => ({
	logger: { debug: vi.fn(), info: vi.fn(), warn: vi.fn(), error: vi.fn() },
}));
vi.mock('@google-cloud/tasks', () => ({
	CloudTasksClient: vi.fn(function CloudTasksClientMock() {
		return { createTask: vi.fn(), queuePath: vi.fn(), getProjectId: vi.fn() };
	}),
}));

import { CloudTasksQueue } from '../cloud-tasks.js';
import { getTaskQueue, setTaskQueue } from '../index.js';
import { MemoryTaskQueue } from '../memory.js';

afterEach(() => {
	setTaskQueue(null);
	mockConfig.CLOUD_TASKS_QUEUE = undefined;
	mockConfig.UPLOAD_PROCESS_URL = undefined;
	mockConfig.CLOUD_TASKS_SERVICE_ACCOUNT = undefined;
});

describe('getTaskQueue', () => {
	it('returns the in-memory fake when Cloud Tasks env is unset', () => {
		expect(getTaskQueue()).toBeInstanceOf(MemoryTaskQueue);
	});

	it('returns the Cloud Tasks queue when queue + process URL + service account are set', () => {
		mockConfig.CLOUD_TASKS_QUEUE = 'textrawl-upload-processing';
		mockConfig.UPLOAD_PROCESS_URL = 'https://x.run.app/api/upload/process';
		mockConfig.CLOUD_TASKS_SERVICE_ACCOUNT = 'tasks@x.iam.gserviceaccount.com';
		expect(getTaskQueue()).toBeInstanceOf(CloudTasksQueue);
	});

	it('falls back to the fake when only the queue is set (no process URL)', () => {
		mockConfig.CLOUD_TASKS_QUEUE = 'textrawl-upload-processing';
		expect(getTaskQueue()).toBeInstanceOf(MemoryTaskQueue);
	});

	it('falls back to the fake when the service account is missing (OIDC is mandatory)', () => {
		mockConfig.CLOUD_TASKS_QUEUE = 'textrawl-upload-processing';
		mockConfig.UPLOAD_PROCESS_URL = 'https://x.run.app/api/upload/process';
		expect(getTaskQueue()).toBeInstanceOf(MemoryTaskQueue);
	});

	it('memoizes the resolved instance', () => {
		mockConfig.CLOUD_TASKS_QUEUE = 'textrawl-upload-processing';
		mockConfig.UPLOAD_PROCESS_URL = 'https://x.run.app/api/upload/process';
		mockConfig.CLOUD_TASKS_SERVICE_ACCOUNT = 'tasks@x.iam.gserviceaccount.com';
		expect(getTaskQueue()).toBe(getTaskQueue());
	});
});
