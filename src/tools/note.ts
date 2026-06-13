import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { z } from 'zod';
import { createChunks } from '../db/chunks.js';
import { createDocument } from '../db/documents.js';
import { isDatabaseConfigured } from '../db/pg-client.js';
import { smartChunk } from '../services/chunker.js';
import { generateEmbeddings, isEmbeddingsConfigured } from '../services/embeddings.js';
import { extractAndStoreMemories, isExtractionConfigured } from '../services/memory-extraction.js';
import { configError, toolError } from '../utils/compact.js';
import { config } from '../utils/config.js';
import { logger } from '../utils/logger.js';

export interface RunAddNoteInput {
	title: string;
	content: string;
	tags?: string[];
	extractMemories?: boolean;
	/** Optional audience tag stored in document metadata for later filtering. */
	audience?: string;
}

export interface RunAddNoteResult {
	documentId: string;
	title: string;
	chunksCreated: number;
	memoryExtraction?: Record<string, unknown> | null;
}

/**
 * Core note-capture pipeline: create document, chunk, embed, persist, and
 * (optionally) extract memories. Shared single source of truth for both the
 * legacy `add_note` tool and the consolidated `capture` tool. Throws on failure;
 * callers handle config checks and response formatting.
 */
export async function runAddNote(input: RunAddNoteInput): Promise<RunAddNoteResult> {
	const { title, content, tags, extractMemories, audience } = input;

	const document = await createDocument({
		title,
		sourceType: 'note',
		rawContent: content,
		metadata: { tags: tags || [], ...(audience ? { audience } : {}) },
	});

	// Chunk the content (uses semantic or fixed chunking based on CHUNKING_MODE)
	const chunks = await smartChunk(content, generateEmbeddings);

	// Generate embeddings for all chunks
	const chunkContents = chunks.map((c) => c.content);
	const embeddings = await generateEmbeddings(chunkContents);

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
	let memoryResult: Record<string, unknown> | null = null;
	if (extractMemories) {
		if (!config.ENABLE_MEMORY_EXTRACTION) {
			memoryResult = { skipped: true, reason: 'ENABLE_MEMORY_EXTRACTION is false' };
		} else if (!isExtractionConfigured()) {
			memoryResult = { skipped: true, reason: 'ANTHROPIC_API_KEY not configured' };
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

	return {
		documentId: document.id,
		title: document.title,
		chunksCreated: chunks.length,
		memoryExtraction: memoryResult,
	};
}

/**
 * Register the add_note tool
 *
 * This tool allows quick capture of notes to the knowledge base.
 */
export function registerNoteTool(server: McpServer): void {
	// ============================================
	// Tool: add_note
	// ============================================
	server.registerTool(
		'add_note',
		{
			title: 'Add Note',
			description:
				'Create a markdown note in the knowledge base with automatic chunking and embedding for search. Optionally extract entities and facts as memories.',
			inputSchema: {
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
			annotations: {
				readOnlyHint: false,
				destructiveHint: false,
			},
		},
		async ({ title, content, tags, extractMemories }) => {
			logger.info('add_note called', {
				title,
				contentLength: content.length,
				tags,
				extractMemories,
			});

			// Check if services are configured
			if (!isDatabaseConfigured()) {
				return configError('Database', 'Set DATABASE_URL');
			}

			if (!isEmbeddingsConfigured()) {
				return configError('Embeddings', 'Configure an embedding provider');
			}

			try {
				const result = await runAddNote({ title, content, tags, extractMemories });
				const memoryResult = result.memoryExtraction;

				if (config.COMPACT_RESPONSES) {
					const resp: Record<string, unknown> = {
						ok: true,
						id: result.documentId.slice(0, 8),
						ch: result.chunksCreated,
					};
					if (memoryResult) resp.mem = memoryResult;
					return {
						content: [{ type: 'text' as const, text: JSON.stringify(resp) }],
					};
				}

				const response: Record<string, unknown> = {
					success: true,
					documentId: result.documentId,
					title: result.title,
					chunksCreated: result.chunksCreated,
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
				return toolError('add_note', error);
			}
		},
	);

	logger.debug('Registered tool: add_note');
}
