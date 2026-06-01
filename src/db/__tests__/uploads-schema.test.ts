/**
 * SQL-shape guard for scripts/setup-db-uploads.sql.
 *
 * Reads the schema script as text and asserts the structural invariants the
 * rest of Phase 2 relies on — table names, the §5 state CHECK sets, the
 * cascade / set-null foreign keys, and the retry-idempotency unique index.
 * No database connection: this is a pure text contract test so it runs in CI.
 * (A real-Postgres apply-in-throwaway-schema check is run manually and locally,
 * never here — Neon branch creation is at the free-tier limit.)
 */
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';

const sqlPath = fileURLToPath(new URL('../../../scripts/setup-db-uploads.sql', import.meta.url));
const sql = readFileSync(sqlPath, 'utf8');
// Normalize whitespace so multi-line statements match regardless of formatting.
const flat = sql.replace(/\s+/g, ' ').toLowerCase();

// §5 upload state set
const UPLOAD_STATES = [
	'initialized',
	'uploading',
	'uploaded',
	'queued',
	'processing',
	'completed',
	'partial',
	'failed',
	'expired',
	'cancelled',
];

// §6 per-entry state set
const ENTRY_STATES = ['pending', 'completed', 'failed', 'skipped'];

describe('setup-db-uploads.sql shape', () => {
	it('creates both tables idempotently', () => {
		expect(flat).toContain('create table if not exists uploads');
		expect(flat).toContain('create table if not exists upload_entries');
	});

	it('declares the §5 upload state CHECK set', () => {
		// Scope to the uploads CHECK clause (keyed off its distinct default) so a
		// literal that only appears in the per-entry clause can't satisfy this.
		const uploadCheck = flat.match(/default 'initialized' check \(state in \(([^)]*)\)/)?.[1] ?? '';
		expect(uploadCheck).not.toBe('');
		for (const state of UPLOAD_STATES) {
			expect(uploadCheck).toContain(`'${state}'`);
		}
	});

	it('declares the §6 per-entry state CHECK set', () => {
		const entryCheck = flat.match(/default 'pending' check \(state in \(([^)]*)\)/)?.[1] ?? '';
		expect(entryCheck).not.toBe('');
		for (const state of ENTRY_STATES) {
			expect(entryCheck).toContain(`'${state}'`);
		}
	});

	it('cascades entries when the parent upload is deleted', () => {
		expect(flat).toMatch(/references uploads\(id\) on delete cascade/);
	});

	it('nulls the document link when a referenced document is deleted', () => {
		expect(flat).toMatch(/references documents\(id\) on delete set null/);
	});

	it('records an interim owner_token_hash binding on uploads', () => {
		expect(flat).toContain('owner_token_hash text');
	});

	it('has the retry-idempotency unique index on (upload_id, entry_path)', () => {
		expect(flat).toMatch(
			/create unique index if not exists \w+ on upload_entries\(upload_id, entry_path\)/,
		);
	});

	it('indexes upload_entries by upload_id and by state', () => {
		expect(flat).toMatch(/create index if not exists \w+ on upload_entries\(upload_id\)/);
		expect(flat).toMatch(/create index if not exists \w+ on upload_entries\(state\)/);
	});

	it('captures GCS object metadata and checksum columns', () => {
		expect(flat).toContain('object_key text not null');
		expect(flat).toContain('bucket text not null');
		expect(flat).toContain('gcs_crc32c text');
		expect(flat).toContain('object_generation text');
		expect(flat).toContain('checksum_expected text');
		expect(flat).toContain('expires_at timestamptz');
	});
});
