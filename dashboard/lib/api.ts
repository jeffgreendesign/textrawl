/**
 * Textrawl REST API client for the dashboard.
 * All calls go to the Textrawl server's REST API (Enhancement 9).
 */

const ENV_API_BASE = process.env.NEXT_PUBLIC_API_URL ?? 'http://localhost:3000/api';
const WS_BASE = process.env.NEXT_PUBLIC_WS_URL ?? 'ws://localhost:3000/ws';

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
export interface Stats {
	documents: number;
	memories?: number | null;
	conversations?: number | null;
	insights?: number | null;
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

// --- WebSocket ---
export type EventHandler = (event: { event: string; data: unknown }) => void;

export function connectWebSocket(onEvent: EventHandler): WebSocket | null {
	const token = typeof window !== 'undefined' ? localStorage.getItem('textrawl_token') : null;

	const url = WS_BASE;

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
