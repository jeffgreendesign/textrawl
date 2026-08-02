/**
 * Guard: every HNSW-indexed vector column must fit pgvector's dimension cap.
 *
 * pgvector caps the `vector` type at 2000 dimensions for HNSW indexes (halfvec
 * reaches 4000, bit 64000). A `CREATE INDEX ... USING hnsw` over a wider column
 * does not degrade gracefully — it errors, so `psql -f setup-db-<provider>.sql`
 * fails partway and that provider can never complete setup.
 *
 * This shipped broken for the Google variant: gemini-embedding-2's native 3072d
 * was declared across three schema files, each with an HNSW index that could not
 * build. Nothing caught it because no test reads these scripts and CI has no
 * database. This test is that missing check.
 *
 * Pure text contract — no database connection, so it runs in CI.
 */
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { globSync } from 'glob';
import { describe, expect, it } from 'vitest';

/** pgvector's HNSW ceiling for the `vector` type. */
const VECTOR_HNSW_MAX_DIMENSIONS = 2000;

const SCRIPTS_DIR = fileURLToPath(new URL('../../../scripts/', import.meta.url));

/** `embedding vector(1536)` / `summary_embedding VECTOR(768)` -> name => dimensions. */
function parseVectorColumns(sql: string): Map<string, number> {
	const columns = new Map<string, number>();
	for (const [, name, dims] of sql.matchAll(/(\w+)\s+vector\((\d+)\)/gi)) {
		columns.set(name, Number(dims));
	}
	return columns;
}

/** `using hnsw (embedding vector_cosine_ops)` -> ['embedding']. */
function parseHnswIndexedColumns(sql: string): string[] {
	return [...sql.matchAll(/using\s+hnsw\s*\(\s*(\w+)\s/gi)].map(([, name]) => name);
}

const schemaFiles = globSync('setup-db*.sql', { cwd: SCRIPTS_DIR }).sort();

describe('pgvector HNSW dimension limits', () => {
	it('finds the schema scripts', () => {
		// Guards against a silently-passing suite if the glob or layout changes.
		expect(schemaFiles.length).toBeGreaterThan(5);
	});

	it.each(schemaFiles)('%s indexes no vector column wider than the HNSW cap', (file) => {
		const sql = readFileSync(join(SCRIPTS_DIR, file), 'utf8');
		const columns = parseVectorColumns(sql);

		const tooWide = parseHnswIndexedColumns(sql)
			.map((name) => ({ name, dimensions: columns.get(name) }))
			.filter(
				(c): c is { name: string; dimensions: number } =>
					c.dimensions !== undefined && c.dimensions > VECTOR_HNSW_MAX_DIMENSIONS,
			);

		expect(
			tooWide,
			`${file} declares an HNSW index on a vector column above pgvector's ` +
				`${VECTOR_HNSW_MAX_DIMENSIONS}-dimension limit: ` +
				`${tooWide.map((c) => `${c.name} vector(${c.dimensions})`).join(', ')}. ` +
				'CREATE INDEX will fail and setup cannot complete. Request fewer dimensions ' +
				'from the provider, or index a halfvec cast (supported up to 4000).',
		).toEqual([]);
	});
});
