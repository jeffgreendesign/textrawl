import { beforeEach, describe, expect, it, vi } from 'vitest';
import { z } from 'zod';

vi.mock('../../utils/config.js', () => ({
	config: { COMPACT_RESPONSES: false, ENABLE_MEMORY_EXTRACTION: false },
}));
vi.mock('../../utils/logger.js', () => ({
	logger: { debug: vi.fn(), info: vi.fn(), warn: vi.fn(), error: vi.fn() },
}));
vi.mock('../../db/pg-client.js', () => ({ isDatabaseConfigured: vi.fn(() => true) }));
vi.mock('../../services/embeddings.js', () => ({ isEmbeddingsConfigured: vi.fn(() => true) }));
vi.mock('../note.js', () => ({ runAddNote: vi.fn() }));
vi.mock('../url.js', () => ({ runSaveUrl: vi.fn() }));

import { isDatabaseConfigured } from '../../db/pg-client.js';
import { isEmbeddingsConfigured } from '../../services/embeddings.js';
import { registerCaptureTool } from '../capture.js';
import { runAddNote } from '../note.js';
import { runSaveUrl } from '../url.js';

type ToolHandler = (args: Record<string, unknown>, extra: unknown) => Promise<unknown>;

const CaptureOutputSchema = z.object({
	ok: z.boolean(),
	kind: z.enum(['note', 'url']),
	documentId: z.string(),
	title: z.string(),
	chunksCreated: z.number(),
	url: z.string().optional(),
	contentLength: z.number().optional(),
	memoryExtraction: z.record(z.string(), z.unknown()).nullable().optional(),
});

function createHandler(): (args: Record<string, unknown>) => Promise<unknown> {
	let handler: ToolHandler | undefined;
	const fakeServer = {
		registerTool: (_n: string, _o: unknown, cb: ToolHandler) => {
			handler = cb;
		},
	};
	registerCaptureTool(fakeServer as never);
	if (!handler) throw new Error('registerCaptureTool did not register a handler');
	const h = handler;
	return (args) => h(args, {});
}

describe('capture tool', () => {
	let capture: ReturnType<typeof createHandler>;

	beforeEach(() => {
		vi.clearAllMocks();
		vi.mocked(isDatabaseConfigured).mockReturnValue(true);
		vi.mocked(isEmbeddingsConfigured).mockReturnValue(true);
		capture = createHandler();
	});

	it('routes kind="note" to runAddNote', async () => {
		vi.mocked(runAddNote).mockResolvedValue({
			documentId: 'doc-1234567890',
			title: 'My Note',
			chunksCreated: 2,
			memoryExtraction: null,
		});

		const result = (await capture({
			kind: 'note',
			title: 'My Note',
			content: 'hello world',
			extractMemories: false,
		})) as { structuredContent?: Record<string, unknown> };

		expect(runAddNote).toHaveBeenCalledWith(
			expect.objectContaining({ title: 'My Note', content: 'hello world' }),
		);
		expect(runSaveUrl).not.toHaveBeenCalled();
		expect(result.structuredContent).toMatchObject({
			ok: true,
			kind: 'note',
			documentId: 'doc-1234567890',
			chunksCreated: 2,
		});
		expect(CaptureOutputSchema.safeParse(result.structuredContent).success).toBe(true);
	});

	it('routes kind="url" to runSaveUrl', async () => {
		vi.mocked(runSaveUrl).mockResolvedValue({
			documentId: 'doc-url-1',
			title: 'Example',
			url: 'https://example.com',
			chunksCreated: 5,
			contentLength: 1200,
			memoryExtraction: null,
		});

		const result = (await capture({
			kind: 'url',
			url: 'https://example.com',
			extractMemories: false,
		})) as { structuredContent?: Record<string, unknown> };

		expect(runSaveUrl).toHaveBeenCalledWith(
			expect.objectContaining({ url: 'https://example.com' }),
		);
		expect(result.structuredContent).toMatchObject({ ok: true, kind: 'url', chunksCreated: 5 });
		expect(CaptureOutputSchema.safeParse(result.structuredContent).success).toBe(true);
	});

	it('returns a validation_error with missing_fields for kind="note" without content', async () => {
		const result = (await capture({ kind: 'note', title: 'No body' })) as {
			isError?: boolean;
			content: Array<{ text: string }>;
		};
		expect(result.isError).toBe(true);
		const parsed = JSON.parse(result.content[0].text);
		expect(parsed.ok).toBe(false);
		expect(parsed.error.code).toBe('validation_error');
		expect(parsed.error.missing_fields).toEqual(['content']);
		expect(runAddNote).not.toHaveBeenCalled();
	});

	it('returns a validation_error for kind="url" without url', async () => {
		const result = (await capture({ kind: 'url' })) as {
			isError?: boolean;
			content: Array<{ text: string }>;
		};
		expect(result.isError).toBe(true);
		const parsed = JSON.parse(result.content[0].text);
		expect(parsed.error.missing_fields).toEqual(['url']);
		expect(runSaveUrl).not.toHaveBeenCalled();
	});

	it('returns a config error when the database is not configured', async () => {
		vi.mocked(isDatabaseConfigured).mockReturnValue(false);
		const result = (await capture({ kind: 'note', title: 't', content: 'c' })) as {
			isError?: boolean;
			content: Array<{ text: string }>;
		};
		expect(result.isError).toBe(true);
		expect(result.content[0].text).toContain('DATABASE_URL');
	});
});
