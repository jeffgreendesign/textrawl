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
