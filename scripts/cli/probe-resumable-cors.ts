#!/usr/bin/env npx tsx
/**
 * Resumable-upload CORS + resume probe (T-E2E.2).
 *
 * The single hardest-to-spot failure in the browser → GCS resumable flow is a
 * bucket CORS config that does NOT expose the `Range` response header
 * cross-origin. Server-side tools (curl/node) ignore CORS, so a plain PUT will
 * happily read `Range` and look fine — yet a real browser, bound by CORS, gets
 * `null` for `Range` and the chunked-resume logic in `dashboard/lib/api.ts`
 * (`parseCommittedOffset`) silently breaks. This probe reproduces what a browser
 * is *allowed* to read by sending requests with an `Origin` header and asserting
 * the CORS response headers GCS returns.
 *
 * It does NOT enforce CORS itself (only a browser does). Instead it inspects the
 * `Access-Control-*` headers GCS echoes back when an `Origin` is present — which
 * is exactly what determines what a browser can see.
 *
 * What it asserts (any failure → loud message + non-zero exit):
 *   1. OPTIONS preflight: 200, `Access-Control-Allow-Methods` ⊇ PUT,
 *      `Access-Control-Allow-Headers` ⊇ content-range.
 *   2. Chunked PUT (one 256 KiB-aligned chunk): `308 Resume Incomplete`,
 *      `Range` response header present, AND `Access-Control-Expose-Headers`
 *      ⊇ Range  ← THE GATE.
 *   3. Status probe (`Content-Range: bytes *​/<total>`): reports the committed
 *      offset, matching the bytes just written.
 *
 * Usage:
 *   # Against a resumable session URI you already have (e.g. from POST /api/upload/init).
 *   # Use a THROWAWAY/test session — the probe writes 256 KiB and leaves it unfinalized.
 *   pnpm probe:cors -- --uri "https://storage.googleapis.com/upload/storage/v1/b/.../o?...upload_id=..." \
 *     --origin https://dashboard.example.com
 *
 *   # Or self-initiate a throwaway session against a bucket (no server needed).
 *   # Token defaults to `gcloud auth print-access-token`; the identity needs
 *   # storage.objects.create on the bucket.
 *   pnpm probe:cors -- --bucket textrawl-uploads --origin https://dashboard.example.com
 *
 * Exit codes: 0 = all gates pass · 1 = a gate failed · 2 = usage/setup error.
 */

import { execFileSync } from 'node:child_process';
import { Command } from 'commander';
import { logger } from './lib/progress.js';

/** GCS requires every non-final resumable chunk to be a 256 KiB multiple. */
const CHUNK_BYTES = 256 * 1024;

interface ProbeOptions {
	uri?: string;
	bucket?: string;
	object?: string;
	origin: string;
	token?: string;
	total?: string;
}

/** Track gate results so the run reports every failure, not just the first. */
const failures: string[] = [];

function pass(label: string, detail = ''): void {
	logger.info(`✓ ${label}${detail ? ` — ${detail}` : ''}`);
}

function fail(label: string, detail: string): void {
	failures.push(`${label}: ${detail}`);
	logger.error(`✗ ${label} — ${detail}`);
}

/** Case-insensitive membership test for a comma-separated CORS header value (`*` matches anything). */
function headerListIncludes(value: string | null, needle: string): boolean {
	if (!value) return false;
	if (value.trim() === '*') return true;
	return value
		.split(',')
		.map((s) => s.trim().toLowerCase())
		.includes(needle.toLowerCase());
}

/** Resolve a GCS access token: explicit `--token`, else `gcloud auth print-access-token`. */
function resolveToken(explicit?: string): string {
	if (explicit) return explicit;
	try {
		return execFileSync('gcloud', ['auth', 'print-access-token'], { encoding: 'utf8' }).trim();
	} catch {
		logger.error(
			'Could not obtain a GCS access token. Pass --token or authenticate gcloud (gcloud auth login).',
		);
		process.exit(2);
	}
}

/**
 * Start a throwaway resumable session via the JSON API and return its session URI
 * (the `Location` header). Used by `--bucket` mode so the probe is fully
 * standalone and never touches a real in-flight upload.
 */
async function initThrowawaySession(opts: ProbeOptions): Promise<string> {
	const bucket = opts.bucket as string;
	const objectName =
		opts.object ?? `e2e-cors-probe/${Date.now()}-${Math.random().toString(36).slice(2)}.bin`;
	const token = resolveToken(opts.token);
	const url = `https://storage.googleapis.com/upload/storage/v1/b/${encodeURIComponent(
		bucket,
	)}/o?uploadType=resumable&name=${encodeURIComponent(objectName)}`;

	const res = await fetch(url, {
		method: 'POST',
		headers: {
			Authorization: `Bearer ${token}`,
			'Content-Type': 'application/json; charset=UTF-8',
			'X-Upload-Content-Type': 'application/octet-stream',
		},
		body: JSON.stringify({}),
	});
	const session = res.headers.get('Location');
	if (!res.ok || !session) {
		const body = await res.text().catch(() => '');
		logger.error(`Failed to initiate resumable session (HTTP ${res.status}). ${body}`);
		process.exit(2);
	}
	logger.info(`Initiated throwaway session for gs://${bucket}/${objectName}`);
	return session;
}

/** GCS replies `Range: bytes=0-<last>`; the next byte to send is last + 1. */
function parseCommittedOffset(range: string | null): number {
	if (!range) return 0;
	const m = /bytes=0-(\d+)/.exec(range);
	return m ? Number(m[1]) + 1 : 0;
}

/** (1) CORS preflight: assert PUT + Content-Range are allowed cross-origin. */
async function probePreflight(uri: string, origin: string): Promise<void> {
	const res = await fetch(uri, {
		method: 'OPTIONS',
		headers: {
			Origin: origin,
			'Access-Control-Request-Method': 'PUT',
			'Access-Control-Request-Headers': 'content-range',
		},
	});
	const allowOrigin = res.headers.get('Access-Control-Allow-Origin');
	const allowMethods = res.headers.get('Access-Control-Allow-Methods');
	const allowHeaders = res.headers.get('Access-Control-Allow-Headers');

	if (res.status !== 200 && res.status !== 204) {
		fail('preflight status', `expected 200/204, got ${res.status} (is CORS configured at all?)`);
	} else {
		pass('preflight status', String(res.status));
	}
	if (allowOrigin && (allowOrigin === '*' || allowOrigin === origin)) {
		pass('preflight Access-Control-Allow-Origin', allowOrigin);
	} else {
		fail(
			'preflight Access-Control-Allow-Origin',
			`origin ${origin} not allowed (got ${allowOrigin ?? 'none'})`,
		);
	}
	if (headerListIncludes(allowMethods, 'PUT')) pass('preflight allows PUT', allowMethods ?? '');
	else
		fail(
			'preflight Access-Control-Allow-Methods',
			`PUT not allowed (got ${allowMethods ?? 'none'})`,
		);

	if (headerListIncludes(allowHeaders, 'content-range')) {
		pass('preflight allows Content-Range request header', allowHeaders ?? '');
	} else {
		fail(
			'preflight Access-Control-Allow-Headers',
			`content-range not allowed (got ${allowHeaders ?? 'none'})`,
		);
	}
}

/**
 * (2) THE GATE: write one 256 KiB non-final chunk and assert the browser would
 * be able to read `Range` — i.e. `Access-Control-Expose-Headers` ⊇ Range.
 * Returns the committed offset for the status-probe cross-check.
 */
async function probeChunkedPut(uri: string, origin: string, total?: number): Promise<number> {
	const end = CHUNK_BYTES - 1;
	const rangeTotal = total !== undefined ? String(total) : '*';
	const res = await fetch(uri, {
		method: 'PUT',
		headers: {
			Origin: origin,
			'Content-Range': `bytes 0-${end}/${rangeTotal}`,
		},
		body: new Uint8Array(CHUNK_BYTES),
	});

	if (res.status === 308) pass('chunked PUT returns 308 Resume Incomplete');
	else fail('chunked PUT status', `expected 308, got ${res.status}`);

	const range = res.headers.get('Range');
	if (range) pass('Range response header present', range);
	else fail('Range response header', 'absent on the 308 response');

	const expose = res.headers.get('Access-Control-Expose-Headers');
	if (headerListIncludes(expose, 'Range')) {
		pass('Access-Control-Expose-Headers exposes Range', expose ?? '');
	} else {
		fail(
			'Access-Control-Expose-Headers (THE GATE)',
			`Range is NOT exposed cross-origin (got ${expose ?? 'none'}). A browser cannot read Range → chunked resume silently breaks. Add "Range" to responseHeader in infra/gcs/cors.json and re-apply.`,
		);
	}
	return parseCommittedOffset(range);
}

/** (3) Status probe: `bytes *​/<total>` must report the committed offset. */
async function probeStatus(
	uri: string,
	origin: string,
	expectedOffset: number,
	total?: number,
): Promise<void> {
	const rangeTotal = total !== undefined ? String(total) : '*';
	const res = await fetch(uri, {
		method: 'PUT',
		headers: { Origin: origin, 'Content-Range': `bytes */${rangeTotal}` },
	});
	// 308 = still incomplete (expected, since we never sent the final chunk).
	if (res.status !== 308) {
		fail('status probe', `expected 308 from a "bytes *​/*" query, got ${res.status}`);
		return;
	}
	const committed = parseCommittedOffset(res.headers.get('Range'));
	if (committed === expectedOffset) {
		pass('status probe reports committed offset', `${committed} bytes`);
	} else {
		fail('status probe offset', `expected ${expectedOffset}, reported ${committed}`);
	}
}

async function main(): Promise<void> {
	const program = new Command('probe-resumable-cors')
		.description(
			'Probe a GCS resumable session for cross-origin CORS + Range-exposure correctness.',
		)
		.option('--uri <resumableSessionUri>', 'An existing (throwaway) resumable session URI')
		.option('--bucket <name>', 'Self-initiate a throwaway session against this bucket')
		.option('--object <key>', 'Object key for --bucket mode (default: e2e-cors-probe/<random>.bin)')
		.option('--origin <origin>', 'Browser origin to simulate', 'https://dashboard.example.com')
		.option('--token <accessToken>', 'GCS OAuth token (default: gcloud auth print-access-token)')
		.option('--total <bytes>', 'Known total size; omit to send "*" (unknown total)');

	// `pnpm probe:cors -- …` forwards a lone `--`; strip it so the rest parses as
	// options (mirrors scripts/cli/scan.ts).
	const argv = process.argv.filter((arg, i) => !(i === 2 && arg === '--'));
	program.parse(argv);

	const opts = program.opts<ProbeOptions>();
	if (!opts.uri && !opts.bucket) {
		logger.error('Provide either --uri <resumableSessionUri> or --bucket <name>. See --help.');
		process.exit(2);
	}

	const uri = opts.uri ?? (await initThrowawaySession(opts));
	const total = opts.total !== undefined ? Number(opts.total) : undefined;

	logger.info(`Probing as Origin: ${opts.origin}`);
	await probePreflight(uri, opts.origin);
	const committed = await probeChunkedPut(uri, opts.origin, total);
	await probeStatus(uri, opts.origin, committed, total);

	if (failures.length > 0) {
		logger.error(`\nFAILED — ${failures.length} gate(s) did not pass:`);
		for (const f of failures) logger.error(`  • ${f}`);
		logger.error(
			'\nResumable chunked upload/resume will NOT work cross-origin until these are fixed.',
		);
		process.exit(1);
	}
	logger.info('\nAll CORS + resume gates passed. Browser chunked resume is viable.');
}

main().catch((err) => {
	logger.error(`Probe crashed: ${err instanceof Error ? err.message : String(err)}`);
	process.exit(2);
});
