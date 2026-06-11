/**
 * Textrawl REST API client for the dashboard.
 * All calls go to the Textrawl server's REST API (Enhancement 9).
 */

const ENV_API_BASE = process.env.NEXT_PUBLIC_API_URL ?? 'http://localhost:3000/api';

/** Resolve API base URL: localStorage override → env var → localhost default. */
export function getApiBase(): string {
	if (typeof window !== 'undefined') {
		const override = localStorage.getItem('textrawl_server');
		if (override) {
			const trimmed = override.replace(/\/+$/, '').replace(/\/api$/, '');
			return `${trimmed}/api`;
		}
	}
	return ENV_API_BASE;
}

function getHeaders(): HeadersInit {
	const token = typeof window !== 'undefined' ? localStorage.getItem('textrawl_token') : null;
	return {
		'Content-Type': 'application/json',
		...(token ? { Authorization: `Bearer ${token}` } : {}),
	};
}

async function apiFetch<T>(path: string, init?: RequestInit): Promise<T> {
	const res = await fetch(`${getApiBase()}${path}`, {
		...init,
		headers: { ...getHeaders(), ...init?.headers },
	});
	if (!res.ok) {
		const body = await res.text().catch(() => '');
		throw new Error(`API ${res.status}: ${body}`);
	}
	return res.json() as Promise<T>;
}

// --- Server base (for non-API routes like /health, /status) ---

/** Server origin without /api suffix. Used for health checks and status. */
export function getServerBase(): string {
	return getApiBase().replace(/\/api$/, '');
}

/**
 * WebSocket URL. Prefers an explicit `NEXT_PUBLIC_WS_URL`, otherwise derives it
 * from the resolved server origin (`http(s)` → `ws(s)`, `/ws` path) so production
 * never falls back to `ws://localhost:3000` when only the API URL is configured.
 */
export function getWsBase(): string {
	if (process.env.NEXT_PUBLIC_WS_URL) {
		return process.env.NEXT_PUBLIC_WS_URL;
	}
	// Normalize a trailing `/api` or `/api/` (and any stray trailing slash) so the
	// derived path is exactly `/ws` — the server's upgrade handler rejects anything else.
	const base = getServerBase()
		.replace(/\/api\/?$/, '')
		.replace(/\/+$/, '');
	return `${base.replace(/^http/, 'ws')}/ws`;
}

// --- Health ---

export interface HealthResult {
	ok: boolean;
	latencyMs: number;
}

export async function checkHealth(): Promise<HealthResult> {
	const start = performance.now();
	try {
		const res = await fetch(`${getServerBase()}/health/live`, {
			signal: AbortSignal.timeout(5000),
		});
		return { ok: res.ok, latencyMs: Math.round(performance.now() - start) };
	} catch {
		return { ok: false, latencyMs: Math.round(performance.now() - start) };
	}
}

// --- Status ---

export interface ServiceCheck {
	name: string;
	status: string;
	message?: string;
	latencyMs?: number;
}

export interface ToolStatus {
	name: string;
	group: string;
	status: string;
	message?: string;
}

export interface StatusResponse {
	overall: 'operational' | 'degraded' | 'down';
	version: string;
	uptime: number;
	timestamp: string;
	services: ServiceCheck[];
	features: Record<string, boolean>;
	tools: ToolStatus[];
	embedding: { provider: string; model: string; configured: boolean };
}

export async function fetchStatus(): Promise<StatusResponse> {
	const res = await fetch(`${getServerBase()}/status`, {
		signal: AbortSignal.timeout(15000),
	});
	if (!res.ok) throw new Error(`Status ${res.status}`);
	return res.json() as Promise<StatusResponse>;
}

// --- Search ---
export interface SearchResult {
	documentId: string;
	documentTitle: string;
	content: string;
	sourceType: string;
	score: number;
}

export async function search(
	query: string,
	limit = 10,
): Promise<{ query: string; totalResults: number; results: SearchResult[] }> {
	return apiFetch(`/search?q=${encodeURIComponent(query)}&limit=${limit}`);
}

// --- Documents ---
export interface Document {
	id: string;
	title: string;
	source_type: string;
	source_url: string | null;
	raw_content: string;
	metadata: Record<string, unknown>;
	created_at: string;
	updated_at: string;
}

export async function listDocuments(
	limit = 20,
	offset = 0,
): Promise<{ documents: Document[]; total: number }> {
	return apiFetch(`/documents?limit=${limit}&offset=${offset}`);
}

export async function getDocument(id: string): Promise<Document> {
	return apiFetch(`/documents/${id}`);
}

// --- Stats ---
export interface MemoryStatsBreakdown {
	entities: number;
	observations: number;
	relations: number;
	entityTypeCounts: Record<string, number>;
}

export interface ConversationStatsBreakdown {
	sessions: number;
	turns: number;
}

export interface InsightStatsBreakdown {
	total: number;
	new: number;
	seen: number;
	dismissed: number;
	byType: Record<string, number>;
}

export interface Stats {
	documents: number;
	memories?: MemoryStatsBreakdown | null;
	conversations?: ConversationStatsBreakdown | null;
	insights?: InsightStatsBreakdown | null;
}

export async function fetchStats(): Promise<Stats> {
	return apiFetch('/stats');
}

// --- Upload ---
export async function uploadFile(
	file: File,
	options?: { title?: string; tags?: string[] },
): Promise<{ success: boolean; documentId: string }> {
	const formData = new FormData();
	formData.append('file', file);
	if (options?.title) formData.append('title', options.title);
	if (options?.tags) {
		for (const tag of options.tags) formData.append('tags', tag);
	}

	const token = typeof window !== 'undefined' ? localStorage.getItem('textrawl_token') : null;

	const res = await fetch(`${getApiBase()}/upload`, {
		method: 'POST',
		headers: token ? { Authorization: `Bearer ${token}` } : {},
		body: formData,
	});

	if (!res.ok) throw new Error(`Upload failed: ${res.status}`);
	return res.json();
}

// --- Large / resumable upload (GCS resumable session) ---

/**
 * Client switch point: files at or below this size keep the direct single-shot
 * POST; larger files use the resumable init → PUT → complete → poll flow.
 * Mirrors the server's `MAX_SINGLE_FILE_SIZE_MB` default (20).
 */
const PARSED_UPLOAD_THRESHOLD_MB = Number(process.env.NEXT_PUBLIC_UPLOAD_THRESHOLD_MB);
export const UPLOAD_THRESHOLD_MB = Number.isFinite(PARSED_UPLOAD_THRESHOLD_MB)
	? PARSED_UPLOAD_THRESHOLD_MB
	: 20;

/** GCS requires every non-final resumable chunk to be a multiple of 256 KiB. */
const GCS_CHUNK_ALIGNMENT = 256 * 1024;
/** Default resumable chunk size: 8 MiB (a 256 KiB multiple). */
const RESUMABLE_CHUNK_SIZE = 8 * 1024 * 1024;

export interface InitUploadResponse {
	uploadId: string;
	objectKey: string;
	bucket: string;
	resumableUri: string;
	expiresAt: string | null;
	state: string;
	useDirectUpload: boolean;
}

export type UploadSessionState =
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

export interface UploadEntryStatus {
	name: string;
	state: string;
	documentId: string | null;
	code: string | null;
}

export interface UploadStatusResponse {
	uploadId: string;
	state: UploadSessionState;
	filename: string;
	size: number;
	progress: { entriesTotal: number; entriesProcessed: number; entriesFailed: number };
	documentIds: string[];
	entries: UploadEntryStatus[];
	error: { code: string; message: string } | null;
	createdAt: string | null;
	updatedAt: string | null;
	completedAt: string | null;
}

/** Terminal upload states — polling stops once one is reached. */
const TERMINAL_UPLOAD_STATES = new Set<UploadSessionState>([
	'completed',
	'partial',
	'failed',
	'expired',
	'cancelled',
]);

/**
 * Error carrying the server's stable `code` (from `{ error: { code, message } }`)
 * so the UI can map it to friendly text. The friendly mapping arrives in T6.2.
 */
export class UploadError extends Error {
	code: string | null;
	status: number;
	constructor(message: string, code: string | null, status: number) {
		super(message);
		this.name = 'UploadError';
		this.code = code;
		this.status = status;
	}
}

/** Read the server's nested `{ error: { message, code } }` body into a typed error. */
async function uploadErrorFromResponse(res: Response): Promise<UploadError> {
	let message = res.statusText || `Request failed (${res.status})`;
	let code: string | null = null;
	try {
		const body = await res.json();
		const err = body?.error;
		if (err && typeof err === 'object') {
			if (typeof err.message === 'string') message = err.message;
			if (typeof err.code === 'string') code = err.code;
		} else if (typeof body?.message === 'string') {
			message = body.message;
		}
	} catch {
		// Non-JSON body — keep the status-derived message.
	}
	return new UploadError(message, code, res.status);
}

/** Start a resumable upload session for `file`. */
export async function initUpload(
	file: File,
	opts: { checksum?: string } = {},
): Promise<InitUploadResponse> {
	const res = await fetch(`${getApiBase()}/upload/init`, {
		method: 'POST',
		headers: getHeaders(),
		body: JSON.stringify({
			filename: file.name,
			contentType: file.type || undefined,
			size: file.size,
			...(opts.checksum ? { checksum: opts.checksum, checksumAlgo: 'sha256' } : {}),
		}),
	});
	if (!res.ok) throw await uploadErrorFromResponse(res);
	return res.json() as Promise<InitUploadResponse>;
}

/** GCS returns `Range: bytes=0-<lastByte>`; the next byte to send is lastByte + 1. */
function parseCommittedOffset(rangeHeader: string | null): number {
	if (!rangeHeader) return 0;
	const match = /bytes=0-(\d+)/.exec(rangeHeader);
	return match ? Number(match[1]) + 1 : 0;
}

function abortError(): DOMException {
	return new DOMException('Upload aborted', 'AbortError');
}

/** Promise that resolves after `ms`, or rejects if `signal` aborts first. */
function delay(ms: number, signal?: AbortSignal): Promise<void> {
	return new Promise((resolve, reject) => {
		if (signal?.aborted) {
			reject(abortError());
			return;
		}
		const onAbort = () => {
			clearTimeout(timer);
			reject(abortError());
		};
		const timer = setTimeout(() => {
			signal?.removeEventListener('abort', onAbort);
			resolve();
		}, ms);
		signal?.addEventListener('abort', onAbort, { once: true });
	});
}

export interface PutResumableOptions {
	onProgress?: (loaded: number, total: number) => void;
	signal?: AbortSignal;
	chunkSize?: number;
	maxRetries?: number;
	retryDelayMs?: number;
}

/** Probe the resumable session for how many bytes GCS has already committed. */
async function probeCommittedOffset(
	resumableUri: string,
	total: number,
	signal?: AbortSignal,
): Promise<number> {
	const res = await fetch(resumableUri, {
		method: 'PUT',
		headers: { 'Content-Range': `bytes */${total}` },
		signal,
	});
	if (res.status === 308) return parseCommittedOffset(res.headers.get('Range'));
	if (res.ok) return total; // Already fully committed.
	throw await uploadErrorFromResponse(res);
}

/**
 * Upload `file` to a GCS resumable session URI in 256 KiB-aligned chunks,
 * honoring `308 Resume Incomplete` + `Range` and resuming after transient
 * failures. Sends NO bearer header (the URI itself is the capability). Progress
 * is reported per committed chunk.
 */
export async function putResumable(
	resumableUri: string,
	file: File,
	opts: PutResumableOptions = {},
): Promise<void> {
	const total = file.size;
	const chunkSize = Math.max(GCS_CHUNK_ALIGNMENT, opts.chunkSize ?? RESUMABLE_CHUNK_SIZE);
	const maxRetries = opts.maxRetries ?? 5;
	const retryDelayMs = opts.retryDelayMs ?? 500;

	let offset = 0;
	let attempt = 0;

	while (offset < total) {
		if (opts.signal?.aborted) throw abortError();

		const end = Math.min(offset + chunkSize, total);
		const chunk = file.slice(offset, end);
		try {
			const res = await fetch(resumableUri, {
				method: 'PUT',
				headers: { 'Content-Range': `bytes ${offset}-${end - 1}/${total}` },
				body: chunk,
				signal: opts.signal,
			});

			if (res.status === 308) {
				const rangeHeader = res.headers.get('Range');
				const committed = parseCommittedOffset(rangeHeader);
				// A successful parse is always >= 1, so a present-but-zero result means
				// the Range header was malformed. Throw (→ retry/re-probe) rather than
				// optimistically assuming the whole chunk landed and skipping bytes. A
				// genuinely absent header keeps the `end` fallback.
				if (rangeHeader && committed === 0) {
					throw new Error(`Malformed resumable Range header: ${rangeHeader}`);
				}
				offset = committed || end;
				attempt = 0;
				opts.onProgress?.(offset, total);
				continue;
			}
			if (res.ok) {
				opts.onProgress?.(total, total);
				return;
			}
			// 308 is handled above; any other non-OK (4xx/5xx) throws here and is
			// classified in the catch — 4xx surfaces, 5xx/network retries.
			throw await uploadErrorFromResponse(res);
		} catch (err) {
			if (err instanceof DOMException && err.name === 'AbortError') throw err;
			// 4xx (expired/gone/forbidden) is not resumable — surface immediately.
			if (err instanceof UploadError && err.status >= 400 && err.status < 500) throw err;
			if (attempt >= maxRetries) throw err;
			attempt += 1;
			await delay(retryDelayMs * attempt, opts.signal);
			// Re-probe how far GCS actually got before retrying.
			offset = await probeCommittedOffset(resumableUri, total, opts.signal);
			opts.onProgress?.(offset, total);
		}
	}
	opts.onProgress?.(total, total);
}

/** Finalize a resumable upload — fast validate-and-enqueue; returns 202 + status URL. */
export async function completeUpload(
	uploadId: string,
	checksum?: string,
): Promise<{ uploadId: string; state: string; statusUrl: string }> {
	const res = await fetch(`${getApiBase()}/upload/complete`, {
		method: 'POST',
		headers: getHeaders(),
		body: JSON.stringify({
			uploadId,
			...(checksum ? { checksum, checksumAlgo: 'sha256' } : {}),
		}),
	});
	if (!res.ok) throw await uploadErrorFromResponse(res);
	return res.json() as Promise<{ uploadId: string; state: string; statusUrl: string }>;
}

/** Fetch the current processing status for an upload session. */
export async function getUploadStatus(uploadId: string): Promise<UploadStatusResponse> {
	const res = await fetch(`${getApiBase()}/upload/${encodeURIComponent(uploadId)}/status`, {
		headers: getHeaders(),
	});
	if (!res.ok) throw await uploadErrorFromResponse(res);
	return res.json() as Promise<UploadStatusResponse>;
}

/** Cancel/abort an upload session. 404/409 are treated as benign races. */
export async function cancelUpload(uploadId: string): Promise<void> {
	const res = await fetch(`${getApiBase()}/upload/${encodeURIComponent(uploadId)}`, {
		method: 'DELETE',
		headers: getHeaders(),
	});
	if (!res.ok && res.status !== 404 && res.status !== 409) {
		throw await uploadErrorFromResponse(res);
	}
}

/** Poll `GET /status` until the upload reaches a terminal state, then resolve it. */
export async function pollUploadStatus(
	uploadId: string,
	opts: {
		onUpdate?: (status: UploadStatusResponse) => void;
		signal?: AbortSignal;
		intervalMs?: number;
	} = {},
): Promise<UploadStatusResponse> {
	const intervalMs = opts.intervalMs ?? 2000;
	for (;;) {
		if (opts.signal?.aborted) throw abortError();
		const status = await getUploadStatus(uploadId);
		opts.onUpdate?.(status);
		if (TERMINAL_UPLOAD_STATES.has(status.state)) return status;
		await delay(intervalMs, opts.signal);
	}
}

/**
 * Drive a large file through the full resumable flow:
 * init → resumable PUT (byte progress) → complete → poll (processing progress).
 * Resolves with the terminal status. `onInit` exposes the `uploadId` early so the
 * caller can offer Cancel during the upload/processing phases.
 */
export async function resumableUpload(
	file: File,
	opts: {
		onInit?: (init: InitUploadResponse) => void;
		onUploadProgress?: (loaded: number, total: number) => void;
		onProcessingUpdate?: (status: UploadStatusResponse) => void;
		signal?: AbortSignal;
		checksum?: string;
	} = {},
): Promise<UploadStatusResponse> {
	const init = await initUpload(file, { checksum: opts.checksum });
	opts.onInit?.(init);
	await putResumable(init.resumableUri, file, {
		onProgress: opts.onUploadProgress,
		signal: opts.signal,
	});
	await completeUpload(init.uploadId, opts.checksum);
	return pollUploadStatus(init.uploadId, {
		onUpdate: opts.onProcessingUpdate,
		signal: opts.signal,
	});
}

// --- Memory ---

export interface MemoryGraphNode {
	id: string;
	name: string;
	type: string;
	description: string | null;
}

export interface MemoryGraphEdge {
	id: string;
	source: string;
	target: string;
	type: string;
	strength: number;
}

export interface MemoryGraph {
	nodes: MemoryGraphNode[];
	edges: MemoryGraphEdge[];
}

export interface MemoryEntity {
	id: string;
	name: string;
	entity_type: string;
	description: string | null;
	metadata: Record<string, unknown>;
	created_at: string;
	updated_at: string;
}

export interface EntityContext {
	entity_id: string;
	entity_name: string;
	entity_type: string;
	entity_description: string | null;
	observations: Array<{
		id: string;
		content: string;
		source: string;
		confidence: number;
		created_at: string;
	}>;
	outgoing_relations: Array<{
		relation_type: string;
		to_entity: string;
		to_entity_type: string;
		strength: number;
	}>;
	incoming_relations: Array<{
		relation_type: string;
		from_entity: string;
		from_entity_type: string;
		strength: number;
	}>;
}

export async function fetchMemoryGraph(limit = 200): Promise<MemoryGraph> {
	return apiFetch(`/memory/graph?limit=${limit}`);
}

export async function fetchMemoryEntities(
	limit = 50,
	offset = 0,
	types?: string[],
): Promise<{ entities: MemoryEntity[]; total: number }> {
	const params = new URLSearchParams({ limit: String(limit), offset: String(offset) });
	if (types?.length) params.set('types', types.join(','));
	return apiFetch(`/memory/entities?${params}`);
}

export async function fetchMemoryEntity(name: string): Promise<EntityContext> {
	return apiFetch(`/memory/entities/${encodeURIComponent(name)}`);
}

// --- Conversations ---

export interface ConversationSession {
	session_id: string;
	session_key: string | null;
	title: string | null;
	summary: string | null;
	turn_count: number;
	last_activity: string;
	score: number;
}

export interface ConversationTurn {
	id: string;
	role: string;
	content: string;
	turn_index: number;
	created_at: string;
}

export interface ConversationDetail {
	session: {
		id: string;
		session_key: string | null;
		title: string | null;
		summary: string | null;
		turn_count: number;
		last_activity: string;
		created_at: string;
	};
	turns: ConversationTurn[];
}

export async function fetchConversations(
	limit = 20,
	offset = 0,
): Promise<{ sessions: ConversationSession[]; total: number }> {
	return apiFetch(`/conversations?limit=${limit}&offset=${offset}`);
}

export async function fetchConversation(id: string, maxTurns = 50): Promise<ConversationDetail> {
	return apiFetch(`/conversations/${id}?maxTurns=${maxTurns}`);
}

export async function searchConversations(
	query: string,
	limit = 10,
): Promise<{ query: string; totalResults: number; results: ConversationSession[] }> {
	return apiFetch(`/conversations/search?q=${encodeURIComponent(query)}&limit=${limit}`);
}

// --- Insights ---

export interface InsightEvidence {
	chunk_id?: string;
	document_title?: string;
	excerpt?: string;
	relevance?: number;
}

export interface InsightItem {
	id: string;
	insight_type: string;
	title: string;
	summary: string;
	evidence: InsightEvidence[];
	entities: string[];
	status: 'new' | 'seen' | 'dismissed';
	batch_id: string | null;
	created_at: string;
}

export interface InsightStats {
	total: number;
	new: number;
	seen: number;
	dismissed: number;
	byType: Record<string, number>;
	queueState: { chunks_pending: number; is_processing: boolean } | null;
}

export async function fetchInsights(
	options: {
		status?: string;
		type?: string;
		limit?: number;
		offset?: number;
	} = {},
): Promise<{ insights: InsightItem[]; total: number }> {
	const params = new URLSearchParams();
	if (options.status) params.set('status', options.status);
	if (options.type) params.set('type', options.type);
	if (options.limit) params.set('limit', String(options.limit));
	if (options.offset) params.set('offset', String(options.offset));
	const qs = params.toString();
	return apiFetch(`/insights${qs ? `?${qs}` : ''}`);
}

export async function fetchInsightStats(): Promise<InsightStats> {
	return apiFetch('/insights/stats');
}

export async function patchInsightStatus(id: string, status: 'seen' | 'dismissed'): Promise<void> {
	await apiFetch(`/insights/${id}/status`, {
		method: 'PATCH',
		body: JSON.stringify({ status }),
	});
}

// --- WebSocket ---
export type EventHandler = (event: { event: string; data: unknown }) => void;

export function connectWebSocket(onEvent: EventHandler): WebSocket | null {
	const token = typeof window !== 'undefined' ? localStorage.getItem('textrawl_token') : null;

	const url = getWsBase();

	try {
		// Auth via subprotocol to avoid exposing token in URL/logs
		const ws = token ? new WebSocket(url, ['textrawl', token]) : new WebSocket(url);
		ws.onmessage = (msg) => {
			try {
				const parsed = JSON.parse(msg.data as string);
				onEvent(parsed);
			} catch {
				// ignore non-JSON messages
			}
		};
		return ws;
	} catch {
		return null;
	}
}
