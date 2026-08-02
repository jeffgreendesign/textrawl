/**
 * Provider dispatch for `getEmbeddingDimensions()`.
 *
 * This is the value every schema's `vector(N)` column must agree with — a
 * mismatch between it and the applied SQL surfaces as an opaque insert error at
 * ingest time, long after setup. It had no coverage at all until the Google
 * provider shipped with a dimension its own schema could not index.
 *
 * The Google entry is deliberately pinned: gemini-embedding-2 emits 3072d
 * natively, and the server narrows it to 1536 via `outputDimensionality` so the
 * column stays under pgvector's 2000-dimension HNSW cap. If this value changes,
 * scripts/setup-db*-google.sql must change with it.
 */
import { beforeEach, describe, expect, it, vi } from 'vitest';

const mockConfig = vi.hoisted(() => ({
	EMBEDDING_PROVIDER: 'openai' as 'openai' | 'ollama' | 'google',
	OLLAMA_MODEL: 'nomic-embed-text',
	OLLAMA_BASE_URL: 'http://localhost:11434',
	GOOGLE_EMBEDDING_MODEL: 'gemini-embedding-2',
	EMBEDDING_BATCH_CONCURRENCY: 2,
}));

vi.mock('../../utils/config.js', () => ({ config: mockConfig }));

import { getEmbeddingDimensions } from '../embeddings.js';

beforeEach(() => {
	mockConfig.EMBEDDING_PROVIDER = 'openai';
	mockConfig.OLLAMA_MODEL = 'nomic-embed-text';
	mockConfig.GOOGLE_EMBEDDING_MODEL = 'gemini-embedding-2';
});

describe('getEmbeddingDimensions', () => {
	it('reports 1536 for OpenAI (text-embedding-3-small)', () => {
		mockConfig.EMBEDDING_PROVIDER = 'openai';
		expect(getEmbeddingDimensions()).toBe(1536);
	});

	it('reports 1536 for Google, matching the requested outputDimensionality', () => {
		mockConfig.EMBEDDING_PROVIDER = 'google';
		expect(getEmbeddingDimensions()).toBe(1536);
	});

	it('reports Google 1536 independently of the configured model name', () => {
		// The dimension is REQUESTED, not inferred from the model, so it must not
		// drift when someone points GOOGLE_EMBEDDING_MODEL at another Gemini model.
		mockConfig.EMBEDDING_PROVIDER = 'google';
		mockConfig.GOOGLE_EMBEDDING_MODEL = 'gemini-embedding-001';
		expect(getEmbeddingDimensions()).toBe(1536);
	});

	it.each([
		['nomic-embed-text', 1024],
		['nomic-embed-text:latest', 1024],
		['mxbai-embed-large', 1024],
		['nomic-embed-text-v2-moe', 768],
	])('reports %s -> %i for Ollama', (model, expected) => {
		mockConfig.EMBEDDING_PROVIDER = 'ollama';
		mockConfig.OLLAMA_MODEL = model;
		expect(getEmbeddingDimensions()).toBe(expected);
	});

	it('falls back to the Ollama default dimension for an unknown model', () => {
		mockConfig.EMBEDDING_PROVIDER = 'ollama';
		mockConfig.OLLAMA_MODEL = 'some-unlisted-model';
		expect(getEmbeddingDimensions()).toBe(1024);
	});

	it('stays within pgvector’s HNSW cap for every provider', () => {
		for (const provider of ['openai', 'google', 'ollama'] as const) {
			mockConfig.EMBEDDING_PROVIDER = provider;
			expect(getEmbeddingDimensions()).toBeLessThanOrEqual(2000);
		}
	});
});
