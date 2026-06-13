import { beforeEach, describe, expect, it, vi } from 'vitest';
import { z } from 'zod';

vi.mock('../../utils/config.js', () => ({ config: { COMPACT_RESPONSES: false } }));
vi.mock('../../utils/logger.js', () => ({
	logger: { debug: vi.fn(), info: vi.fn(), warn: vi.fn(), error: vi.fn() },
}));
vi.mock('../../db/pg-client.js', () => ({ isDatabaseConfigured: vi.fn(() => true) }));
vi.mock('../../services/embeddings.js', () => ({ isEmbeddingsConfigured: vi.fn(() => true) }));
vi.mock('../memory.js', () => ({ runBuildKnowledge: vi.fn() }));

import { isDatabaseConfigured } from '../../db/pg-client.js';
import { isEmbeddingsConfigured } from '../../services/embeddings.js';
import { runBuildKnowledge } from '../memory.js';
import { registerRememberTool } from '../remember.js';

type ToolHandler = (args: Record<string, unknown>, extra: unknown) => Promise<unknown>;

const RememberOutputSchema = z.object({
	ok: z.boolean(),
	factsCreated: z.number(),
	factsDuplicate: z.number(),
	relationsCreated: z.number(),
	partial: z.boolean().optional(),
	errors: z.array(z.string()).optional(),
});

function createHandler(): (args: Record<string, unknown>) => Promise<unknown> {
	let handler: ToolHandler | undefined;
	const fakeServer = {
		registerTool: (_n: string, _o: unknown, cb: ToolHandler) => {
			handler = cb;
		},
	};
	registerRememberTool(fakeServer as never);
	if (!handler) throw new Error('registerRememberTool did not register a handler');
	const h = handler;
	return (args) => h(args, {});
}

describe('remember tool', () => {
	let remember: ReturnType<typeof createHandler>;

	beforeEach(() => {
		vi.clearAllMocks();
		vi.mocked(isDatabaseConfigured).mockReturnValue(true);
		vi.mocked(isEmbeddingsConfigured).mockReturnValue(true);
		remember = createHandler();
	});

	it('stores facts via runBuildKnowledge', async () => {
		vi.mocked(runBuildKnowledge).mockResolvedValue({
			factsCreated: 1,
			factsDuplicate: 0,
			relationsCreated: 0,
			errors: [],
		});

		const result = (await remember({
			facts: [{ entityName: 'Ada', entityType: 'person', observation: 'likes tea' }],
		})) as { structuredContent?: Record<string, unknown> };

		expect(runBuildKnowledge).toHaveBeenCalledWith(
			expect.objectContaining({ facts: expect.any(Array) }),
		);
		expect(result.structuredContent).toMatchObject({ ok: true, factsCreated: 1 });
		expect(RememberOutputSchema.safeParse(result.structuredContent).success).toBe(true);
	});

	it('requires at least one fact or relation', async () => {
		const result = (await remember({})) as { isError?: boolean; content: Array<{ text: string }> };
		expect(result.isError).toBe(true);
		const parsed = JSON.parse(result.content[0].text);
		expect(parsed.error.code).toBe('validation_error');
		expect(parsed.error.missing_fields).toEqual(['facts', 'relations']);
		expect(runBuildKnowledge).not.toHaveBeenCalled();
	});

	it('reports partial success when some items fail', async () => {
		vi.mocked(runBuildKnowledge).mockResolvedValue({
			factsCreated: 1,
			factsDuplicate: 0,
			relationsCreated: 0,
			errors: ['relation "A rel B": boom'],
		});

		const result = (await remember({
			facts: [{ entityName: 'A', entityType: 'concept', observation: 'x' }],
			relations: [{ fromEntity: 'A', relation: 'rel', toEntity: 'B' }],
		})) as { structuredContent?: Record<string, unknown> };

		expect(result.structuredContent).toMatchObject({ ok: false, partial: true });
		expect(RememberOutputSchema.safeParse(result.structuredContent).success).toBe(true);
	});

	it('returns a config error when the database is not configured', async () => {
		vi.mocked(isDatabaseConfigured).mockReturnValue(false);
		const result = (await remember({
			facts: [{ entityName: 'A', entityType: 'concept', observation: 'x' }],
		})) as { isError?: boolean; content: Array<{ text: string }> };
		expect(result.isError).toBe(true);
		expect(result.content[0].text).toContain('DATABASE_URL');
	});
});
