import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { z } from 'zod';
import { logger } from '../utils/logger.js';
import { isSupabaseConfigured } from '../db/client.js';
import {
  getDocument as getDocumentFromDb,
  listDocuments as listDocumentsFromDb,
  updateDocument as updateDocumentInDb,
} from '../db/documents.js';
import { getChunksForDocument } from '../db/chunks.js';

/**
 * Register document-related tools: get_document and list_documents
 */
export function registerDocumentTools(server: McpServer): void {
  // get_document - Retrieve a full document by ID
  server.tool(
    'get_document',
    {
      documentId: z.string().uuid().describe('The document UUID'),
      includeChunks: z
        .boolean()
        .default(false)
        .describe('Include document chunks in response'),
    },
    async ({ documentId, includeChunks }) => {
      logger.info('get_document called', { documentId, includeChunks });

      if (!isSupabaseConfigured()) {
        return {
          content: [
            {
              type: 'text' as const,
              text: JSON.stringify(
                {
                  error: 'Database not configured',
                  message:
                    'Set SUPABASE_URL and SUPABASE_SERVICE_KEY to enable document retrieval.',
                },
                null,
                2
              ),
            },
          ],
        };
      }

      try {
        const document = await getDocumentFromDb(documentId);

        const result: Record<string, unknown> = {
          document: {
            id: document.id,
            title: document.title,
            sourceType: document.source_type,
            sourceUrl: document.source_url,
            content: document.raw_content,
            metadata: document.metadata,
            createdAt: document.created_at,
            updatedAt: document.updated_at,
          },
        };

        if (includeChunks) {
          const chunks = await getChunksForDocument(documentId);
          result.chunks = chunks.map((c) => ({
            id: c.id,
            index: c.chunk_index,
            content: c.content,
          }));
        }

        return {
          content: [
            {
              type: 'text' as const,
              text: JSON.stringify(result, null, 2),
            },
          ],
        };
      } catch (error) {
        logger.error('get_document failed', {
          error: error instanceof Error ? error.message : String(error),
        });

        return {
          content: [
            {
              type: 'text' as const,
              text: JSON.stringify(
                {
                  error: 'Failed to get document',
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

  logger.debug('Registered tool: get_document');

  // list_documents - List recent documents with pagination
  server.tool(
    'list_documents',
    {
      limit: z
        .number()
        .min(1)
        .max(100)
        .default(20)
        .describe('Number of documents to return'),
      offset: z.number().min(0).default(0).describe('Pagination offset'),
      sourceType: z
        .enum(['note', 'file', 'url'])
        .optional()
        .describe('Filter by source type'),
      tags: z
        .array(z.string())
        .optional()
        .describe('Filter by tags (returns docs containing ALL specified tags)'),
    },
    async ({ limit, offset, sourceType, tags }) => {
      logger.info('list_documents called', { limit, offset, sourceType, tags });

      if (!isSupabaseConfigured()) {
        return {
          content: [
            {
              type: 'text' as const,
              text: JSON.stringify(
                {
                  error: 'Database not configured',
                  message:
                    'Set SUPABASE_URL and SUPABASE_SERVICE_KEY to enable document listing.',
                },
                null,
                2
              ),
            },
          ],
        };
      }

      try {
        const { documents, total } = await listDocumentsFromDb({
          limit,
          offset,
          sourceType,
          tags,
        });

        const formattedDocuments = documents.map((d) => {
          const metadata = d.metadata as Record<string, unknown> | null;
          return {
            id: d.id,
            title: d.title,
            sourceType: d.source_type,
            tags: (metadata?.tags as string[]) || [],
            createdAt: d.created_at,
            updatedAt: d.updated_at,
          };
        });

        return {
          content: [
            {
              type: 'text' as const,
              text: JSON.stringify(
                {
                  documents: formattedDocuments,
                  pagination: {
                    limit,
                    offset,
                    total,
                    hasMore: offset + documents.length < total,
                  },
                },
                null,
                2
              ),
            },
          ],
        };
      } catch (error) {
        logger.error('list_documents failed', {
          error: error instanceof Error ? error.message : String(error),
        });

        return {
          content: [
            {
              type: 'text' as const,
              text: JSON.stringify(
                {
                  error: 'Failed to list documents',
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

  logger.debug('Registered tool: list_documents');

  // update_document - Update a document's title and/or tags
  server.tool(
    'update_document',
    {
      documentId: z.string().uuid().describe('The document UUID to update'),
      title: z.string().min(1).optional().describe('New title for the document'),
      tags: z
        .array(z.string())
        .optional()
        .describe('New tags for the document (replaces existing tags)'),
    },
    async ({ documentId, title, tags }) => {
      logger.info('update_document called', { documentId, title, tags });

      if (!isSupabaseConfigured()) {
        return {
          content: [
            {
              type: 'text' as const,
              text: JSON.stringify(
                {
                  error: 'Database not configured',
                  message:
                    'Set SUPABASE_URL and SUPABASE_SERVICE_KEY to enable document updates.',
                },
                null,
                2
              ),
            },
          ],
        };
      }

      if (title === undefined && tags === undefined) {
        return {
          content: [
            {
              type: 'text' as const,
              text: JSON.stringify(
                {
                  error: 'No updates provided',
                  message: 'Provide at least one of: title, tags',
                },
                null,
                2
              ),
            },
          ],
        };
      }

      try {
        const document = await updateDocumentInDb(documentId, { title, tags });

        const metadata = document.metadata as Record<string, unknown> | null;

        return {
          content: [
            {
              type: 'text' as const,
              text: JSON.stringify(
                {
                  success: true,
                  document: {
                    id: document.id,
                    title: document.title,
                    sourceType: document.source_type,
                    tags: (metadata?.tags as string[]) || [],
                    updatedAt: document.updated_at,
                  },
                },
                null,
                2
              ),
            },
          ],
        };
      } catch (error) {
        logger.error('update_document failed', {
          error: error instanceof Error ? error.message : String(error),
        });

        return {
          content: [
            {
              type: 'text' as const,
              text: JSON.stringify(
                {
                  error: 'Failed to update document',
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

  logger.debug('Registered tool: update_document');
}
