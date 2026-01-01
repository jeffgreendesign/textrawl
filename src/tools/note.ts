import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { z } from 'zod';
import { logger } from '../utils/logger.js';
import { isSupabaseConfigured } from '../db/client.js';
import { createDocument } from '../db/documents.js';
import { createChunks } from '../db/chunks.js';
import { chunkText } from '../services/chunker.js';
import {
  generateEmbeddings,
  isOpenAIConfigured,
} from '../services/embeddings.js';

/**
 * Register the add_note tool
 *
 * This tool allows quick capture of notes to the knowledge base.
 */
export function registerNoteTool(server: McpServer): void {
  server.tool(
    'add_note',
    {
      title: z.string().min(1).max(500).describe('Note title'),
      content: z
        .string()
        .min(1)
        .max(1000000, 'Content must be at most 1MB')
        .describe('Note content (markdown supported)'),
      tags: z
        .array(z.string())
        .optional()
        .describe('Optional tags for organization'),
    },
    async ({ title, content, tags }) => {
      logger.info('add_note called', {
        title,
        contentLength: content.length,
        tags,
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
                    'Set SUPABASE_URL and SUPABASE_SERVICE_KEY to enable note storage.',
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
                  message:
                    'Set OPENAI_API_KEY to enable embedding generation for search.',
                },
                null,
                2
              ),
            },
          ],
        };
      }

      try {
        // Create the document
        const document = await createDocument({
          title,
          sourceType: 'note',
          rawContent: content,
          metadata: { tags: tags || [] },
        });

        // Chunk the content
        const chunks = chunkText(content);

        // Generate embeddings for all chunks
        const chunkContents = chunks.map((c) => c.content);
        const embeddings = await generateEmbeddings(chunkContents);

        // Create chunks with embeddings
        const chunkInputs = chunks.map((chunk, i) => ({
          documentId: document.id,
          content: chunk.content,
          chunkIndex: chunk.index,
          startOffset: chunk.startOffset,
          endOffset: chunk.endOffset,
          embedding: embeddings[i],
          metadata: { tokenCount: chunk.tokenCount },
        }));

        await createChunks(chunkInputs);

        logger.info('Note added successfully', {
          documentId: document.id,
          chunkCount: chunks.length,
        });

        return {
          content: [
            {
              type: 'text' as const,
              text: JSON.stringify(
                {
                  success: true,
                  documentId: document.id,
                  title: document.title,
                  chunksCreated: chunks.length,
                  message: 'Note saved and indexed for search.',
                },
                null,
                2
              ),
            },
          ],
        };
      } catch (error) {
        logger.error('add_note failed', {
          error: error instanceof Error ? error.message : String(error),
        });

        return {
          content: [
            {
              type: 'text' as const,
              text: JSON.stringify(
                {
                  success: false,
                  error: 'Failed to add note',
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

  logger.debug('Registered tool: add_note');
}
