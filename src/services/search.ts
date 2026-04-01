import { hybridConversationSearch } from '../db/conversation-search.js';
import { hybridMemorySearch } from '../db/memory-search.js';
import { isDatabaseConfigured } from '../db/pg-client.js';
import { hybridSearch } from '../db/search.js';
import { config } from '../utils/config.js';
import { ServiceUnavailableError } from '../utils/errors.js';
import { logger } from '../utils/logger.js';
import { generateEmbedding, isEmbeddingsConfigured } from './embeddings.js';

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface SearchOptions {
	query: string;
	limit?: number;
	fullTextWeight?: number;
	semanticWeight?: number;
	tags?: string[];
	sourceType?: string;
	contentType?: string;
	minScore?: number;
	includeMemories?: boolean;
	includeConversations?: boolean;
	memoryWeight?: number;
	conversationWeight?: number;
}

export interface SearchResult {
	type: 'document' | 'memory' | 'conversation';
	score: number;
	documentId?: string;
	documentTitle?: string;
	sourceType?: string;
	tags?: string[];
	chunkId?: string;
	content?: string;
	entityId?: string;
	entityName?: string;
	entityType?: string;
	sessionId?: string;
	sessionKey?: string | null;
	title?: string | null;
	summary?: string | null;
}

export interface SearchResponse {
	query: string;
	totalResults: number;
	results: SearchResult[];
	counts?: { documents: number; memories: number; conversations: number };
}

// ---------------------------------------------------------------------------
// Unified search
// ---------------------------------------------------------------------------

/**
 * Unified search across documents, memories, and conversations.
 *
 * Used by the MCP search tool, REST `/api/search`, and A2A `/tasks` endpoint
 * so that all surfaces share the same filtering, fusion, and scoring logic.
 */
export async function unifiedSearch(options: SearchOptions): Promise<SearchResponse> {
	const {
		query,
		limit = 10,
		fullTextWeight = 1.0,
		semanticWeight = 1.0,
		tags,
		sourceType,
		contentType,
		minScore,
		includeMemories = false,
		includeConversations = false,
		memoryWeight = 1.0,
		conversationWeight = 0.5,
	} = options;

	if (!isDatabaseConfigured()) {
		throw new ServiceUnavailableError('Database not configured');
	}
	if (!isEmbeddingsConfigured()) {
		throw new ServiceUnavailableError('Embedding provider not configured');
	}

	const queryEmbedding = await generateEmbedding(query);

	// Request extra results to allow for post-filtering
	const hasFilters = !!(tags || sourceType || contentType || minScore);
	const fetchLimit = hasFilters ? limit * 3 : limit;

	// --- Document search ---
	let docResults = await hybridSearch({
		queryText: query,
		queryEmbedding,
		limit: fetchLimit,
		fullTextWeight,
		semanticWeight,
	});

	if (sourceType) {
		docResults = docResults.filter((r) => r.source_type === sourceType);
	}
	if (contentType) {
		docResults = docResults.filter((r) => r.document_metadata?.content_type === contentType);
	}
	if (tags && tags.length > 0) {
		docResults = docResults.filter((r) => {
			const docTags = (r.document_metadata?.tags as string[]) || [];
			return tags.every((tag) => docTags.includes(tag));
		});
	}
	if (minScore !== undefined) {
		docResults = docResults.filter((r) => r.score >= minScore);
	}
	docResults = docResults.slice(0, limit);

	const crossSource = includeMemories || includeConversations;

	if (!crossSource) {
		const results: SearchResult[] = docResults.map((r) => ({
			type: 'document' as const,
			score: r.score,
			documentId: r.document_id,
			documentTitle: r.document_title,
			sourceType: r.source_type,
			tags: (r.document_metadata?.tags as string[]) || [],
			chunkId: r.chunk_id,
			content: r.content.slice(0, 500),
		}));

		return { query, totalResults: results.length, results };
	}

	// --- Cross-source fusion ---
	let allResults: SearchResult[] = docResults.map((r) => ({
		type: 'document' as const,
		score: r.score,
		documentId: r.document_id,
		documentTitle: r.document_title,
		sourceType: r.source_type,
		tags: (r.document_metadata?.tags as string[]) || [],
		chunkId: r.chunk_id,
		content: r.content.slice(0, 500),
	}));

	if (includeMemories && config.ENABLE_MEMORY) {
		const memories = await hybridMemorySearch(query, queryEmbedding, { limit });
		for (const mem of memories) {
			allResults.push({
				type: 'memory',
				score: mem.score * memoryWeight,
				entityId: mem.entity_id,
				entityName: mem.entity_name,
				entityType: mem.entity_type,
				content: mem.observation_content.slice(0, 500),
			});
		}
	}

	if (includeConversations && config.ENABLE_CONVERSATIONS) {
		const convos = await hybridConversationSearch(query, queryEmbedding, { limit });
		for (const conv of convos) {
			allResults.push({
				type: 'conversation',
				score: conv.score * conversationWeight,
				sessionId: conv.session_id,
				sessionKey: conv.session_key,
				title: conv.title,
				summary: conv.summary?.slice(0, 300),
			});
		}
	}

	if (minScore !== undefined) {
		allResults = allResults.filter((r) => r.score >= minScore);
	}

	allResults.sort((a, b) => b.score - a.score);
	const limitedResults = allResults.slice(0, limit);

	const docCount = limitedResults.filter((r) => r.type === 'document').length;
	const memCount = limitedResults.filter((r) => r.type === 'memory').length;
	const convCount = limitedResults.filter((r) => r.type === 'conversation').length;

	logger.info('Unified search completed (cross-source)', {
		documentCount: docCount,
		memoryCount: memCount,
		conversationCount: convCount,
		totalFused: limitedResults.length,
	});

	return {
		query,
		totalResults: limitedResults.length,
		results: limitedResults,
		counts: { documents: docCount, memories: memCount, conversations: convCount },
	};
}

// ---------------------------------------------------------------------------
// Error — re-export ServiceUnavailableError as SearchError for backward compat
// ---------------------------------------------------------------------------

export const SearchError = ServiceUnavailableError;
