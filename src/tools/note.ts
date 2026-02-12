import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { z } from 'zod';
import { createChunks } from '../db/chunks.js';
import { isSupabaseConfigured } from '../db/client.js';
import { createDocument } from '../db/documents.js';
import { smartChunk } from '../services/chunker.js';
import { generateEmbeddings, isOpenAIConfigured } from '../services/embeddings.js';
import { extractAndStoreMemories, isExtractionConfigured } from '../services/memory-extraction.js';
import { config } from '../utils/config.js';
import { logger } from '../utils/logger.js';

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
			tags: z.array(z.string()).optional().describe('Optional tags for organization'),
			extractMemories: z
				.boolean()
				.default(false)
				.describe(
					'Extract entities and facts from content and store as memories (requires ENABLE_MEMORY_EXTRACTION=true and ANTHROPIC_API_KEY)',
				),
		},
		async ({ title, content, tags, extractMemories }) => {
			logger.info('add_note called', {
				title,
				contentLength: content.length,
				tags,
				extractMemories,
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
									message: 'Set SUPABASE_URL and SUPABASE_SERVICE_KEY to enable note storage.',
								},
								null,
								2,
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
									error: 'Embedding provider not configured',
									message:
										'Set OPENAI_API_KEY or configure Ollama to enable embedding generation for search.',
								},
								null,
								2,
							),
						},
					],
					isError: true,
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

				// Chunk the content (uses semantic or fixed chunking based on CHUNKING_MODE)
				const chunks = await smartChunk(content, generateEmbeddings);

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

				// Memory extraction (Phase 3)
				let memoryResult = null;
				if (extractMemories) {
					if (!config.ENABLE_MEMORY_EXTRACTION) {
						memoryResult = {
							skipped: true,
							reason: 'ENABLE_MEMORY_EXTRACTION is false',
						};
					} else if (!isExtractionConfigured()) {
						memoryResult = {
							skipped: true,
							reason: 'ANTHROPIC_API_KEY not configured',
						};
					} else {
						try {
							logger.info('Extracting memories from note', { documentId: document.id });
							const { extraction, storage } = await extractAndStoreMemories(content, 'note');
							memoryResult = {
								entitiesFound: extraction.entities.length,
								relationsFound: extraction.relations.length,
								observationsCreated: storage.observationsCreated,
								observationsDuplicate: storage.observationsDuplicate,
								relationsCreated: storage.relationsCreated,
								errors: storage.errors.length > 0 ? storage.errors : undefined,
							};
							logger.info('Memory extraction complete', memoryResult);
						} catch (extractError) {
							logger.error('Memory extraction failed', {
								error: extractError instanceof Error ? extractError.message : String(extractError),
							});
							memoryResult = {
								error: 'Memory extraction failed',
								message: extractError instanceof Error ? extractError.message : 'Unknown error',
							};
						}
					}
				}

				logger.info('Note added successfully', {
					documentId: document.id,
					chunkCount: chunks.length,
					memoryExtraction: !!memoryResult,
				});

				if (config.COMPACT_RESPONSES) {
					const resp: Record<string, unknown> = {
						ok: true,
						id: document.id.slice(0, 8),
						ch: chunks.length,
					};
					if (memoryResult) resp.mem = memoryResult;
					return {
						content: [{ type: 'text' as const, text: JSON.stringify(resp) }],
					};
				}

				const response: Record<string, unknown> = {
					success: true,
					documentId: document.id,
					title: document.title,
					chunksCreated: chunks.length,
					message: 'Note saved and indexed for search.',
				};

				if (memoryResult) {
					response.memoryExtraction = memoryResult;
				}

				return {
					content: [
						{
							type: 'text' as const,
							text: JSON.stringify(response, null, 2),
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
									message: error instanceof Error ? error.message : 'Unknown error',
								},
								null,
								2,
							),
						},
					],
				};
			}
		},
	);

	logger.debug('Registered tool: add_note');
}
