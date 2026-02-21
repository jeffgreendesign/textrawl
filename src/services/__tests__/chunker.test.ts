import { describe, expect, it, vi } from 'vitest';

// Mock dependencies to isolate chunker logic
vi.mock('../../utils/config.js', () => ({
	config: { CHUNKING_MODE: 'fixed', SEMANTIC_SIMILARITY_THRESHOLD: 0.5 },
}));

vi.mock('../../utils/logger.js', () => ({
	logger: { debug: vi.fn(), info: vi.fn(), warn: vi.fn(), error: vi.fn() },
}));

import { chunkText } from '../chunker.js';

describe('chunkText (fixed chunking)', () => {
	it('returns empty array for empty input', () => {
		expect(chunkText('')).toEqual([]);
		expect(chunkText('   ')).toEqual([]);
	});

	it('returns single chunk for short text', () => {
		const text = 'Hello world. This is a short text.';
		const chunks = chunkText(text);
		expect(chunks).toHaveLength(1);
		expect(chunks[0].content).toBe(text);
		expect(chunks[0].index).toBe(0);
		expect(chunks[0].startOffset).toBe(0);
	});

	it('splits on paragraph boundaries', () => {
		// Create text that exceeds one chunk
		const paragraph = 'A'.repeat(1000);
		const text = `${paragraph}\n\n${paragraph}\n\n${paragraph}`;
		const chunks = chunkText(text, { maxChunkSize: 300 }); // ~1200 chars
		expect(chunks.length).toBeGreaterThan(1);
	});

	it('preserves all content across chunks', () => {
		const paragraphs = Array.from({ length: 10 }, (_, i) => `Paragraph ${i}. ${'x'.repeat(300)}`);
		const text = paragraphs.join('\n\n');
		const chunks = chunkText(text, { maxChunkSize: 200 });

		// Every paragraph's start should appear in some chunk
		for (const p of paragraphs) {
			const prefix = p.slice(0, 15);
			const found = chunks.some((c) => c.content.includes(prefix));
			expect(found).toBe(true);
		}
	});

	it('respects maxChunkSize parameter', () => {
		const text = Array.from({ length: 20 }, () => 'word '.repeat(100)).join('\n\n');
		const maxChunkSize = 100; // ~400 chars
		const chunks = chunkText(text, { maxChunkSize });
		for (const chunk of chunks) {
			// Allow some overflow since we split on paragraph boundaries
			expect(chunk.content.length).toBeLessThan(maxChunkSize * 4 * 2);
		}
	});

	it('normalizes CRLF to LF', () => {
		const text = 'Line one.\r\nLine two.\r\n\r\nParagraph two.';
		const chunks = chunkText(text);
		expect(chunks[0].content).not.toContain('\r');
	});

	it('sets correct chunk indices', () => {
		const text = Array.from({ length: 10 }, (_, i) => `Paragraph ${i}. ${'y'.repeat(500)}`).join(
			'\n\n',
		);
		const chunks = chunkText(text, { maxChunkSize: 200 });
		for (let i = 0; i < chunks.length; i++) {
			expect(chunks[i].index).toBe(i);
		}
	});

	it('includes overlap between chunks', () => {
		const paragraphs = Array.from({ length: 8 }, (_, i) => `Section ${i}: ${'z'.repeat(400)}`);
		const text = paragraphs.join('\n\n');
		const chunks = chunkText(text, { maxChunkSize: 200, overlap: 50 });

		// With overlap, adjacent chunks should share some content
		if (chunks.length >= 2) {
			const lastPartOfFirst = chunks[0].content.slice(-50);
			const firstPartOfSecond = chunks[1].content.slice(0, 200);
			// Overlap means the end of chunk N appears at the start of chunk N+1
			expect(firstPartOfSecond).toContain(lastPartOfFirst.slice(-20));
		}
	});

	it('estimates token count', () => {
		const text = 'Hello world';
		const chunks = chunkText(text);
		expect(chunks[0].tokenCount).toBeGreaterThan(0);
		// ~11 chars / 4 = ~3 tokens (rounded up)
		expect(chunks[0].tokenCount).toBe(Math.ceil(text.length / 4));
	});
});
