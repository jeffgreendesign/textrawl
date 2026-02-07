#!/usr/bin/env npx tsx
/**
 * Markdown Upload Utility
 *
 * Uploads converted markdown files to Supabase with chunking and embeddings
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
import { parseFrontmatter } from './lib/frontmatter.js';
import { ManifestManager } from './lib/manifest.js';
import { ProgressReporter, logger } from './lib/progress.js';
import { isRetryableError, withRetry } from './lib/retry.js';
import type { DocumentFrontMatter, UploadResult } from './lib/types.js';

import { type CreateChunkInput, createChunks } from '../../src/db/chunks.js';
import { createDocument } from '../../src/db/documents.js';
// Import existing services from the main project
// These paths work because tsx resolves them at runtime
import { chunkText, smartChunk } from '../../src/services/chunker.js';
import { generateEmbeddings } from '../../src/services/embeddings.js';
import { config } from '../../src/utils/config.js';

/** Manifest save interval (every N successful uploads) */
const MANIFEST_SAVE_INTERVAL = 50;

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
 * Prepare a file for upload: read, parse, validate frontmatter
 */
function prepareFile(
	filePath: string,
	baseDir: string,
	options: UploadOptions,
): PreparedFile | { error: string } {
	try {
		const content = readFileSync(filePath, 'utf-8');
		const { frontmatter, content: bodyContent } = parseFrontmatter(content);
		const tags = [...new Set([...(frontmatter.tags || []), ...options.tags])];

		if (!frontmatter.source_hash) {
			return { error: 'Missing source_hash in front matter' };
		}

		return {
			filePath,
			relativePath: relative(baseDir, filePath),
			frontmatter,
			bodyContent,
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
): Promise<UploadResult> {
	try {
		const retryOpts = { maxRetries: options.maxRetries, retryableCheck: isRetryableError };
		const embeddingRetryOpts = { ...retryOpts, baseDelayMs: 2000 };

		// Create document in Supabase
		const document = await withRetry(
			() =>
				createDocument({
					title: prepared.frontmatter.title,
					sourceType: prepared.frontmatter.source_type,
					rawContent: prepared.bodyContent,
					metadata: {
						...prepared.frontmatter.metadata,
						tags: prepared.tags,
						content_type: prepared.frontmatter.content_type,
						source_file: prepared.frontmatter.source_file,
						source_hash: prepared.frontmatter.source_hash,
						created_at: prepared.frontmatter.created_at,
						converted_at: prepared.frontmatter.converted_at,
					},
				}),
			retryOpts,
		);

		// Chunk the content (semantic mode calls generateEmbeddings internally)
		const chunks = await withRetry(() => smartChunk(prepared.bodyContent, generateEmbeddings), {
			...retryOpts,
			maxRetries: 2,
		});

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

		await withRetry(() => createChunks(chunkInputs), retryOpts);

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
 * Two-phase batched upload for fixed chunking mode.
 * Phase 1: Prepare and chunk all files (CPU-only, no API calls)
 * Phase 2: Batch embed all chunks across files, then insert
 */
async function uploadBatchedFixed(
	preparedFiles: PreparedFile[],
	options: UploadOptions,
	manifest: ManifestManager,
	progress: ProgressReporter,
	counters: { success: number; errors: number; chunks: number },
): Promise<void> {
	const retryOpts = { maxRetries: options.maxRetries, retryableCheck: isRetryableError };
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
		progress.logError(`  ✗ ${err.relativePath}: ${err.error}`);
		progress.increment();
	}

	if (chunkedFiles.length === 0) {
		return;
	}

	// Phase 2: Batch embed all chunks across all files
	const allChunkTexts: string[] = [];
	const chunkFileMap: { fileIndex: number; chunkIndex: number }[] = [];

	for (let fi = 0; fi < chunkedFiles.length; fi++) {
		for (let ci = 0; ci < chunkedFiles[fi].chunks.length; ci++) {
			allChunkTexts.push(chunkedFiles[fi].chunks[ci].content);
			chunkFileMap.push({ fileIndex: fi, chunkIndex: ci });
		}
	}

	let allEmbeddings: number[][];
	try {
		allEmbeddings = await withRetry(() => generateEmbeddings(allChunkTexts), embeddingRetryOpts);
	} catch (error) {
		// If batch embedding fails entirely, mark all files as failed
		const errMsg = error instanceof Error ? error.message : String(error);
		for (const cf of chunkedFiles) {
			counters.errors++;
			progress.logError(`  ✗ ${cf.prepared.relativePath}: Embedding failed: ${errMsg}`);
			progress.increment();
		}
		return;
	}

	// Distribute embeddings back to files
	const fileEmbeddings: number[][][] = chunkedFiles.map(() => []);
	for (let i = 0; i < chunkFileMap.length; i++) {
		const { fileIndex, chunkIndex } = chunkFileMap[i];
		fileEmbeddings[fileIndex][chunkIndex] = allEmbeddings[i];
	}

	// Phase 3: Insert documents and chunks concurrently
	const insertLimit = pLimit(options.concurrency);

	const insertPromises = chunkedFiles.map((cf, fileIndex) =>
		insertLimit(async () => {
			progress.update(0, cf.prepared.relativePath);

			try {
				// Create document
				const document = await withRetry(
					() =>
						createDocument({
							title: cf.prepared.frontmatter.title,
							sourceType: cf.prepared.frontmatter.source_type,
							rawContent: cf.prepared.bodyContent,
							metadata: {
								...cf.prepared.frontmatter.metadata,
								tags: cf.prepared.tags,
								content_type: cf.prepared.frontmatter.content_type,
								source_file: cf.prepared.frontmatter.source_file,
								source_hash: cf.prepared.frontmatter.source_hash,
								created_at: cf.prepared.frontmatter.created_at,
								converted_at: cf.prepared.frontmatter.converted_at,
							},
						}),
					retryOpts,
				);

				if (cf.chunks.length > 0) {
					const chunkInputs: CreateChunkInput[] = cf.chunks.map((chunk, ci) => ({
						documentId: document.id,
						content: chunk.content,
						chunkIndex: chunk.index,
						startOffset: chunk.startOffset,
						endOffset: chunk.endOffset,
						embedding: fileEmbeddings[fileIndex][ci],
						metadata: { tokenCount: chunk.tokenCount },
					}));

					await withRetry(() => createChunks(chunkInputs), retryOpts);
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
						`  ✓ ${cf.prepared.relativePath} → ${document.id} (${cf.chunks.length} chunks)`,
					);
				}
			} catch (error) {
				counters.errors++;
				progress.logError(
					`  ✗ ${cf.prepared.relativePath}: ${error instanceof Error ? error.message : String(error)}`,
				);
			}

			progress.increment();
		}),
	);

	await Promise.all(insertPromises);
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
		logger.error(
			'Upload not configured. Check SUPABASE_URL, SUPABASE_SERVICE_KEY, and embedding provider.',
		);
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
				const content = readFileSync(file, 'utf-8');
				const { frontmatter } = parseFrontmatter(content);
				return !manifest.isUploaded(frontmatter.source_hash);
			} catch {
				return true; // Try to upload if we can't parse
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

	logger.info(`Uploading ${toUpload.length} file(s)...`);
	logger.info(
		`Chunking mode: ${config.CHUNKING_MODE}, Concurrency: ${options.concurrency}, Max retries: ${options.maxRetries}`,
	);

	// Create progress reporter
	const progress = new ProgressReporter(toUpload.length, { verbose: options.verbose });
	progress.start();

	const counters = { success: 0, errors: 0, chunks: 0 };

	if (config.CHUNKING_MODE === 'fixed') {
		// Two-phase batched pipeline for fixed chunking
		// Prepare all files first (CPU-only)
		const prepared: PreparedFile[] = [];
		for (const file of toUpload) {
			if (options.dryRun) {
				progress.increment(`[DRY RUN] ${relative(resolvedDir, file)}`);
				counters.success++;
				continue;
			}

			const result = prepareFile(file, resolvedDir, options);
			if ('error' in result) {
				counters.errors++;
				progress.logError(`  ✗ ${relative(resolvedDir, file)}: ${result.error}`);
				progress.increment();
			} else {
				prepared.push(result);
			}
		}

		if (prepared.length > 0 && !options.dryRun) {
			// Process in batches to avoid holding too many embeddings in memory
			const BATCH_SIZE = 200;
			for (let i = 0; i < prepared.length; i += BATCH_SIZE) {
				const batch = prepared.slice(i, i + BATCH_SIZE);
				await uploadBatchedFixed(batch, options, manifest, progress, counters);
			}
		}
	} else {
		// Per-file processing for semantic chunking mode
		const limit = pLimit(options.concurrency);

		const uploadPromises = toUpload.map((file, index) =>
			limit(async () => {
				const relativePath = relative(resolvedDir, file);
				progress.update(index, relativePath);

				if (options.dryRun) {
					progress.increment(`[DRY RUN] ${relativePath}`);
					counters.success++;
					return;
				}

				const prepResult = prepareFile(file, resolvedDir, options);
				if ('error' in prepResult) {
					counters.errors++;
					progress.logError(`  ✗ ${relativePath}: ${prepResult.error}`);
					progress.increment();
					return;
				}

				const result = await uploadFileSemantic(prepResult, options);

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
							`  ✓ ${relativePath} → ${result.documentId} (${result.chunksCreated} chunks)`,
						);
					}
				} else {
					counters.errors++;
					progress.logError(`  ✗ ${relativePath}: ${result.error}`);
				}

				progress.increment();
			}),
		);

		await Promise.all(uploadPromises);
	}

	// Save manifest (final save catches anything since last periodic save)
	manifest.save();

	// Finish progress
	progress.finish(`Done: ${counters.success} uploaded, ${counters.errors} failed`);

	// Summary
	logger.info('\n=== Upload Summary ===');
	logger.info(`Files uploaded: ${counters.success}`);
	logger.info(`Chunks created: ${counters.chunks}`);
	logger.info(`Errors: ${counters.errors}`);
	logger.info(`Manifest location: ${resolvedDir}/.manifest.json`);

	if (counters.errors > 0) {
		process.exit(1);
	}
}

// CLI setup
const program = createBaseCommand(
	'upload',
	'Upload converted markdown files to Supabase with chunking and embeddings',
);

addUploadOptions(program);

program
	.argument('<directory>', 'Directory containing markdown files to upload')
	.action(async (directory: string, opts: UploadOptions) => {
		await uploadDocuments(directory, opts);
	});

program.parse();
