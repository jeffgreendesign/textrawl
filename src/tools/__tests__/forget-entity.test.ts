import { beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('../../utils/config.js', () => ({ config: { COMPACT_RESPONSES: false } }));
vi.mock('../../utils/logger.js', () => ({
	logger: { debug: vi.fn(), info: vi.fn(), warn: vi.fn(), error: vi.fn() },
}));
vi.mock('../../db/pg-client.js', () => ({ isDatabaseConfigured: vi.fn(() => true) }));
vi.mock('../../db/memory-entities.js', () => ({
	deleteEntity: vi.fn(async () => undefined),
	findEntityByName: vi.fn(),
	getOrCreateEntity: vi.fn(),
	listEntities: vi.fn(),
}));
vi.mock('../../db/memory-observations.js', () => ({
	createObservation: vi.fn(),
	findSimilarObservation: vi.fn(),
}));
vi.mock('../../db/memory-relations.js', () => ({
	RELATION_TYPES: {},
	getOrCreateRelation: vi.fn(),
}));
vi.mock('../../db/memory-search.js', () => ({
	getEntityContext: vi.fn(),
	hybridMemorySearch: vi.fn(),
	semanticMemorySearch: vi.fn(),
}));
vi.mock('../../services/embeddings.js', () => ({
	generateEmbedding: vi.fn(),
	isOpenAIConfigured: vi.fn(() => true),
}));
vi.mock('../../services/memory-extraction.js', () => ({
	extractAndStoreMemories: vi.fn(),
	extractMemoriesFromText: vi.fn(),
	isExtractionConfigured: vi.fn(() => false),
}));
vi.mock('../lib/confirm.js', () => ({ confirmDestructive: vi.fn() }));

import { deleteEntity, findEntityByName } from '../../db/memory-entities.js';
import { confirmDestructive } from '../lib/confirm.js';
import { registerMemoryTools } from '../memory.js';

type ToolHandler = (args: Record<string, unknown>, extra: unknown) => Promise<unknown>;

function getForgetHandler(): (args: Record<string, unknown>) => Promise<unknown> {
	const handlers = new Map<string, ToolHandler>();
	const fakeServer = {
		registerTool: (name: string, _o: unknown, cb: ToolHandler) => {
			handlers.set(name, cb);
		},
	};
	registerMemoryTools(fakeServer as never);
	const h = handlers.get('forget_entity');
	if (!h) throw new Error('forget_entity not registered');
	return (args) => h(args, {});
}

describe('forget_entity — dry-run + confirmation', () => {
	let forget: ReturnType<typeof getForgetHandler>;

	beforeEach(() => {
		vi.clearAllMocks();
		vi.mocked(findEntityByName).mockResolvedValue({
			id: 'ent-123',
			name: 'Ada',
			entity_type: 'person',
		} as never);
		forget = getForgetHandler();
	});

	it('previews without deleting when dryRun=true', async () => {
		const result = (await forget({ entityName: 'Ada', dryRun: true })) as {
			content: Array<{ text: string }>;
		};
		const parsed = JSON.parse(result.content[0].text);
		expect(parsed.dryRun).toBe(true);
		expect(parsed.wouldDelete.entityName).toBe('Ada');
		expect(deleteEntity).not.toHaveBeenCalled();
		expect(confirmDestructive).not.toHaveBeenCalled();
	});

	it('does not delete when confirmation is denied', async () => {
		vi.mocked(confirmDestructive).mockResolvedValue({ confirmed: false, via: 'declined' });
		const result = (await forget({ entityName: 'Ada', dryRun: false, confirm: false })) as {
			isError?: boolean;
			content: Array<{ text: string }>;
		};
		expect(result.isError).toBe(true);
		expect(result.content[0].text).toContain('not confirmed');
		expect(deleteEntity).not.toHaveBeenCalled();
	});

	it('deletes when confirmation is granted', async () => {
		vi.mocked(confirmDestructive).mockResolvedValue({ confirmed: true, via: 'param' });
		const result = (await forget({ entityName: 'Ada', dryRun: false, confirm: true })) as {
			content: Array<{ text: string }>;
		};
		expect(deleteEntity).toHaveBeenCalledWith('ent-123');
		const parsed = JSON.parse(result.content[0].text);
		expect(parsed.success).toBe(true);
	});

	it('returns a not-found error for an unknown entity', async () => {
		vi.mocked(findEntityByName).mockResolvedValue(null as never);
		const result = (await forget({ entityName: 'Nobody', dryRun: false, confirm: true })) as {
			isError?: boolean;
			content: Array<{ text: string }>;
		};
		expect(result.isError).toBe(true);
		expect(result.content[0].text).toContain('not found');
		expect(deleteEntity).not.toHaveBeenCalled();
	});
});
