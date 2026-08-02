/**
 * SQL-shape guard for the scripts/setup-db-claims*.sql provider variants.
 *
 * Reads each schema script as text and asserts the structural invariants the
 * future claim-packet writer relies on — the claims table, the status/state/
 * sensitivity CHECK sets, the chunk-anchored NOT NULL provenance FKs, the
 * offset/confidence/self-supersession constraints, the generated FTS column and
 * its GIN indexes, RLS, and the per-provider embedding dimension. The four
 * variants must be identical except for that dimension, so the bulk of the
 * assertions run against every file and a dimension map keeps them in sync.
 *
 * No database connection: this is a pure text contract test so it runs in CI.
 * (A real-Postgres apply-in-throwaway-schema check is run manually and locally,
 * never here — Neon branch creation is at the free-tier limit.)
 */
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';

// Provider variant -> expected embedding dimension.
const VARIANTS: Record<string, number> = {
	'setup-db-claims.sql': 1536,
	'setup-db-claims-google.sql': 1536,
	'setup-db-claims-ollama.sql': 1024,
	'setup-db-claims-ollama-v2.sql': 768,
};

const STATUS_VALUES = ['unreviewed', 'approved', 'rejected'];
const STATE_VALUES = ['current', 'stale', 'conflicting', 'superseded'];
const SENSITIVITY_VALUES = ['normal', 'sensitive', 'restricted'];

function loadFlat(file: string): string {
	const sqlPath = fileURLToPath(new URL(`../../../scripts/${file}`, import.meta.url));
	// Normalize whitespace so multi-line statements match regardless of formatting.
	return readFileSync(sqlPath, 'utf8').replace(/\s+/g, ' ').toLowerCase();
}

describe('setup-db-claims*.sql shape', () => {
	for (const [file, dimension] of Object.entries(VARIANTS)) {
		describe(file, () => {
			const flat = loadFlat(file);

			it('creates the claims table idempotently', () => {
				expect(flat).toContain('create table if not exists claims');
			});

			it('declares the status CHECK set', () => {
				const set = flat.match(/default 'unreviewed' check \(status in \(([^)]*)\)/)?.[1] ?? '';
				expect(set).not.toBe('');
				for (const v of STATUS_VALUES) expect(set).toContain(`'${v}'`);
			});

			it('declares the state CHECK set', () => {
				const set = flat.match(/default 'current' check \(state in \(([^)]*)\)/)?.[1] ?? '';
				expect(set).not.toBe('');
				for (const v of STATE_VALUES) expect(set).toContain(`'${v}'`);
			});

			it('declares the sensitivity CHECK set', () => {
				const set = flat.match(/default 'normal' check \(sensitivity in \(([^)]*)\)/)?.[1] ?? '';
				expect(set).not.toBe('');
				for (const v of SENSITIVITY_VALUES) expect(set).toContain(`'${v}'`);
			});

			it('creates the composite-unique FK target on chunks(document_id, id)', () => {
				expect(flat).toMatch(/create unique index if not exists \w+ on chunks\(document_id, id\)/);
			});

			it('anchors every claim to a chunk via a NOT NULL composite FK to its document', () => {
				// chunk_id is NOT NULL but carries no standalone FK — the pair is enforced below.
				expect(flat).toMatch(/chunk_id\s+uuid not null/);
				expect(flat).toMatch(
					/foreign key \(document_id, chunk_id\) references chunks\(document_id, id\) on delete cascade/,
				);
			});

			it('links to a document via a NOT NULL cascading FK', () => {
				expect(flat).toMatch(
					/document_id\s+uuid not null references documents\(id\) on delete cascade/,
				);
			});

			it('uses a self-referential set-null FK for supersession', () => {
				expect(flat).toMatch(/references claims\(id\) on delete set null/);
			});

			it('constrains offsets, confidence, and self-supersession', () => {
				expect(flat).toContain('source_end_offset > source_start_offset');
				expect(flat).toContain('source_start_offset >= 0');
				expect(flat).toMatch(/confidence is null or \(confidence >= 0 and confidence <= 1\)/);
				expect(flat).toMatch(/superseded_by is null or superseded_by <> id/);
			});

			it('documents that offsets index chunks.content', () => {
				expect(flat).toContain('utf-16 index into chunks.content');
			});

			it('generates the weighted FTS column and indexes it', () => {
				expect(flat).toMatch(/fts tsvector generated always as/);
				expect(flat).toMatch(
					/create index if not exists claims_fts_idx on claims using gin\(fts\)/,
				);
			});

			it('GIN-indexes tags and entities', () => {
				expect(flat).toMatch(/create index if not exists \w+ on claims using gin\(tags\)/);
				expect(flat).toMatch(
					/create index if not exists \w+ on claims using gin\(entities jsonb_path_ops\)/,
				);
			});

			it('indexes claims by document, chunk, status, and state', () => {
				expect(flat).toMatch(/create index if not exists \w+ on claims\(document_id\)/);
				expect(flat).toMatch(/create index if not exists \w+ on claims\(chunk_id\)/);
				expect(flat).toMatch(/create index if not exists \w+ on claims\(status, created_at desc\)/);
				expect(flat).toMatch(/create index if not exists \w+ on claims\(state, created_at desc\)/);
			});

			it('does NOT create a vector index in this PR (deferred to retrieval)', () => {
				expect(flat).not.toMatch(/create index[^;]*using hnsw/);
				expect(flat).not.toMatch(/create index[^;]*using ivfflat/);
			});

			it('keeps a nullable embedding column at the provider dimension', () => {
				expect(flat).toContain(`embedding vector(${dimension})`);
				// Nullable: no NOT NULL on the embedding column.
				expect(flat).not.toMatch(new RegExp(`embedding vector\\(${dimension}\\) not null`));
			});

			it('enables RLS and denies anon/authenticated (idempotently)', () => {
				expect(flat).toContain('alter table claims enable row level security');
				expect(flat).toContain('drop policy if exists claims_deny_anon on claims');
				expect(flat).toMatch(
					/create policy \w+ on claims for all to anon, authenticated using \(false\)/,
				);
				expect(flat).toContain('revoke all on claims from anon, authenticated');
			});

			it('reuses the shared updated_at trigger function', () => {
				expect(flat).toMatch(/create trigger claims_updated_at before update on claims/);
				expect(flat).toContain('execute function update_updated_at()');
			});
		});
	}

	it('variants are dimension-only diffs (each declares exactly one embedding vector size)', () => {
		for (const [file, dimension] of Object.entries(VARIANTS)) {
			const flat = loadFlat(file);
			expect(flat).toContain(`embedding vector(${dimension})`);
			for (const other of Object.values(VARIANTS)) {
				if (other === dimension) continue;
				expect(flat).not.toContain(`embedding vector(${other})`);
			}
		}
	});
});
