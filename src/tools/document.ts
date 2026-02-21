import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { z } from 'zod';
import { getChunksForDocument } from '../db/chunks.js';
import { isSupabaseConfigured } from '../db/client.js';
import {
	getDocument as getDocumentFromDb,
	listDocuments as listDocumentsFromDb,
	updateDocument as updateDocumentInDb,
} from '../db/documents.js';
import { configError, formatId, toolError, toolResponse } from '../utils/compact.js';
import { logger } from '../utils/logger.js';

// --- Output Schemas ---

const GetDocumentOutputSchema = {
	document: z.object({
		id: z.string(),
		title: z.string(),
		sourceType: z.string(),
		sourceUrl: z.string().nullable(),
		content: z.string(),
		truncated: z.boolean().optional(),
		fullLength: z.number().optional(),
		metadata: z.record(z.string(), z.unknown()).nullable(),
		createdAt: z.string(),
		updatedAt: z.string(),
	}),
	chunks: z
		.array(
			z.object({
				id: z.string(),
				index: z.number(),
				content: z.string(),
			}),
		)
		.optional(),
};

const ListDocumentsOutputSchema = {
	documents: z.array(
		z.object({
			id: z.string(),
			title: z.string(),
			sourceType: z.string(),
			tags: z.array(z.string()),
			createdAt: z.string(),
			updatedAt: z.string(),
		}),
	),
	pagination: z.object({
		limit: z.number(),
		offset: z.number(),
		total: z.number(),
		hasMore: z.boolean(),
	}),
};

/**
 * Register document-related tools: get_document, list_documents, update_document
 */
export function registerDocumentTools(server: McpServer): void {
	// ============================================
	// Tool: get_document
	// ============================================
	server.registerTool(
		'get_document',
		{
			title: 'Get Document',
			description:
				'Retrieve a full document by ID with optional chunk data. Returns document content, metadata, and optionally the individual search chunks.',
			inputSchema: {
				documentId: z.string().uuid().describe('The document UUID'),
				includeChunks: z.boolean().default(false).describe('Include document chunks in response'),
				maxContentLength: z
					.number()
					.int()
					.min(0)
					.default(4000)
					.describe('Maximum content characters to return (0 = full content)'),
			},
			outputSchema: GetDocumentOutputSchema,
			annotations: {
				readOnlyHint: true,
				destructiveHint: false,
			},
		},
		async ({ documentId, includeChunks, maxContentLength }) => {
			logger.info('get_document called', { documentId, includeChunks });

			if (!isSupabaseConfigured()) {
				return configError('Database', 'Set SUPABASE_URL and SUPABASE_SERVICE_KEY');
			}

			try {
				const document = await getDocumentFromDb(documentId);
				const rawContent = document.raw_content || '';
				const truncateContent = maxContentLength > 0 && rawContent.length > maxContentLength;
				const content = truncateContent ? rawContent.slice(0, maxContentLength) : rawContent;

				// Build structuredContent (always verbose, canonical keys)
				const structuredContent: Record<string, unknown> = {
					document: {
						id: document.id,
						title: document.title,
						sourceType: document.source_type,
						sourceUrl: document.source_url ?? null,
						content,
						...(truncateContent ? { truncated: true, fullLength: rawContent.length } : {}),
						metadata: document.metadata ?? null,
						createdAt: document.created_at,
						updatedAt: document.updated_at,
					},
				};

				if (includeChunks) {
					const chunks = await getChunksForDocument(documentId);
					structuredContent.chunks = chunks.map((c) => ({
						id: c.id,
						index: c.chunk_index,
						content: c.content,
					}));
				}

				const compactObj: Record<string, unknown> = {
					id: formatId(document.id),
					t: document.title,
					src: document.source_type,
					c: content,
					...(truncateContent ? { trunc: true, full: rawContent.length } : {}),
				};

				if (includeChunks) {
					const chunks = structuredContent.chunks as Array<{
						id: string;
						index: number;
						content: string;
					}>;
					compactObj.ch = chunks.map((c) => ({
						i: c.index,
						c: c.content.slice(0, 300),
					}));
				}

				return toolResponse({
					compact: compactObj,
					verbose: structuredContent,
					structuredContent,
				});
			} catch (error) {
				logger.error('get_document failed', {
					error: error instanceof Error ? error.message : String(error),
				});
				return toolError(error instanceof Error ? error.message : 'Failed to get document');
			}
		},
	);

	logger.debug('Registered tool: get_document');

	// ============================================
	// Tool: list_documents
	// ============================================
	server.registerTool(
		'list_documents',
		{
			title: 'List Documents',
			description:
				'List documents in the knowledge base with pagination. Supports filtering by source type, content type, and tags. Returns document metadata without full content.',
			inputSchema: {
				limit: z.number().min(1).max(100).default(20).describe('Number of documents to return'),
				offset: z.number().min(0).default(0).describe('Pagination offset'),
				sourceType: z.enum(['note', 'file', 'url']).optional().describe('Filter by source type'),
				contentType: z
					.enum(['email', 'youtube', 'calendar', 'contact', 'webpage', 'document'])
					.optional()
					.describe(
						'Filter by content type (email, youtube watch history, calendar events, contacts, webpages)',
					),
				tags: z
					.array(z.string())
					.optional()
					.describe('Filter by tags (returns docs containing ALL specified tags)'),
				sortBy: z
					.enum(['created_at', 'updated_at', 'title'])
					.optional()
					.default('created_at')
					.describe('Field to sort by'),
				sortOrder: z
					.enum(['asc', 'desc'])
					.optional()
					.default('desc')
					.describe('Sort order (asc for oldest first, desc for newest first)'),
			},
			outputSchema: ListDocumentsOutputSchema,
			annotations: {
				readOnlyHint: true,
				destructiveHint: false,
			},
		},
		async ({ limit, offset, sourceType, contentType, tags, sortBy, sortOrder }) => {
			logger.info('list_documents called', {
				limit,
				offset,
				sourceType,
				contentType,
				tags,
				sortBy,
				sortOrder,
			});

			if (!isSupabaseConfigured()) {
				return configError('Database', 'Set SUPABASE_URL and SUPABASE_SERVICE_KEY');
			}

			try {
				const { documents, total } = await listDocumentsFromDb({
					limit,
					offset,
					sourceType,
					contentType,
					tags,
					sortBy,
					sortOrder,
				});

				// Build structuredContent (always verbose, canonical keys)
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

				const structuredContent = {
					documents: formattedDocuments,
					pagination: {
						limit,
						offset,
						total,
						hasMore: offset + documents.length < total,
					},
				};

				return toolResponse({
					compact: {
						n: total,
						more: offset + documents.length < total,
						d: documents.map((d) => ({
							id: formatId(d.id),
							t: d.title,
							src: d.source_type,
							at: d.created_at,
						})),
					},
					verbose: structuredContent,
					structuredContent,
				});
			} catch (error) {
				logger.error('list_documents failed', {
					error: error instanceof Error ? error.message : String(error),
				});
				return toolError(error instanceof Error ? error.message : 'Failed to list documents');
			}
		},
	);

	logger.debug('Registered tool: list_documents');

	// ============================================
	// Tool: update_document
	// ============================================
	server.registerTool(
		'update_document',
		{
			title: 'Update Document',
			description:
				"Update a document's title and/or tags. Provide at least one of title or tags to update.",
			inputSchema: {
				documentId: z.string().uuid().describe('The document UUID to update'),
				title: z.string().min(1).optional().describe('New title for the document'),
				tags: z
					.array(z.string())
					.optional()
					.describe('New tags for the document (replaces existing tags)'),
			},
			annotations: {
				readOnlyHint: false,
				destructiveHint: false,
				idempotentHint: true,
			},
		},
		async ({ documentId, title, tags }) => {
			logger.info('update_document called', { documentId, title, tags });

			if (!isSupabaseConfigured()) {
				return configError('Database', 'Set SUPABASE_URL and SUPABASE_SERVICE_KEY');
			}

			if (title === undefined && tags === undefined) {
				return toolError('No updates provided. Provide at least one of: title, tags');
			}

			try {
				const document = await updateDocumentInDb(documentId, { title, tags });
				const metadata = document.metadata as Record<string, unknown> | null;

				return toolResponse({
					compact: {
						ok: true,
						id: formatId(document.id),
						t: document.title,
					},
					verbose: {
						success: true,
						document: {
							id: document.id,
							title: document.title,
							sourceType: document.source_type,
							tags: (metadata?.tags as string[]) || [],
							updatedAt: document.updated_at,
						},
					},
				});
			} catch (error) {
				logger.error('update_document failed', {
					error: error instanceof Error ? error.message : String(error),
				});
				return toolError(error instanceof Error ? error.message : 'Failed to update document');
			}
		},
	);

	logger.debug('Registered tool: update_document');
}
