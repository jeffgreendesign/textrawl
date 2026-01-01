import { getSupabaseClient, isSupabaseConfigured, type SearchResult } from './client.js';
import { logger } from '../utils/logger.js';
import { DatabaseError } from '../utils/errors.js';

export interface HybridSearchOptions {
  queryText: string;
  queryEmbedding: number[];
  limit?: number;
  fullTextWeight?: number;
  semanticWeight?: number;
}

/**
 * Perform hybrid search (vector + full-text) using RRF
 */
export async function hybridSearch(
  options: HybridSearchOptions
): Promise<SearchResult[]> {
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
