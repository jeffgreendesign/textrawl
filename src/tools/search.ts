import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { z } from 'zod';
import { logger } from '../utils/logger.js';
import { isSupabaseConfigured } from '../db/client.js';
import { hybridSearch } from '../db/search.js';
import { generateEmbedding, isOpenAIConfigured } from '../services/embeddings.js';

/**
 * Register the search_knowledge tool
 *
 * This tool performs hybrid semantic + full-text search over the knowledge base.
 */
export function registerSearchTool(server: McpServer): void {
  server.tool(
    'search_knowledge',
    {
      query: z.string().min(1).max(10000, 'Query must be at most 10KB').describe('Natural language search query'),
      limit: z
        .number()
        .min(1)
        .max(50)
        .default(10)
        .describe('Maximum results to return'),
      fullTextWeight: z
        .number()
        .min(0)
        .max(2)
        .default(1.0)
        .describe('Weight for keyword matching (0-2)'),
      semanticWeight: z
        .number()
        .min(0)
        .max(2)
        .default(1.0)
        .describe('Weight for semantic similarity (0-2)'),
      tags: z
        .array(z.string())
        .optional()
        .describe('Filter results to only include documents with ALL specified tags'),
      sourceType: z
        .enum(['note', 'file', 'url'])
        .optional()
        .describe('Filter by document source type'),
      minScore: z
        .number()
        .min(0)
        .max(1)
        .optional()
        .describe('Minimum relevance score threshold (0-1) to filter out low-quality results'),
    },
    async ({ query, limit, fullTextWeight, semanticWeight, tags, sourceType, minScore }) => {
      logger.info('search_knowledge called', {
        query,
        limit,
        fullTextWeight,
        semanticWeight,
        tags,
        sourceType,
        minScore,
      });

      // Check if services are configured
      if (!isSupabaseConfigured()) {
        return {
          content: [
            {
              type: 'text' as const,
              text: JSON.stringify(
                {
                  error: 'Database not configured',
                  message:
                    'Set SUPABASE_URL and SUPABASE_SERVICE_KEY to enable search.',
                },
                null,
                2
              ),
            },
          ],
        };
      }

      if (!isOpenAIConfigured()) {
        return {
          content: [
            {
              type: 'text' as const,
              text: JSON.stringify(
                {
                  error: 'OpenAI not configured',
                  message: 'Set OPENAI_API_KEY to enable semantic search.',
                },
                null,
                2
              ),
            },
          ],
        };
      }

      try {
        // Generate embedding for the query
        const queryEmbedding = await generateEmbedding(query);

        // Request more results to allow for post-filtering
        const fetchLimit = (tags || sourceType || minScore) ? limit * 3 : limit;

        // Perform hybrid search
        let results = await hybridSearch({
          queryText: query,
          queryEmbedding,
          limit: fetchLimit,
          fullTextWeight,
          semanticWeight,
        });

        // Apply post-filters
        if (sourceType) {
          results = results.filter((r) => r.source_type === sourceType);
        }

        if (tags && tags.length > 0) {
          results = results.filter((r) => {
            const docTags = (r.document_metadata?.tags as string[]) || [];
            return tags.every((tag) => docTags.includes(tag));
          });
        }

        if (minScore !== undefined) {
          results = results.filter((r) => r.score >= minScore);
        }

        // Apply final limit after filtering
        results = results.slice(0, limit);

        // Format results for output with metadata
        const formattedResults = results.map((r) => {
          const docTags = (r.document_metadata?.tags as string[]) || [];
          return {
            documentId: r.document_id,
            documentTitle: r.document_title,
            sourceType: r.source_type,
            tags: docTags,
            chunkId: r.chunk_id,
            content: r.content,
            score: r.score,
          };
        });

        return {
          content: [
            {
              type: 'text' as const,
              text: JSON.stringify(
                {
                  query,
                  filters: {
                    tags: tags || null,
                    sourceType: sourceType || null,
                    minScore: minScore ?? null,
                  },
                  totalResults: formattedResults.length,
                  results: formattedResults,
                },
                null,
                2
              ),
            },
          ],
        };
      } catch (error) {
        logger.error('search_knowledge failed', {
          error: error instanceof Error ? error.message : String(error),
        });

        return {
          content: [
            {
              type: 'text' as const,
              text: JSON.stringify(
                {
                  error: 'Search failed',
                  message:
                    error instanceof Error ? error.message : 'Unknown error',
                },
                null,
                2
              ),
            },
          ],
        };
      }
    }
  );

  logger.debug('Registered tool: search_knowledge');
}
