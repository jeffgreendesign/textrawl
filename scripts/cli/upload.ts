#!/usr/bin/env npx tsx
/**
 * Markdown Upload Utility
 *
 * Uploads converted markdown files to Supabase with chunking and embeddings
 * Reuses existing services for consistency with the main server
 *
 * Usage:
 *   npm run upload -- <directory> [options]
 *   npx tsx scripts/cli/upload.ts <directory> [options]
 */

import { readFileSync, existsSync, statSync } from 'fs';
import { resolve, relative } from 'path';
import { glob } from 'glob';
import pLimit from 'p-limit';

import { createBaseCommand, addUploadOptions, type UploadOptions } from './lib/args.js';
import { loadCLIConfig, isUploadConfigured } from './lib/config.js';
import { parseFrontmatter } from './lib/frontmatter.js';
import { ManifestManager } from './lib/manifest.js';
import { ProgressReporter, logger } from './lib/progress.js';
import type { UploadResult, DocumentFrontMatter } from './lib/types.js';

// Import existing services from the main project
// These paths work because tsx resolves them at runtime
import { chunkText } from '../../src/services/chunker.js';
import { generateEmbeddings } from '../../src/services/embeddings.js';
import { createDocument } from '../../src/db/documents.js';
import { createChunks, type CreateChunkInput } from '../../src/db/chunks.js';

/**
 * Upload a single markdown file
 */
async function uploadFile(
  filePath: string,
  baseDir: string,
  options: UploadOptions
): Promise<UploadResult> {
  try {
    // Read file
    const content = readFileSync(filePath, 'utf-8');

    // Parse front matter
    const { frontmatter, content: bodyContent } = parseFrontmatter(content);

    // Merge tags from CLI options
    const tags = [...new Set([...(frontmatter.tags || []), ...options.tags])];

    // Check for source hash
    if (!frontmatter.source_hash) {
      return {
        success: false,
        error: 'Missing source_hash in front matter',
      };
    }

    // Create document in Supabase
    const document = await createDocument({
      title: frontmatter.title,
      sourceType: frontmatter.source_type,
      rawContent: bodyContent,
      metadata: {
        ...frontmatter.metadata,
        tags,
        content_type: frontmatter.content_type,
        source_file: frontmatter.source_file,
        source_hash: frontmatter.source_hash,
        created_at: frontmatter.created_at,
        converted_at: frontmatter.converted_at,
      },
    });

    // Chunk the content
    const chunks = chunkText(bodyContent);

    if (chunks.length === 0) {
      return {
        success: true,
        documentId: document.id,
        chunksCreated: 0,
      };
    }

    // Generate embeddings for all chunks
    const chunkContents = chunks.map((c) => c.content);
    const embeddings = await generateEmbeddings(chunkContents);

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

    await createChunks(chunkInputs);

    return {
      success: true,
      documentId: document.id,
      chunksCreated: chunks.length,
    };
  } catch (error) {
    return {
      success: false,
      error: error instanceof Error ? error.message : String(error),
    };
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
  const config = loadCLIConfig(options.config);

  if (!isUploadConfigured(config)) {
    logger.error('Upload not configured. Check SUPABASE_URL, SUPABASE_SERVICE_KEY, and embedding provider.');
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

  // Create progress reporter
  const progress = new ProgressReporter(toUpload.length, { verbose: options.verbose });
  progress.start();

  // Set up concurrency limiter
  const limit = pLimit(options.concurrency);

  let successCount = 0;
  let errorCount = 0;
  let totalChunks = 0;

  // Process files with concurrency
  const uploadPromises = toUpload.map((file, index) =>
    limit(async () => {
      const relativePath = relative(resolvedDir, file);
      progress.update(index, relativePath);

      if (options.dryRun) {
        progress.increment(`[DRY RUN] ${relativePath}`);
        successCount++;
        return;
      }

      const result = await uploadFile(file, resolvedDir, options);

      if (result.success) {
        successCount++;
        totalChunks += result.chunksCreated || 0;

        // Record in manifest
        try {
          const content = readFileSync(file, 'utf-8');
          const { frontmatter } = parseFrontmatter(content);

          manifest.recordUpload({
            sourceHash: frontmatter.source_hash,
            documentId: result.documentId!,
            uploadedAt: new Date().toISOString(),
            markdownPath: relativePath,
            chunksCreated: result.chunksCreated,
          });
        } catch {
          // Ignore manifest errors
        }

        if (options.verbose) {
          progress.log(`  ✓ ${relativePath} → ${result.documentId} (${result.chunksCreated} chunks)`);
        }
      } else {
        errorCount++;
        progress.log(`  ✗ ${relativePath}: ${result.error}`);
      }

      progress.increment();
    })
  );

  // Wait for all uploads
  await Promise.all(uploadPromises);

  // Save manifest
  manifest.save();

  // Finish progress
  progress.finish(`Done: ${successCount} uploaded, ${errorCount} failed`);

  // Summary
  logger.info('\n=== Upload Summary ===');
  logger.info(`Files uploaded: ${successCount}`);
  logger.info(`Chunks created: ${totalChunks}`);
  logger.info(`Errors: ${errorCount}`);
  logger.info(`Manifest location: ${resolvedDir}/.manifest.json`);

  if (errorCount > 0) {
    process.exit(1);
  }
}

// CLI setup
const program = createBaseCommand(
  'upload',
  'Upload converted markdown files to Supabase with chunking and embeddings'
);

addUploadOptions(program);

program
  .argument('<directory>', 'Directory containing markdown files to upload')
  .action(async (directory: string, opts: UploadOptions) => {
    await uploadDocuments(directory, opts);
  });

program.parse();
