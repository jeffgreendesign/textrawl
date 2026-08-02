/**
 * The pgvector tuning barrier in pgQuery().
 *
 * Pool 'connect' handlers are synchronous: pg emits the event and hands the
 * client to the waiter without awaiting anything the handler started. The
 * previous code fired the hnsw.* SETs and dropped the promise, so the first
 * query on a fresh connection could execute before they landed — running at
 * pgvector's default ef_search=40 with non-iterative scans. Filtered vector
 * searches would then silently under-return, which is the exact failure
 * hnsw.iterative_scan exists to prevent.
 *
 * These tests pin the ordering guarantee and the degraded-but-working path.
 */
import { beforeEach, describe, expect, it, vi } from 'vitest';

/** Records the order of SET/SELECT calls across all clients. */
let callLog: string[] = [];
/** Resolvers for the pending tuning queries, so tests control when they land. */
let pendingTuning: Array<() => void> = [];

const mocks = vi.hoisted(() => ({
	connectHandlers: [] as Array<(client: unknown) => void>,
	released: 0,
	tuningShouldFail: false,
}));

vi.mock('@neondatabase/serverless', () => {
	class FakePool {
		on(event: string, handler: (client: unknown) => void) {
			if (event === 'connect') mocks.connectHandlers.push(handler);
		}
		async connect() {
			const client = {
				query: async (sql: string) => {
					callLog.push(sql);
					if (sql.startsWith('SET')) {
						if (mocks.tuningShouldFail) throw new Error('unrecognized parameter');
						// Deliberately a raw Promise, not an await: it must stay PENDING until
						// the test resolves it, which is how these tests control exactly when
						// the tuning lands relative to the query. The executor still runs
						// synchronously, so pendingTuning is populated before this returns.
						return new Promise((resolve) => {
							pendingTuning.push(() => resolve({ rows: [], rowCount: 0 }));
						});
					}
					if (sql === 'BOOM') throw new Error('query failed');
					return { rows: [{ ok: true }], rowCount: 1 };
				},
				release: () => {
					mocks.released += 1;
				},
			};
			for (const handler of mocks.connectHandlers) handler(client);
			return client;
		}
	}
	return { Pool: FakePool, neonConfig: {} };
});

const { getPgPool, pgQuery } = await import('../pg-client.js');

beforeEach(() => {
	callLog = [];
	pendingTuning = [];
	mocks.released = 0;
	mocks.tuningShouldFail = false;
	process.env.DATABASE_URL = 'postgres://example.invalid/db';
	// getPgPool memoizes the pool, so the 'connect' handler is registered exactly
	// once for the whole file — as in production. Deliberately not clearing
	// mocks.connectHandlers here: doing so would leave later tests with a cached
	// pool and no handler, and they would pass while asserting nothing.
	getPgPool();
});

describe('pgQuery tuning barrier', () => {
	it('does not run the query until the hnsw.* SETs have settled', async () => {
		const inFlight = pgQuery('SELECT 1');

		// Let any unawaited microtasks drain — if the barrier were missing, the
		// SELECT would already have been issued by now.
		await Promise.resolve();
		await Promise.resolve();

		expect(callLog.some((sql) => sql.startsWith('SELECT'))).toBe(false);
		expect(callLog.filter((sql) => sql.startsWith('SET'))).toHaveLength(2);

		for (const resolve of pendingTuning) resolve();
		await inFlight;

		expect(callLog.at(-1)).toBe('SELECT 1');
	});

	it('applies both iterative_scan and ef_search', async () => {
		const inFlight = pgQuery('SELECT 1');
		await Promise.resolve();
		for (const resolve of pendingTuning) resolve();
		await inFlight;

		expect(callLog).toEqual(
			expect.arrayContaining([
				"SET hnsw.iterative_scan = 'relaxed_order'",
				'SET hnsw.ef_search = 100',
			]),
		);
	});

	it('still serves the query when tuning fails, and releases the client', async () => {
		mocks.tuningShouldFail = true;

		await expect(pgQuery('SELECT 1')).resolves.toEqual({ rows: [{ ok: true }], rowCount: 1 });
		expect(mocks.released).toBe(1);
	});

	it('releases the client even when the query throws', async () => {
		const inFlight = pgQuery('BOOM');
		// Attach the rejection handler before draining, so the pending rejection is
		// never briefly unhandled.
		const settled = expect(inFlight).rejects.toThrow('query failed');
		await Promise.resolve();
		for (const resolve of pendingTuning) resolve();
		await settled;

		expect(mocks.released).toBe(1);
	});
});
