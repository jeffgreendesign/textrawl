import { DatabaseError, InvalidUploadStateError, NotFoundError } from '../utils/errors.js';
import { logger } from '../utils/logger.js';
import {
	isDatabaseConfigured,
	pgQuery,
	queryCount,
	queryOne,
	queryOneOrThrow,
} from './pg-client.js';

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

/** Upload-session state set — mirrors the CHECK in scripts/setup-db-uploads.sql (plan §5). */
export type UploadState =
	| 'initialized'
	| 'uploading'
	| 'uploaded'
	| 'queued'
	| 'processing'
	| 'completed'
	| 'partial'
	| 'failed'
	| 'expired'
	| 'cancelled';

/** Per-entry state set (plan §6). */
export type UploadEntryState = 'pending' | 'completed' | 'failed' | 'skipped';

/**
 * One upload session. Dates are normalized to ISO 8601 strings (never raw
 * Date) and `size_bytes` to a number (the driver returns bigint as a string),
 * per the AX rules in CLAUDE.md.
 */
export interface Upload {
	id: string;
	owner_token_hash: string | null;
	filename: string;
	title: string | null;
	declared_mimetype: string | null;
	normalized_type: string | null;
	size_bytes: number;
	checksum_algo: string | null;
	checksum_expected: string | null;
	checksum_computed: string | null;
	checksum_verified_at: string | null;
	gcs_crc32c: string | null;
	bucket: string;
	object_key: string;
	object_generation: string | null;
	object_etag: string | null;
	state: UploadState;
	error_code: string | null;
	error_message: string | null;
	entries_total: number;
	entries_processed: number;
	entries_failed: number;
	document_ids: string[];
	metadata: Record<string, unknown>;
	created_at: string;
	updated_at: string;
	expires_at: string | null;
	completed_at: string | null;
}

/** One per-entry result row (archives). */
export interface UploadEntry {
	id: string;
	upload_id: string;
	entry_path: string;
	normalized_type: string | null;
	size_bytes: number | null;
	state: UploadEntryState;
	document_id: string | null;
	error_code: string | null;
	error_message: string | null;
	created_at: string;
}

/** Aggregated per-entry counts for a status read. */
export interface UploadEntryCounts {
	total: number;
	completed: number;
	failed: number;
	pending: number;
	skipped: number;
}

/** Full status read: the upload row plus its per-entry rows and counts. */
export interface UploadStatus {
	upload: Upload;
	entries: UploadEntry[];
	counts: UploadEntryCounts;
}

export interface CreateUploadInput {
	ownerTokenHash?: string | null;
	filename: string;
	title?: string | null;
	declaredMimetype?: string | null;
	normalizedType?: string | null;
	sizeBytes: number;
	bucket: string;
	objectKey: string;
	checksumAlgo?: string | null;
	checksumExpected?: string | null;
	metadata?: Record<string, unknown>;
	expiresAt?: Date | string | null;
}

export interface ListUploadsOptions {
	limit?: number;
	offset?: number;
	state?: UploadState;
	ownerTokenHash?: string;
}

/** Optional fields recorded alongside a state transition. */
export interface TransitionOptions {
	errorCode?: string | null;
	errorMessage?: string | null;
}

// ---------------------------------------------------------------------------
// State machine (plan §5)
// ---------------------------------------------------------------------------

/**
 * Legal forward transitions. Terminal states (`completed`, `partial`,
 * `failed`, `expired`, `cancelled`) have no outgoing edges. See plan §5.
 */
export const LEGAL_UPLOAD_TRANSITIONS: Record<UploadState, readonly UploadState[]> = {
	initialized: ['uploading', 'uploaded', 'expired', 'cancelled'],
	uploading: ['uploaded', 'expired', 'cancelled'],
	uploaded: ['queued', 'expired', 'cancelled'],
	queued: ['processing', 'cancelled'],
	processing: ['completed', 'partial', 'failed'],
	completed: [],
	partial: [],
	failed: [],
	expired: [],
	cancelled: [],
};

/** States that mark a finished processing run (set `completed_at`). */
const PROCESSING_TERMINAL: readonly UploadState[] = ['completed', 'partial', 'failed'];

export function isLegalUploadTransition(from: UploadState, to: UploadState): boolean {
	return LEGAL_UPLOAD_TRANSITIONS[from]?.includes(to) ?? false;
}

// ---------------------------------------------------------------------------
// Row mapping (normalize Date → ISO string, bigint string → number)
// ---------------------------------------------------------------------------

function toIso(value: unknown): string | null {
	if (value == null) return null;
	if (value instanceof Date) return value.toISOString();
	return String(value);
}

function toNum(value: unknown): number {
	if (value == null) return 0;
	const n = Number(value);
	return Number.isNaN(n) ? 0 : n;
}

function mapUpload(row: Record<string, unknown>): Upload {
	return {
		id: row.id as string,
		owner_token_hash: (row.owner_token_hash as string | null) ?? null,
		filename: row.filename as string,
		title: (row.title as string | null) ?? null,
		declared_mimetype: (row.declared_mimetype as string | null) ?? null,
		normalized_type: (row.normalized_type as string | null) ?? null,
		size_bytes: toNum(row.size_bytes),
		checksum_algo: (row.checksum_algo as string | null) ?? null,
		checksum_expected: (row.checksum_expected as string | null) ?? null,
		checksum_computed: (row.checksum_computed as string | null) ?? null,
		checksum_verified_at: toIso(row.checksum_verified_at),
		gcs_crc32c: (row.gcs_crc32c as string | null) ?? null,
		bucket: row.bucket as string,
		object_key: row.object_key as string,
		object_generation: (row.object_generation as string | null) ?? null,
		object_etag: (row.object_etag as string | null) ?? null,
		state: row.state as UploadState,
		error_code: (row.error_code as string | null) ?? null,
		error_message: (row.error_message as string | null) ?? null,
		entries_total: toNum(row.entries_total),
		entries_processed: toNum(row.entries_processed),
		entries_failed: toNum(row.entries_failed),
		document_ids: (row.document_ids as string[] | null) ?? [],
		metadata: (row.metadata as Record<string, unknown> | null) ?? {},
		created_at: toIso(row.created_at) ?? '',
		updated_at: toIso(row.updated_at) ?? '',
		expires_at: toIso(row.expires_at),
		completed_at: toIso(row.completed_at),
	};
}

function mapEntry(row: Record<string, unknown>): UploadEntry {
	return {
		id: row.id as string,
		upload_id: row.upload_id as string,
		entry_path: row.entry_path as string,
		normalized_type: (row.normalized_type as string | null) ?? null,
		size_bytes: row.size_bytes == null ? null : toNum(row.size_bytes),
		state: row.state as UploadEntryState,
		document_id: (row.document_id as string | null) ?? null,
		error_code: (row.error_code as string | null) ?? null,
		error_message: (row.error_message as string | null) ?? null,
		created_at: toIso(row.created_at) ?? '',
	};
}

// ---------------------------------------------------------------------------
// CRUD
// ---------------------------------------------------------------------------

/**
 * Create a new upload session. `state` defaults to `initialized` in the schema.
 *
 * @throws {DatabaseError} If the database is not configured or the insert fails.
 */
export async function createUpload(input: CreateUploadInput): Promise<Upload> {
	if (!isDatabaseConfigured()) {
		throw new DatabaseError('Database not configured');
	}

	try {
		const row = await queryOneOrThrow<Record<string, unknown>>(
			`INSERT INTO uploads (
				owner_token_hash, filename, title, declared_mimetype, normalized_type,
				size_bytes, bucket, object_key, checksum_algo, checksum_expected,
				metadata, expires_at
			)
			VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12)
			RETURNING *`,
			[
				input.ownerTokenHash ?? null,
				input.filename,
				input.title ?? null,
				input.declaredMimetype ?? null,
				input.normalizedType ?? null,
				input.sizeBytes,
				input.bucket,
				input.objectKey,
				input.checksumAlgo ?? 'sha256',
				input.checksumExpected ?? null,
				JSON.stringify(input.metadata ?? {}),
				input.expiresAt ?? null,
			],
			'Upload',
		);

		const upload = mapUpload(row);
		logger.info('Created upload session', { id: upload.id, filename: upload.filename });
		return upload;
	} catch (error) {
		if (error instanceof NotFoundError) {
			throw new DatabaseError('Failed to create upload: no row returned');
		}
		const message = error instanceof Error ? error.message : String(error);
		logger.error('Failed to create upload', { error: message });
		throw new DatabaseError(`Failed to create upload: ${message}`);
	}
}

/**
 * Fetch an upload by id. Returns null when no row exists (never throws on a
 * missing id), per the AX rules.
 *
 * @throws {DatabaseError} If the database is not configured or the query fails.
 */
export async function getUpload(id: string): Promise<Upload | null> {
	if (!isDatabaseConfigured()) {
		throw new DatabaseError('Database not configured');
	}

	try {
		const row = await queryOne<Record<string, unknown>>('SELECT * FROM uploads WHERE id = $1', [
			id,
		]);
		return row ? mapUpload(row) : null;
	} catch (error) {
		const message = error instanceof Error ? error.message : String(error);
		logger.error('Failed to get upload', { error: message });
		throw new DatabaseError('Failed to get upload');
	}
}

/**
 * List uploads with optional state / owner filters and pagination.
 *
 * @throws {DatabaseError} If the database is not configured or the query fails.
 */
export async function listUploads(
	options: ListUploadsOptions = {},
): Promise<{ uploads: Upload[]; total: number }> {
	if (!isDatabaseConfigured()) {
		throw new DatabaseError('Database not configured');
	}

	const { limit = 20, offset = 0, state, ownerTokenHash } = options;

	const conditions: string[] = [];
	const params: unknown[] = [];
	let paramIndex = 1;

	if (state) {
		conditions.push(`state = $${paramIndex++}`);
		params.push(state);
	}

	if (ownerTokenHash) {
		conditions.push(`owner_token_hash = $${paramIndex++}`);
		params.push(ownerTokenHash);
	}

	const whereClause = conditions.length > 0 ? `WHERE ${conditions.join(' AND ')}` : '';

	try {
		const dataQuery = `SELECT * FROM uploads ${whereClause}
			ORDER BY created_at DESC, id DESC
			LIMIT $${paramIndex++} OFFSET $${paramIndex++}`;
		const dataParams = [...params, limit, offset];

		const countQuery = `SELECT count(*) FROM uploads ${whereClause}`;

		const [dataResult, total] = await Promise.all([
			pgQuery<Record<string, unknown>>(dataQuery, dataParams),
			queryCount(countQuery, params),
		]);

		return { uploads: dataResult.rows.map(mapUpload), total };
	} catch (error) {
		const message = error instanceof Error ? error.message : String(error);
		logger.error('Failed to list uploads', { error: message });
		throw new DatabaseError('Failed to list uploads');
	}
}

/**
 * Transition an upload to a new state, enforcing the §5 legal graph.
 *
 * - Returns null if no upload with `id` exists (missing id → null, not throw).
 * - Throws {@link InvalidUploadStateError} for an illegal transition (including
 *   any move out of a terminal state) or a concurrent compare-and-swap conflict.
 * - Sets `completed_at` when moving into a processing-terminal state
 *   (`completed`/`partial`/`failed`).
 *
 * @throws {DatabaseError} If the database is not configured or the update fails.
 * @throws {InvalidUploadStateError} If the transition is not permitted.
 */
export async function transitionUploadState(
	id: string,
	toState: UploadState,
	options: TransitionOptions = {},
): Promise<Upload | null> {
	if (!isDatabaseConfigured()) {
		throw new DatabaseError('Database not configured');
	}

	const current = await getUpload(id);
	if (!current) {
		return null;
	}

	if (!isLegalUploadTransition(current.state, toState)) {
		throw new InvalidUploadStateError(
			`Illegal upload state transition: ${current.state} → ${toState}`,
		);
	}

	const setClauses = ['state = $2', 'error_code = $3', 'error_message = $4'];
	const params: unknown[] = [id, toState, options.errorCode ?? null, options.errorMessage ?? null];

	if (PROCESSING_TERMINAL.includes(toState)) {
		setClauses.push('completed_at = now()');
	}

	// Compare-and-swap on the state we validated: gating the UPDATE on the
	// persisted state closes the read→write TOCTOU window. If the row moved (or
	// was deleted) since the read above, zero rows match and we surface a
	// conflict rather than clobbering the newer state.
	const stateParamIndex = params.length + 1;
	params.push(current.state);

	let result: { rows: Record<string, unknown>[]; rowCount: number | null };
	try {
		result = await pgQuery<Record<string, unknown>>(
			`UPDATE uploads SET ${setClauses.join(', ')}
			 WHERE id = $1 AND state = $${stateParamIndex} RETURNING *`,
			params,
		);
	} catch (error) {
		const message = error instanceof Error ? error.message : String(error);
		logger.error('Failed to transition upload state', { id, error: message });
		throw new DatabaseError('Failed to transition upload state');
	}

	if (!result.rowCount || result.rows.length === 0) {
		throw new InvalidUploadStateError(
			`Conflicting upload state transition: ${current.state} → ${toState} (state changed concurrently)`,
		);
	}

	logger.info('Transitioned upload state', { id, from: current.state, to: toState });
	return mapUpload(result.rows[0]);
}

/**
 * Read an upload plus its per-entry rows and aggregated counts. Returns null if
 * the upload does not exist. Counts default to zero for an upload with no
 * entries (single-file uploads), per the AX empty-aggregate rule.
 *
 * @throws {DatabaseError} If the database is not configured or a query fails.
 */
export async function getUploadStatus(id: string): Promise<UploadStatus | null> {
	if (!isDatabaseConfigured()) {
		throw new DatabaseError('Database not configured');
	}

	const upload = await getUpload(id);
	if (!upload) {
		return null;
	}

	try {
		const [entriesResult, countsRow] = await Promise.all([
			pgQuery<Record<string, unknown>>(
				'SELECT * FROM upload_entries WHERE upload_id = $1 ORDER BY entry_path ASC',
				[id],
			),
			queryOne<Record<string, unknown>>(
				`SELECT
					count(*)::int AS total,
					count(*) FILTER (WHERE state = 'completed')::int AS completed,
					count(*) FILTER (WHERE state = 'failed')::int AS failed,
					count(*) FILTER (WHERE state = 'pending')::int AS pending,
					count(*) FILTER (WHERE state = 'skipped')::int AS skipped
				FROM upload_entries WHERE upload_id = $1`,
				[id],
			),
		]);

		const counts: UploadEntryCounts = {
			total: toNum(countsRow?.total),
			completed: toNum(countsRow?.completed),
			failed: toNum(countsRow?.failed),
			pending: toNum(countsRow?.pending),
			skipped: toNum(countsRow?.skipped),
		};

		return { upload, entries: entriesResult.rows.map(mapEntry), counts };
	} catch (error) {
		const message = error instanceof Error ? error.message : String(error);
		logger.error('Failed to get upload status', { id, error: message });
		throw new DatabaseError('Failed to get upload status');
	}
}
