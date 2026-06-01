#!/usr/bin/env npx tsx
/**
 * Markdown Upload Utility
 *
 * Uploads converted markdown files to Neon PostgreSQL with chunking and embeddings
 * Reuses existing services for consistency with the main server
 *
 * Usage:
 *   pnpm upload -- <directory> [options]
 *   npx tsx scripts/cli/upload.ts <directory> [options]
 */

// Load .env BEFORE any other imports to ensure env vars are available
// when the main project's config module is loaded
import 'dotenv/config';

import { existsSync, readFileSync, statSync } from 'node:fs';
import { relative, resolve } from 'node:path';
import { glob } from 'glob';
import pLimit from 'p-limit';

import { type UploadOptions, addUploadOptions, createBaseCommand } from './lib/args.js';
import { isUploadConfigured, loadCLIConfig } from './lib/config.js';
import { parseFrontmatter, readFrontmatterHash } from './lib/frontmatter.js';
import { ManifestManager } from './lib/manifest.js';
import { ProgressReporter, logger } from './lib/progress.js';
import { isRateLimitError, isRetryableError, withRetry } from './lib/retry.js';
import { splitFile } from './lib/splitter.js';
import type { DocumentFrontMatter, UploadResult } from './lib/types.js';

import { type CreateChunkInput, createChunks } from '../../src/db/chunks.js';
import { createDocument } from '../../src/db/documents.js';
import { pgQuery } from '../../src/db/pg-client.js';
// Import existing services from the main project
// These paths work because tsx resolves them at runtime
import { chunkText, smartChunk } from '../../src/services/chunker.js';
import { generateEmbeddings } from '../../src/services/embeddings.js';
import { config } from '../../src/utils/config.js';

/** Manifest save interval (every N successful uploads) */
const MANIFEST_SAVE_INTERVAL = 50;

/**
 * Drop the HNSW index on chunks table to speed up bulk inserts.
 * Requires the `drop_chunks_hnsw_index` function from setup-db-bulk-helpers.sql.
 */
async function dropHnswIndex(): Promise<void> {
	const start = Date.now();
	await pgQuery('SELECT drop_chunks_hnsw_index()');
	logger.info(`HNSW index dropped (${Date.now() - start}ms)`);
}

/**
 * Recreate the HNSW index on chunks table after bulk inserts.
 * Requires the `create_chunks_hnsw_index` function from setup-db-bulk-helpers.sql.
 */
async function recreateHnswIndex(): Promise<void> {
	const start = Date.now();
	logger.info('Recreating HNSW index (this may take a while for large datasets)...');
	await pgQuery('SELECT create_chunks_hnsw_index()');
	logger.info(`HNSW index recreated (${((Date.now() - start) / 1000).toFixed(1)}s)`);
}

/** Sleep for a given number of milliseconds */
function sleep(ms: number): Promise<void> {
	return new Promise((resolve) => setTimeout(resolve, ms));
}

/**
 * Parsed and validated file ready for upload
 */
interface PreparedFile {
	filePath: string;
	relativePath: string;
	frontmatter: DocumentFrontMatter;
	bodyContent: string;
	tags: string[];
}

/**
 * Sanitize text for PostgreSQL/PostgREST compatibility.
 * - Strips null bytes (\0) which PostgreSQL text/jsonb columns reject
 * - Replaces invalid Unicode surrogate pairs with U+FFFD
 */
function sanitizeUnicode(text: string): string {
	// Strip null bytes first — PostgreSQL cannot store \0 in text/jsonb,
	// and PostgREST rejects the entire request with "Empty or invalid json"
	// eslint-disable-next-line no-control-regex
	let sanitized = text.replace(/\0/g, '');

	// Replace invalid surrogate pairs with replacement character.
	// The replace callback receives the match offset directly — using
	// indexOf(match) would return the wrong position for repeated characters.
	sanitized = sanitized.replace(/[\uD800-\uDFFF]/g, (match, offset: number) => {
		const code = match.charCodeAt(0);
		// High surrogate (0xD800-0xDBFF) followed by low surrogate = valid pair
		if (code >= 0xd800 && code <= 0xdbff) {
			const next = sanitized.charCodeAt(offset + 1);
			if (next >= 0xdc00 && next <= 0xdfff) {
				return match; // Valid high surrogate, keep it
			}
		}
		// Low surrogate (0xDC00-0xDFFF) preceded by high surrogate = valid pair
		if (code >= 0xdc00 && code <= 0xdfff) {
			const prev = sanitized.charCodeAt(offset - 1);
			if (prev >= 0xd800 && prev <= 0xdbff) {
				return match; // Valid low surrogate, keep it
			}
		}
		// Invalid or unpaired surrogate, replace with \uFFFD
		return '\uFFFD';
	});

	return sanitized;
}

/**
 * Sanitize a metadata object for safe JSONB insertion.
 * - Converts Date objects to ISO strings
 * - Strips undefined, NaN, Infinity, and functions
 * - Validates the result is JSON-serializable
 */
function sanitizeMetadata(obj: Record<string, unknown>): Record<string, unknown> {
	function sanitizeValue(value: unknown): unknown {
		if (value === null || value === undefined) return null;
		if (value instanceof Date) return value.toISOString();
		if (typeof value === 'number' && (!Number.isFinite(value) || Number.isNaN(value))) return null;
		if (typeof value === 'function' || typeof value === 'symbol') return null;
		if (typeof value === 'bigint') return value.toString();
		// Sanitize strings: strip null bytes and fix invalid surrogates
		if (typeof value === 'string') return sanitizeUnicode(value);
		if (Array.isArray(value)) return value.map(sanitizeValue);
		if (typeof value === 'object') {
			const result: Record<string, unknown> = {};
			for (const [k, v] of Object.entries(value as Record<string, unknown>)) {
				const sanitized = sanitizeValue(v);
				if (sanitized !== undefined) {
					result[k] = sanitized;
				}
			}
			return result;
		}
		return value;
	}

	const sanitized = sanitizeValue(obj) as Record<string, unknown>;

	// Final validation: ensure it round-trips through JSON
	try {
		JSON.parse(JSON.stringify(sanitized));
	} catch {
		logger.warn('Metadata failed JSON validation, using empty metadata');
		return {};
	}

	return sanitized;
}

/** Maximum safe payload size for batch INSERT (bytes) */
const MAX_PAYLOAD_SIZE = 5 * 1024 * 1024; // 5MB

/**
 * Estimate the JSON payload size for a createDocument call
 */
function estimatePayloadSize(rawContent: string, metadata: Record<string, unknown>): number {
	// raw_content dominates the payload; metadata is typically small
	return (
		Buffer.byteLength(rawContent, 'utf8') +
		Buffer.byteLength(JSON.stringify(metadata), 'utf8') +
		200
	);
}

/**
 * Prepare a file for upload: read, parse, validate frontmatter and file size
 */
function prepareFile(
	filePath: string,
	baseDir: string,
	options: UploadOptions,
): PreparedFile | { error: string } {
	try {
		const stats = statSync(filePath);
		const sizeMB = stats.size / (1024 * 1024);
		const maxFileSize = options.maxFileSize ?? config.MAX_SINGLE_FILE_SIZE_MB;

		// Hard limit for very large files
		if (sizeMB > maxFileSize) {
			return {
				error: `File too large (${sizeMB.toFixed(1)}MB). Max ${maxFileSize}MB. Split file before upload.`,
			};
		}

		const content = readFileSync(filePath, 'utf-8');
		const { frontmatter, content: bodyContent } = parseFrontmatter(content);
		const tags = [...new Set([...(frontmatter.tags || []), ...options.tags])];

		if (!frontmatter.source_hash) {
			return { error: 'Missing source_hash in front matter' };
		}

		// Estimate chunk count and warn about large files
		const estimatedChunks = Math.max(1, Math.ceil(bodyContent.length / 2048));
		const maxChunksPerFile = config.MAX_CHUNKS_PER_FILE;

		if (estimatedChunks > maxChunksPerFile) {
			const relPath = relative(baseDir, filePath);
			logger.warn(
				`Large file: ${relPath} (${sizeMB.toFixed(1)}MB, est. ${estimatedChunks} chunks)`,
			);

			if (config.CHUNKING_MODE === 'semantic' && !options.allowLarge) {
				if (options.skipLarge) {
					return {
						error: `Skipped: too many chunks (${estimatedChunks}) for semantic mode. Use --allow-large to force.`,
					};
				}
				return {
					error: `Too many chunks (${estimatedChunks}) for semantic mode. Use fixed chunking, --allow-large, or --skip-large.`,
				};
			}

			if (options.skipLarge) {
				return {
					error: `Skipped: file would create ~${estimatedChunks} chunks (>${maxChunksPerFile}). Use --allow-large to force.`,
				};
			}
		}

		// Sanitize content and title to remove null bytes and invalid Unicode
		const sanitizedContent = sanitizeUnicode(bodyContent);
		frontmatter.title = sanitizeUnicode(frontmatter.title);

		return {
			filePath,
			relativePath: relative(baseDir, filePath),
			frontmatter,
			bodyContent: sanitizedContent,
			tags,
		};
	} catch (error) {
		return { error: error instanceof Error ? error.message : String(error) };
	}
}

/**
 * Upload a single file using per-file chunking and embedding (semantic mode or fallback)
 */
async function uploadFileSemantic(
	prepared: PreparedFile,
	options: UploadOptions,
	counters: {
		success: number;
		errors: number;
		chunks: number;
		retries: number;
		rateLimitRetries: number;
	},
): Promise<UploadResult> {
	try {
		// Retry callback to track retry attempts
		const onRetry = (error: unknown) => {
			counters.retries++;
			if (isRateLimitError(error)) {
				counters.rateLimitRetries++;
			}
		};

		const retryOpts = {
			maxRetries: options.maxRetries,
			retryableCheck: isRetryableError,
			onRetry,
		};
		const embeddingRetryOpts = { ...retryOpts, baseDelayMs: 2000 };

		// Build and sanitize metadata for JSONB insertion
		const metadata = sanitizeMetadata({
			...prepared.frontmatter.metadata,
			tags: prepared.tags,
			content_type: prepared.frontmatter.content_type,
			source_file: prepared.frontmatter.source_file,
			source_hash: prepared.frontmatter.source_hash,
			created_at: prepared.frontmatter.created_at,
			converted_at: prepared.frontmatter.converted_at,
		});

		// Check payload size before sending to database
		const payloadSize = estimatePayloadSize(prepared.bodyContent, metadata);
		if (payloadSize > MAX_PAYLOAD_SIZE) {
			const sizeMB = (payloadSize / (1024 * 1024)).toFixed(1);
			return {
				success: false,
				error: `Payload too large (${sizeMB}MB). Split file before upload or increase PostgREST body limit.`,
			};
		}

		if (options.verbose) {
			logger.info(
				`Payload: ${(payloadSize / 1024).toFixed(0)}KB, metadata keys: ${Object.keys(metadata).join(', ')}`,
			);
		}

		// Create document in database
		const document = await withRetry(
			() =>
				createDocument({
					title: prepared.frontmatter.title,
					sourceType: prepared.frontmatter.source_type,
					rawContent: prepared.bodyContent,
					metadata,
				}),
			retryOpts,
		);

		// Check content size before semantic chunking - fall back to fixed for large files
		// to prevent memory exhaustion (semantic mode generates embeddings per sentence)
		// Use Buffer.byteLength for accurate byte count (string.length counts UTF-16 code units)
		const contentSizeMB = Buffer.byteLength(prepared.bodyContent, 'utf8') / (1024 * 1024);
		let chunks: {
			content: string;
			index: number;
			startOffset: number;
			endOffset: number;
			tokenCount: number;
		}[];

		if (contentSizeMB > 5) {
			logger.warn(`Large file (${contentSizeMB.toFixed(1)}MB) - falling back to fixed chunking`);
			chunks = chunkText(prepared.bodyContent);
		} else {
			// Chunk the content (semantic mode calls generateEmbeddings internally)
			chunks = await withRetry(() => smartChunk(prepared.bodyContent, generateEmbeddings), {
				...retryOpts,
				maxRetries: 2,
			});
		}

		if (chunks.length === 0) {
			return {
				success: true,
				documentId: document.id,
				chunksCreated: 0,
				sourceHash: prepared.frontmatter.source_hash,
			};
		}

		// Generate embeddings for all chunks
		const chunkContents = chunks.map((c) => c.content);
		const embeddings = await withRetry(() => generateEmbeddings(chunkContents), embeddingRetryOpts);

		// Delay after embedding generation to avoid rate limits
		if (options.embeddingDelay > 0) {
			await sleep(options.embeddingDelay);
		}

		// Create chunk records
		const chunkInputs: CreateChunkInput[] = chunks.map((chunk, i) => ({
			documentId: document.id,
			content: chunk.content,
			chunkIndex: chunk.index,
			startOffset: chunk.startOffset,
			endOffset: chunk.endOffset,
			embedding: embeddings[i],
			metadata: { tokenCount: chunk.tokenCount },
		}));

		await withRetry(() => createChunks(chunkInputs, options.chunkBatchSize), retryOpts);

		return {
			success: true,
			documentId: document.id,
			chunksCreated: chunks.length,
			sourceHash: prepared.frontmatter.source_hash,
		};
	} catch (error) {
		return {
			success: false,
			error: error instanceof Error ? error.message : String(error),
		};
	}
}

/**
 * Streaming batched upload for fixed chunking mode.
 * Phase 1: Chunk all files locally (CPU-only, no API calls)
 * Phase 2+3: Per-file streaming embed + insert in sub-batches of 50
 *
 * Only one sub-batch of embeddings is in memory at a time, preventing
 * OOM on files that produce thousands of chunks.
 */
async function uploadBatchedFixed(
	preparedFiles: PreparedFile[],
	options: UploadOptions,
	manifest: ManifestManager,
	progress: ProgressReporter,
	counters: {
		success: number;
		errors: number;
		chunks: number;
		retries: number;
		rateLimitRetries: number;
	},
): Promise<void> {
	// Retry callback to track retry attempts
	const onRetry = (error: unknown) => {
		counters.retries++;
		if (isRateLimitError(error)) {
			counters.rateLimitRetries++;
		}
	};

	const retryOpts = {
		maxRetries: options.maxRetries,
		retryableCheck: isRetryableError,
		onRetry,
	};
	const embeddingRetryOpts = { ...retryOpts, baseDelayMs: 2000 };

	// Phase 1: Chunk all files locally (no network calls)
	interface ChunkedFile {
		prepared: PreparedFile;
		chunks: {
			content: string;
			index: number;
			startOffset: number;
			endOffset: number;
			tokenCount: number;
		}[];
	}

	const chunkedFiles: ChunkedFile[] = [];
	const chunkErrors: { relativePath: string; error: string }[] = [];

	for (const prepared of preparedFiles) {
		try {
			const chunks = chunkText(prepared.bodyContent);
			chunkedFiles.push({ prepared, chunks });
		} catch (error) {
			chunkErrors.push({
				relativePath: prepared.relativePath,
				error: error instanceof Error ? error.message : String(error),
			});
		}
	}

	for (const err of chunkErrors) {
		counters.errors++;
		progress.logError(`  \u2717 ${err.relativePath}: ${err.error}`);
		progress.increment();
	}

	if (chunkedFiles.length === 0) {
		return;
	}

	// Phase 2+3: Per-file streaming embed + insert
	// Embeds and inserts chunks in sub-batches of 50 so that only one
	// sub-batch of embeddings is in memory at a time. This prevents OOM
	// on files that produce thousands of chunks (e.g. 8MB -> 4000+ chunks).
	const EMBEDDING_SUB_BATCH_SIZE = 50;

	for (const cf of chunkedFiles) {
		// Inter-file delay to reduce DB pressure
		if (options.delay > 0) {
			await sleep(options.delay);
		}

		try {
			// Build and sanitize metadata for JSONB insertion
			const metadata = sanitizeMetadata({
				...cf.prepared.frontmatter.metadata,
				tags: cf.prepared.tags,
				content_type: cf.prepared.frontmatter.content_type,
				source_file: cf.prepared.frontmatter.source_file,
				source_hash: cf.prepared.frontmatter.source_hash,
				created_at: cf.prepared.frontmatter.created_at,
				converted_at: cf.prepared.frontmatter.converted_at,
			});

			// Check payload size before sending to database
			const payloadSize = estimatePayloadSize(cf.prepared.bodyContent, metadata);
			if (payloadSize > MAX_PAYLOAD_SIZE) {
				const sizeMB = (payloadSize / (1024 * 1024)).toFixed(1);
				throw new Error(
					`Payload too large (${sizeMB}MB). Split file before upload or increase PostgREST body limit.`,
				);
			}

			if (options.verbose) {
				logger.info(
					`Payload: ${(payloadSize / 1024).toFixed(0)}KB, metadata keys: ${Object.keys(metadata).join(', ')}`,
				);
			}

			// Create document
			const document = await withRetry(
				() =>
					createDocument({
						title: cf.prepared.frontmatter.title,
						sourceType: cf.prepared.frontmatter.source_type,
						rawContent: cf.prepared.bodyContent,
						metadata,
					}),
				retryOpts,
			);

			// Release the large rawContent string now that the document is created
			cf.prepared.bodyContent = '';

			// Stream embed + insert in sub-batches
			if (cf.chunks.length > 0) {
				for (let i = 0; i < cf.chunks.length; i += EMBEDDING_SUB_BATCH_SIZE) {
					const subBatchChunks = cf.chunks.slice(i, i + EMBEDDING_SUB_BATCH_SIZE);
					const subBatchTexts = subBatchChunks.map((c) => c.content);

					const subBatchEmbeddings = await withRetry(
						() => generateEmbeddings(subBatchTexts),
						embeddingRetryOpts,
					);

					// Delay between embedding requests to avoid rate limits
					if (options.embeddingDelay > 0 && i + EMBEDDING_SUB_BATCH_SIZE < cf.chunks.length) {
						await sleep(options.embeddingDelay);
					}

					const chunkInputs: CreateChunkInput[] = subBatchChunks.map((chunk, ci) => ({
						documentId: document.id,
						content: chunk.content,
						chunkIndex: chunk.index,
						startOffset: chunk.startOffset,
						endOffset: chunk.endOffset,
						embedding: subBatchEmbeddings[ci],
						metadata: { tokenCount: chunk.tokenCount },
					}));

					await withRetry(() => createChunks(chunkInputs, options.chunkBatchSize), retryOpts);

					// Release chunk content strings to break V8 SlicedString
					// references back to the large parent string
					for (const chunk of subBatchChunks) {
						(chunk as { content: string }).content = '';
					}

					// Help V8 reclaim sub-batch memory for large files
					if (cf.chunks.length > 200 && global.gc) {
						global.gc();
					}
				}
			}

			counters.success++;
			counters.chunks += cf.chunks.length;

			// Record in manifest
			manifest.recordUpload({
				sourceHash: cf.prepared.frontmatter.source_hash,
				documentId: document.id,
				uploadedAt: new Date().toISOString(),
				markdownPath: cf.prepared.relativePath,
				chunksCreated: cf.chunks.length,
			});

			if (counters.success % MANIFEST_SAVE_INTERVAL === 0) {
				manifest.save();
			}

			if (options.verbose) {
				progress.log(
					`  \u2713 ${cf.prepared.relativePath} \u2192 ${document.id} (${cf.chunks.length} chunks)`,
				);
			}
		} catch (error) {
			counters.errors++;
			progress.logError(
				`  \u2717 ${cf.prepared.relativePath}: ${error instanceof Error ? error.message : String(error)}`,
			);
		}

		progress.increment();
	}
}

/**
 * Main upload function
 */
async function uploadDocuments(directory: string, options: UploadOptions): Promise<void> {
	const resolvedDir = resolve(directory);

	// Check directory exists
	if (!existsSync(resolvedDir)) {
		logger.error(`Directory not found: ${resolvedDir}`);
		process.exit(1);
	}

	if (!statSync(resolvedDir).isDirectory()) {
		logger.error(`Not a directory: ${resolvedDir}`);
		process.exit(1);
	}

	// Load configuration
	logger.info('Loading configuration...');
	const cliConfig = loadCLIConfig(options.config);

	if (!isUploadConfigured(cliConfig)) {
		logger.error('Upload not configured. Check DATABASE_URL and embedding provider.');
		process.exit(1);
	}

	// Initialize manifest
	const manifest = new ManifestManager(resolvedDir);
	const manifestStats = manifest.getStats();
	logger.info(`Manifest: ${manifestStats.totalFiles} files already uploaded`);

	// Find markdown files
	const pattern = options.recursive ? options.pattern : options.pattern.replace('**/', '');
	const files = await glob(pattern, { cwd: resolvedDir, absolute: true });

	if (files.length === 0) {
		logger.error(`No files found matching pattern: ${pattern}`);
		process.exit(1);
	}

	logger.info(`Found ${files.length} file(s)`);

	// Filter already uploaded files (unless --force)
	let toUpload = files;

	if (!options.force) {
		toUpload = files.filter((file) => {
			try {
				// Read only the first few KB to extract source_hash — avoids
				// loading entire files (some 8MB+) just for the manifest check.
				const hash = readFrontmatterHash(file);
				if (hash === null) return true; // Can't parse, try uploading
				return !manifest.isUploaded(hash);
			} catch {
				return true; // Try to upload if we can't read
			}
		});

		const skippedCount = files.length - toUpload.length;
		if (skippedCount > 0) {
			logger.info(`Skipping ${skippedCount} already-uploaded file(s)`);
		}
	}

	if (toUpload.length === 0) {
		logger.info('No new files to upload');
		return;
	}

	// Auto-split preprocessing: split oversized files before uploading
	if (options.autoSplit) {
		const maxFileSize = options.maxFileSize ?? config.MAX_SINGLE_FILE_SIZE_MB;
		const maxChunks = config.MAX_CHUNKS_PER_FILE;
		const expanded: string[] = [];

		for (const file of toUpload) {
			const stats = statSync(file);
			const sizeMB = stats.size / (1024 * 1024);
			const content = readFileSync(file, 'utf-8');
			const estChunks = Math.max(1, Math.ceil(content.length / 2048));

			if (sizeMB > maxFileSize || estChunks > maxChunks) {
				const relPath = relative(resolvedDir, file);
				logger.info(`Auto-splitting: ${relPath} (${sizeMB.toFixed(1)}MB, ~${estChunks} chunks)`);

				const result = splitFile(file, {
					splitLevel: options.autoSplitLevel,
					targetChunks: Math.min(maxChunks, 400),
					targetSize: Math.min(maxFileSize, 15),
					suffix: '-part-{n}',
					onlyOversized: false,
					maxFileSize,
					maxChunks,
					dryRun: options.dryRun,
				});

				if (result.wasSplit && result.partPaths.length > 0) {
					logger.info(`  -> ${result.partCount} parts created`);
					expanded.push(...result.partPaths);
				} else if (result.error) {
					logger.error(`  Auto-split failed: ${result.error}`);
					expanded.push(file); // Try uploading original
				} else {
					expanded.push(file); // Didn't need splitting after all
				}
			} else {
				expanded.push(file);
			}
		}

		toUpload = expanded;
	}

	logger.info(`Uploading ${toUpload.length} file(s)...`);
	const insertConcurrency = options.insertConcurrency ?? options.concurrency;
	logger.info(
		`Chunking mode: ${config.CHUNKING_MODE}, Concurrency: ${options.concurrency}, Insert concurrency: ${insertConcurrency}, Max retries: ${options.maxRetries}`,
	);
	if (options.delay > 0) {
		logger.info(`Inter-batch delay: ${options.delay}ms`);
	}
	if (options.chunkBatchSize !== 50) {
		logger.info(`Chunk insert batch size: ${options.chunkBatchSize}`);
	}

	// Drop HNSW index before bulk upload if requested
	if (options.dropIndex) {
		try {
			await dropHnswIndex();
		} catch (error) {
			logger.error(
				`Failed to drop HNSW index: ${error instanceof Error ? error.message : String(error)}`,
			);
			logger.error('Ensure setup-db-bulk-helpers.sql has been run. Continuing without index drop.');
		}
	}

	// Create progress reporter
	const progress = new ProgressReporter(toUpload.length, { verbose: options.verbose });
	progress.start();

	const counters = {
		success: 0,
		errors: 0,
		chunks: 0,
		retries: 0,
		rateLimitRetries: 0,
	};

	if (config.CHUNKING_MODE === 'fixed') {
		// Two-phase batched pipeline for fixed chunking
		// Adaptive batching: cap total chunks per batch to avoid OOM on large files.
		// Some files produce 800+ chunks each, so a fixed file count is unreliable.
		// Dynamically reduce batch limits when individual files are large.
		// Base limits already conservative (10/200) per main branch hardening.
		const MAX_FILES_PER_BATCH = 10;
		const MAX_CHUNKS_PER_BATCH = 200;
		const LARGE_FILE_THRESHOLD = 100; // Chunks per file that triggers dynamic reduction

		let prepared: PreparedFile[] = [];
		let estimatedChunks = 0;
		// Track batch-level limits: once a large file enters a batch, caps stay reduced
		let batchMaxFiles = MAX_FILES_PER_BATCH;
		let batchMaxChunks = MAX_CHUNKS_PER_BATCH;

		const flushBatch = async () => {
			if (prepared.length > 0 && !options.dryRun) {
				await uploadBatchedFixed(prepared, options, manifest, progress, counters);
			}
			// Clear references to help garbage collection
			prepared.length = 0;
			prepared = [];
			estimatedChunks = 0;
			batchMaxFiles = MAX_FILES_PER_BATCH;
			batchMaxChunks = MAX_CHUNKS_PER_BATCH;
			// Suggest GC (non-blocking hint)
			if (global.gc) {
				global.gc();
			}
		};

		for (const file of toUpload) {
			if (options.dryRun) {
				progress.increment(`[DRY RUN] ${relative(resolvedDir, file)}`);
				counters.success++;
				continue;
			}

			const result = prepareFile(file, resolvedDir, options);
			if ('error' in result) {
				counters.errors++;
				progress.logError(`  \u2717 ${relative(resolvedDir, file)}: ${result.error}`);
				progress.increment();
				continue;
			}

			// Estimate chunk count from content length (~4 chars per token, ~512 tokens per chunk)
			const estChunks = Math.max(1, Math.ceil(result.bodyContent.length / 2048));

			if (estChunks > config.MAX_CHUNKS_PER_FILE) {
				logger.warn(`Large file: ${result.relativePath} (~${estChunks} chunks)`);
			}

			// Compute per-file limits and tighten batch caps if this file is large
			const fileMaxFiles = estChunks > LARGE_FILE_THRESHOLD ? 5 : MAX_FILES_PER_BATCH;
			const fileMaxChunks = estChunks > LARGE_FILE_THRESHOLD ? 100 : MAX_CHUNKS_PER_BATCH;

			// Flush existing batch first if adding this file would exceed limits
			if (
				prepared.length > 0 &&
				(prepared.length + 1 > batchMaxFiles || estimatedChunks + estChunks > batchMaxChunks)
			) {
				await flushBatch();
			}

			// Ratchet down batch limits (sticky: once reduced, stays reduced for this batch)
			batchMaxFiles = Math.min(batchMaxFiles, fileMaxFiles);
			batchMaxChunks = Math.min(batchMaxChunks, fileMaxChunks);

			prepared.push(result);
			estimatedChunks += estChunks;

			// Also flush if this single file already fills a batch
			if (prepared.length >= batchMaxFiles || estimatedChunks >= batchMaxChunks) {
				await flushBatch();
			}
		}

		// Flush remaining files
		await flushBatch();
	} else {
		// Per-file processing for semantic chunking mode
		const semanticConcurrency = options.insertConcurrency ?? options.concurrency;
		const limit = pLimit(semanticConcurrency);

		const uploadPromises = toUpload.map((file, index) =>
			limit(async () => {
				const relativePath = relative(resolvedDir, file);
				progress.update(index, relativePath);

				if (options.dryRun) {
					progress.increment(`[DRY RUN] ${relativePath}`);
					counters.success++;
					return;
				}

				// Inter-file delay to reduce DB pressure
				if (options.delay > 0) {
					await sleep(options.delay);
				}

				const prepResult = prepareFile(file, resolvedDir, options);
				if ('error' in prepResult) {
					counters.errors++;
					progress.logError(`  \u2717 ${relativePath}: ${prepResult.error}`);
					progress.increment();
					return;
				}

				const result = await uploadFileSemantic(prepResult, options, counters);

				if (result.success) {
					counters.success++;
					counters.chunks += result.chunksCreated || 0;

					// Record in manifest (sourceHash already available, no re-read needed)
					if (result.sourceHash && result.documentId) {
						manifest.recordUpload({
							sourceHash: result.sourceHash,
							documentId: result.documentId,
							uploadedAt: new Date().toISOString(),
							markdownPath: relativePath,
							chunksCreated: result.chunksCreated,
						});
					}

					if (counters.success % MANIFEST_SAVE_INTERVAL === 0) {
						manifest.save();
					}

					if (options.verbose) {
						progress.log(
							`  \u2713 ${relativePath} \u2192 ${result.documentId} (${result.chunksCreated} chunks)`,
						);
					}
				} else {
					counters.errors++;
					progress.logError(`  \u2717 ${relativePath}: ${result.error}`);
				}

				progress.increment();
			}),
		);

		await Promise.all(uploadPromises);
	}

	// Recreate HNSW index if it was dropped
	if (options.dropIndex) {
		progress.finish('Inserts complete. Recreating HNSW index...');
		try {
			await recreateHnswIndex();
		} catch (error) {
			logger.error(
				`Failed to recreate HNSW index: ${error instanceof Error ? error.message : String(error)}`,
			);
			logger.error(
				'Run manually: CREATE INDEX chunks_embedding_idx ON chunks USING hnsw (embedding vector_cosine_ops);',
			);
		}
	}

	// Save manifest (final save catches anything since last periodic save)
	manifest.save();

	// Finish progress (no-op if already called above, but needed for non-drop-index path)
	progress.finish(`Done: ${counters.success} uploaded, ${counters.errors} failed`);

	// Summary
	logger.info('\n=== Upload Summary ===');
	logger.info(`Files uploaded: ${counters.success}`);
	logger.info(`Chunks created: ${counters.chunks}`);
	logger.info(`Errors: ${counters.errors}`);
	if (counters.retries > 0) {
		logger.info(`Retries: ${counters.retries} (${counters.rateLimitRetries} rate limit)`);
	}
	logger.info(`Manifest location: ${resolvedDir}/.manifest.json`);

	// Provide suggestions if rate limits were encountered
	if (counters.rateLimitRetries > 10) {
		logger.warn('\n⚠️  High rate limit retries detected. To reduce rate limiting:');
		logger.warn('   • Use --concurrency 2 (or lower) to reduce parallel requests');
		logger.warn('   • Use --embedding-delay 1000 to add 1s delay between embedding requests');
		logger.warn('   • Check your OpenAI usage tier: https://platform.openai.com/account/limits');
	} else if (counters.rateLimitRetries > 0) {
		logger.info(
			'\nℹ️  Some rate limits encountered. Consider --embedding-delay or lower --concurrency for smoother uploads.',
		);
	}

	if (counters.errors > 0) {
		process.exit(1);
	}
}

// CLI setup
const program = createBaseCommand(
	'upload',
	'Upload converted markdown files to PostgreSQL with chunking and embeddings',
);

addUploadOptions(program);

program
	.argument('<directory>', 'Directory containing markdown files to upload')
	.action(async (directory: string, opts: UploadOptions) => {
		await uploadDocuments(directory, opts);
	});

// pnpm passes '--' through to the script, which Commander treats as
// end-of-options (all subsequent flags become positional args and are ignored).
// Strip it so flags like --concurrency work when invoked via pnpm.
const argv = process.argv.filter((arg, i) => !(i === 2 && arg === '--'));
program.parse(argv);
