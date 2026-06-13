import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { z } from 'zod';
import { isDatabaseConfigured } from '../db/pg-client.js';
import { isEmbeddingsConfigured } from '../services/embeddings.js';
import { configError, toolError, toolResponse } from '../utils/compact.js';
import { logger } from '../utils/logger.js';
import { validationError } from './lib/validation.js';
import { runAddNote } from './note.js';
import { runSaveUrl } from './url.js';

const CaptureOutputSchema = {
	ok: z.boolean(),
	kind: z.enum(['note', 'url']),
	documentId: z.string(),
	title: z.string(),
	chunksCreated: z.number(),
	url: z.string().optional(),
	contentLength: z.number().optional(),
	memoryExtraction: z.record(z.string(), z.unknown()).nullable().optional(),
};

/**
 * Register the `capture` workflow tool.
 *
 * Consolidates the legacy `add_note` and `save_url` tools into one
 * content-acquisition workflow ("capture something into my knowledge base"),
 * discriminated by `kind`. Both variants share the same chunk → embed → persist
 * pipeline via the exported `runAddNote` / `runSaveUrl` cores.
 */
export function registerCaptureTool(server: McpServer): void {
	server.registerTool(
		'capture',
		{
			title: 'Capture',
			description:
				'Save content to your knowledge base. kind="note": store a markdown note (requires title + content). kind="url": fetch and clip a web page (requires url). Content is chunked and embedded for search.',
			inputSchema: {
				kind: z.enum(['note', 'url']).describe('What to capture: a "note" or a "url".'),
				title: z
					.string()
					.max(500)
					.optional()
					.describe('Note title (required for kind="note"); optional override for kind="url".'),
				content: z
					.string()
					.max(1000000)
					.optional()
					.describe('Note body in markdown (required for kind="note").'),
				url: z.string().optional().describe('Web page URL (required for kind="url").'),
				tags: z.array(z.string()).optional().describe('Optional tags for organization.'),
				audience: z
					.enum(['private_jeff', 'family_shared', 'public_safe'])
					.optional()
					.describe('Audience tag stored in document metadata for later filtering.'),
				extractMemories: z
					.boolean()
					.default(false)
					.describe(
						'Extract entities and facts as memories (requires ENABLE_MEMORY_EXTRACTION + ANTHROPIC_API_KEY). Off by default.',
					),
			},
			outputSchema: CaptureOutputSchema,
			annotations: {
				readOnlyHint: false,
				destructiveHint: false,
				idempotentHint: false,
				openWorldHint: true,
			},
		},
		async ({ kind, title, content, url, tags, audience, extractMemories }) => {
			logger.info('capture called', { kind, hasTitle: !!title, tags, extractMemories });

			if (!isDatabaseConfigured()) {
				return configError('Database', 'Set DATABASE_URL');
			}
			if (!isEmbeddingsConfigured()) {
				return configError('Embeddings', 'Configure an embedding provider');
			}

			try {
				if (kind === 'note') {
					const missing: string[] = [];
					if (!title) missing.push('title');
					if (!content) missing.push('content');
					if (missing.length > 0) {
						return validationError('kind="note" requires title and content.', missing);
					}

					const result = await runAddNote({
						title: title as string,
						content: content as string,
						tags,
						extractMemories,
						audience,
					});

					const structuredContent = {
						ok: true,
						kind: 'note' as const,
						documentId: result.documentId,
						title: result.title,
						chunksCreated: result.chunksCreated,
						memoryExtraction: result.memoryExtraction ?? null,
					};
					return toolResponse({
						compact: {
							ok: true,
							kind: 'note',
							id: result.documentId.slice(0, 8),
							ch: result.chunksCreated,
						},
						verbose: structuredContent,
						structuredContent,
					});
				}

				// kind === 'url'
				if (!url) {
					return validationError('kind="url" requires url.', ['url']);
				}

				const saved = await runSaveUrl({ url, title, tags, extractMemories, audience });
				const structuredContent = {
					ok: true,
					kind: 'url' as const,
					documentId: saved.documentId,
					title: saved.title,
					chunksCreated: saved.chunksCreated,
					url: saved.url,
					contentLength: saved.contentLength,
					memoryExtraction: saved.memoryExtraction ?? null,
				};
				return toolResponse({
					compact: {
						ok: true,
						kind: 'url',
						id: saved.documentId.slice(0, 8),
						ch: saved.chunksCreated,
					},
					verbose: structuredContent,
					structuredContent,
				});
			} catch (error) {
				return toolError('capture', error, { scope: kind });
			}
		},
	);

	logger.debug('Registered tool: capture');
}
