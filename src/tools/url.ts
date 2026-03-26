import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { JSDOM } from 'jsdom';
import TurndownService from 'turndown';
import { z } from 'zod';
import { createChunks } from '../db/chunks.js';
import { isSupabaseConfigured } from '../db/client.js';
import { createDocument } from '../db/documents.js';
import { smartChunk } from '../services/chunker.js';
import { generateEmbeddings, isEmbeddingsConfigured } from '../services/embeddings.js';
import { extractAndStoreMemories, isExtractionConfigured } from '../services/memory-extraction.js';
import { configError, toolError } from '../utils/compact.js';
import { config } from '../utils/config.js';
import { logger } from '../utils/logger.js';

const turndown = new TurndownService({
	headingStyle: 'atx',
	codeBlockStyle: 'fenced',
});

/**
 * Extract metadata from an HTML document.
 */
function extractMetadata(doc: Document, url: string): Record<string, string | null> {
	const getMeta = (name: string): string | null =>
		doc.querySelector(`meta[name="${name}"], meta[property="${name}"]`)?.getAttribute('content') ??
		null;

	return {
		title: doc.querySelector('title')?.textContent?.trim() ?? null,
		description: getMeta('description') ?? getMeta('og:description'),
		author: getMeta('author') ?? getMeta('article:author'),
		publishedDate:
			getMeta('article:published_time') ?? getMeta('date') ?? getMeta('og:updated_time'),
		siteName: getMeta('og:site_name'),
		image: getMeta('og:image'),
		url,
	};
}

/**
 * Register the save_url tool for web clipping.
 */
export function registerUrlTool(server: McpServer): void {
	server.registerTool(
		'save_url',
		{
			title: 'Save URL',
			description:
				'Fetch a web page, extract its content as markdown, and save it to the knowledge base with automatic chunking, embedding, and optional memory extraction.',
			inputSchema: {
				url: z.string().url().describe('URL of the web page to save'),
				title: z
					.string()
					.max(500)
					.optional()
					.describe('Override title (auto-detected from page if omitted)'),
				tags: z.array(z.string()).optional().describe('Optional tags for organization'),
				extractMemories: z
					.boolean()
					.default(false)
					.describe('Extract entities and facts from content and store as memories'),
			},
			annotations: {
				readOnlyHint: false,
				destructiveHint: false,
			},
		},
		async ({ url, title, tags, extractMemories }) => {
			logger.info('save_url called', { url, title, tags, extractMemories });

			if (!isSupabaseConfigured()) {
				return configError('Database', 'Set SUPABASE_URL and SUPABASE_SERVICE_KEY');
			}
			if (!isEmbeddingsConfigured()) {
				return configError('Embeddings', 'Configure an embedding provider');
			}

			try {
				// Fetch the page
				const response = await fetch(url, {
					headers: {
						'User-Agent': 'Textrawl/1.0 (Knowledge Base Bot)',
						Accept: 'text/html,application/xhtml+xml',
					},
					signal: AbortSignal.timeout(30_000),
				});

				if (!response.ok) {
					return toolError(`Failed to fetch URL: HTTP ${response.status}`);
				}

				const html = await response.text();
				const dom = new JSDOM(html, { url });
				const doc = dom.window.document;

				// Extract metadata
				const metadata = extractMetadata(doc, url);

				// Remove scripts, styles, nav, footer, etc.
				for (const sel of ['script', 'style', 'nav', 'footer', 'header', 'aside', 'iframe']) {
					for (const el of doc.querySelectorAll(sel)) {
						el.remove();
					}
				}

				// Convert to markdown
				const mainContent = doc.querySelector('article, main, [role="main"]') ?? doc.body;
				const markdown = turndown.turndown(mainContent?.innerHTML ?? '');

				if (!markdown.trim()) {
					return toolError('No content extracted from the page');
				}

				const pageTitle = title ?? metadata.title ?? new URL(url).hostname;

				// Create document
				const document = await createDocument({
					title: pageTitle,
					sourceType: 'url',
					sourceUrl: url,
					rawContent: markdown,
					metadata: {
						tags: tags ?? [],
						content_type: 'webpage',
						...metadata,
					},
				});

				// Chunk and embed
				const chunks = await smartChunk(markdown, generateEmbeddings);
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

				// Optional memory extraction
				let memoryResult = null;
				if (extractMemories) {
					if (!config.ENABLE_MEMORY_EXTRACTION || !isExtractionConfigured()) {
						memoryResult = { skipped: true, reason: 'Memory extraction not configured' };
					} else {
						try {
							const { extraction, storage } = await extractAndStoreMemories(markdown, 'document');
							memoryResult = {
								entitiesFound: extraction.entities.length,
								relationsFound: extraction.relations.length,
								observationsCreated: storage.observationsCreated,
								observationsDuplicate: storage.observationsDuplicate,
							};
						} catch (extractError) {
							memoryResult = {
								error: 'Memory extraction failed',
								message: extractError instanceof Error ? extractError.message : 'Unknown error',
							};
						}
					}
				}

				logger.info('URL saved successfully', {
					documentId: document.id,
					chunkCount: chunks.length,
					url,
				});

				const result: Record<string, unknown> = {
					success: true,
					documentId: document.id,
					title: pageTitle,
					url,
					chunksCreated: chunks.length,
					contentLength: markdown.length,
				};
				if (memoryResult) result.memoryExtraction = memoryResult;

				return {
					content: [{ type: 'text' as const, text: JSON.stringify(result, null, 2) }],
				};
			} catch (error) {
				logger.error('save_url failed', {
					error: error instanceof Error ? error.message : String(error),
					url,
				});
				return toolError(error instanceof Error ? error.message : 'Failed to save URL');
			}
		},
	);

	logger.debug('Registered tool: save_url');
}
