import { generateEmbedding } from '../services/embeddings.js';
import { config } from './config.js';

// ---------------------------------------------------------------------------
// Query-embedding cache
// ---------------------------------------------------------------------------
//
// Every search embeds its query string via an external provider round-trip
// (OpenAI/Google) or a local Ollama call. Identical queries -- repeated
// searches, the same term across document/memory/conversation sources, retries
// -- re-embed every time. A small bounded LRU with TTL removes that hop from the
// hot path while keeping memory flat and bounding staleness.
//
// The cache key includes the active provider+model so a runtime config change
// can never return a vector of the wrong dimension for the current schema.
// Only successful embeddings are cached; a throwing `embed` leaves the cache
// untouched so the next call retries.

export interface QueryEmbeddingCacheOptions {
	/** Maximum number of cached query embeddings (LRU eviction beyond this). */
	max?: number;
	/** Time-to-live per entry in milliseconds. */
	ttlMs?: number;
	/** Embedding function (injectable for tests). */
	embed?: (text: string) => Promise<number[]>;
	/** Clock (injectable for tests). */
	now?: () => number;
}

interface CacheEntry {
	value: number[];
	expiresAt: number;
}

const DEFAULT_MAX = 256;
const DEFAULT_TTL_MS = 5 * 60_000;

/**
 * Resolve a stable identifier for the active embedding provider and model.
 * Different providers/models produce different-dimension vectors, so their
 * cached embeddings must never be shared.
 */
function providerKey(): string {
	switch (config.EMBEDDING_PROVIDER) {
		case 'ollama':
			return `ollama:${config.OLLAMA_MODEL}`;
		case 'google':
			return `google:${config.GOOGLE_EMBEDDING_MODEL}`;
		default:
			return 'openai:text-embedding-3-small';
	}
}

/**
 * Build an unambiguous cache key from the provider identity and query text.
 * `JSON.stringify` of the tuple escapes both parts, so no query string can ever
 * collide with a different provider's entry.
 */
function cacheKey(query: string): string {
	return JSON.stringify([providerKey(), query]);
}

export interface QueryEmbeddingCache {
	get(query: string): Promise<number[]>;
	clear(): void;
	readonly size: number;
}

/**
 * Create a bounded, TTL'd LRU cache over query embeddings. A `Map` preserves
 * insertion order, so we use re-insertion to track recency and evict from the
 * front once `max` is exceeded.
 */
export function createQueryEmbeddingCache(
	options: QueryEmbeddingCacheOptions = {},
): QueryEmbeddingCache {
	const max = options.max ?? DEFAULT_MAX;
	const ttlMs = options.ttlMs ?? DEFAULT_TTL_MS;
	const embed = options.embed ?? generateEmbedding;
	const now = options.now ?? Date.now;

	const store = new Map<string, CacheEntry>();

	async function get(query: string): Promise<number[]> {
		const key = cacheKey(query);
		const hit = store.get(key);

		if (hit) {
			if (hit.expiresAt > now()) {
				// Refresh recency: delete + re-insert moves this key to the end.
				store.delete(key);
				store.set(key, hit);
				return hit.value;
			}
			// Expired -- drop it and fall through to re-embed.
			store.delete(key);
		}

		const value = await embed(query);
		// Reached only on success -- a throwing embed never caches.
		store.set(key, { value, expiresAt: now() + ttlMs });

		// Evict least-recently-used entries from the front.
		while (store.size > max) {
			const oldest = store.keys().next().value;
			if (oldest === undefined) {
				break;
			}
			store.delete(oldest);
		}

		return value;
	}

	function clear(): void {
		store.clear();
	}

	return {
		get,
		clear,
		get size() {
			return store.size;
		},
	};
}

/** Process-wide cache used by the search hot path. */
export const queryEmbeddingCache = createQueryEmbeddingCache();

/**
 * Embed a search query, served from the process-wide cache when possible.
 * Drop-in replacement for `generateEmbedding` on the query path.
 */
export function getQueryEmbedding(query: string): Promise<number[]> {
	return queryEmbeddingCache.get(query);
}
