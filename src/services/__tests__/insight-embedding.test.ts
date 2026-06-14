/**
 * Regression test for the insight-scan vector-encoding bug.
 *
 * fetchRecentChunks reads `c.embedding` back from Postgres, where the pg/Neon
 * driver returns a `vector` column as its TEXT form ("[0.1,0.2]"), not a parsed
 * array. The scan then re-passes that value to semantic_search($1::vector). If it
 * is left as a string, JSON.stringify double-encodes it (→ "\"[0.1,0.2]\"") and
 * Postgres rejects it ("invalid input syntax for type vector"), so every
 * semantic_search throws and the scan silently produces 0 insights.
 *
 * parseEmbedding must normalize the DB value to number[] so the downstream
 * JSON.stringify yields valid vector text.
 */
import { describe, expect, it } from 'vitest';
import { parseEmbedding } from '../insight-analysis.js';

describe('parseEmbedding', () => {
	it('parses a pgvector text value into a number array', () => {
		expect(parseEmbedding('[0.1,0.2,0.3]')).toEqual([0.1, 0.2, 0.3]);
	});

	it('passes a real array through unchanged', () => {
		expect(parseEmbedding([0.1, 0.2, 0.3])).toEqual([0.1, 0.2, 0.3]);
	});

	it('returns [] for null/empty/garbage', () => {
		expect(parseEmbedding(null)).toEqual([]);
		expect(parseEmbedding('')).toEqual([]);
		expect(parseEmbedding('not json')).toEqual([]);
	});

	it('round-trips to VALID vector text (the regression): no double-encoding', () => {
		// Simulate the DB value and the encoding done before semantic_search.
		const fromDb = '[0.1,0.2,0.3]';
		const encoded = JSON.stringify(parseEmbedding(fromDb));
		// Must NOT begin with a quote — a leading quote is exactly what Postgres
		// rejected as invalid vector syntax.
		expect(encoded.startsWith('"')).toBe(false);
		expect(encoded).toBe('[0.1,0.2,0.3]');
	});
});
