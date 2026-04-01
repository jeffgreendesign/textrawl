import type { SearchResult } from '../types/database.js';
import { DatabaseError } from '../utils/errors.js';
import { logger } from '../utils/logger.js';
import { isDatabaseConfigured, pgQuery } from './pg-client.js';

export interface HybridSearchOptions {
	queryText: string;
	queryEmbedding: number[];
	limit?: number;
	fullTextWeight?: number;
	semanticWeight?: number;
}

/**
 * Perform hybrid search combining vector similarity and full-text search using
 * Reciprocal Rank Fusion (RRF) via the `hybrid_search` Postgres function.
 *
 * @param options - Search configuration including query text, embedding, and weighting
 * @param options.queryText - The raw text query used for full-text search
 * @param options.queryEmbedding - The vector embedding of the query for semantic search
 * @param options.limit - Maximum number of results to return (default: 10)
 * @param options.fullTextWeight - Weight applied to full-text search scores in RRF (default: 1.0)
 * @param options.semanticWeight - Weight applied to semantic search scores in RRF (default: 1.0)
 * @returns An array of search results ranked by fused RRF score
 * @throws {DatabaseError} If the database is not configured or the search query fails
 */
export async function hybridSearch(options: HybridSearchOptions): Promise<SearchResult[]> {
	if (!isDatabaseConfigured()) {
		throw new DatabaseError('Database not configured');
	}

	const {
		queryText,
		queryEmbedding,
		limit = 10,
		fullTextWeight = 1.0,
		semanticWeight = 1.0,
	} = options;

	logger.debug('Performing hybrid search', {
		queryTextLength: queryText.length,
		limit,
		fullTextWeight,
		semanticWeight,
	});

	const { rows } = await pgQuery<SearchResult>(
		'SELECT * FROM hybrid_search($1, $2::vector, $3, $4, $5)',
		[queryText, JSON.stringify(queryEmbedding), limit, fullTextWeight, semanticWeight],
	);

	logger.info('Hybrid search completed', { resultCount: rows.length });

	return rows;
}
