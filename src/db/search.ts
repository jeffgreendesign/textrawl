import { DatabaseError } from '../utils/errors.js';
import { logger } from '../utils/logger.js';
import { type SearchResult, getSupabaseClient, isSupabaseConfigured } from './client.js';

export interface HybridSearchOptions {
	queryText: string;
	queryEmbedding: number[];
	limit?: number;
	fullTextWeight?: number;
	semanticWeight?: number;
}

/**
 * Perform hybrid search combining vector similarity and full-text search using
 * Reciprocal Rank Fusion (RRF) via the `hybrid_search` Supabase RPC.
 *
 * @param options - Search configuration including query text, embedding, and weighting
 * @param options.queryText - The raw text query used for full-text search
 * @param options.queryEmbedding - The vector embedding of the query for semantic search
 * @param options.limit - Maximum number of results to return (default: 10)
 * @param options.fullTextWeight - Weight applied to full-text search scores in RRF (default: 1.0)
 * @param options.semanticWeight - Weight applied to semantic search scores in RRF (default: 1.0)
 * @returns An array of search results ranked by fused RRF score
 * @throws {DatabaseError} If Supabase is not configured or the search RPC fails
 */
export async function hybridSearch(options: HybridSearchOptions): Promise<SearchResult[]> {
	if (!isSupabaseConfigured()) {
		throw new DatabaseError('Supabase not configured');
	}

	const {
		queryText,
		queryEmbedding,
		limit = 10,
		fullTextWeight = 1.0,
		semanticWeight = 1.0,
	} = options;

	const client = getSupabaseClient();

	logger.debug('Performing hybrid search', {
		queryTextLength: queryText.length,
		limit,
		fullTextWeight,
		semanticWeight,
	});

	const { data, error } = await client.rpc('hybrid_search', {
		query_text: queryText,
		query_embedding: queryEmbedding,
		match_count: limit,
		full_text_weight: fullTextWeight,
		semantic_weight: semanticWeight,
	});

	if (error) {
		logger.error('Hybrid search failed', { error: error.message });
		throw new DatabaseError('Search operation failed');
	}

	logger.info('Hybrid search completed', { resultCount: data.length });

	return data as SearchResult[];
}
