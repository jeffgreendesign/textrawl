#!/usr/bin/env npx tsx
/**
 * File Scanner Utility
 *
 * Analyzes markdown files for upload readiness — shows sizes, estimated chunks,
 * heading structure, and identifies files that need splitting before upload.
 *
 * Usage:
 *   pnpm scan -- <directory-or-file> [options]
 *   pnpm scan -- ./converted/ --all
 *   pnpm scan -- ./converted/large-file.md
 */

import { existsSync, statSync } from 'node:fs';
import { resolve } from 'node:path';
import { glob } from 'glob';

import { type ScanOptions, addScanOptions, createBaseCommand } from './lib/args.js';
import { logger } from './lib/progress.js';
import { scanFile, scanFiles } from './lib/scanner.js';
import type { ScanFileResult, ScanSummary } from './lib/types.js';

/**
 * Format a file status indicator
 */
function statusIcon(result: ScanFileResult): string {
	if (result.error) return '\u2717 ERROR';
	if (result.exceedsFileSize) return '\u2717 SIZE';
	if (result.exceedsChunkLimit) return '\u2717 CHUNKS';
	return '\u2713 OK';
}

/**
 * Render scan results as a table to stderr
 */
function renderTable(summary: ScanSummary, options: ScanOptions): void {
	const filesToShow = options.all
		? summary.files
		: summary.files.filter((f) => !f.uploadable || f.error);

	logger.info('\n=== Upload Readiness Scan ===');
	logger.info(`File size limit: ${options.maxFileSize} MB | Chunk limit: ${options.maxChunks}\n`);

	if (filesToShow.length === 0 && !options.all) {
		logger.info('All files are within upload limits.');
	} else {
		// Column headers
		const header = `  ${'STATUS'.padEnd(12)} ${'SIZE'.padStart(10)} ${'CHUNKS'.padStart(8)}  FILE`;
		logger.info(header);

		for (const f of filesToShow) {
			const status = statusIcon(f);
			const size = f.error ? '-' : `${f.fileSizeMB.toFixed(1)} MB`;
			const chunks = f.error ? '-' : `~${f.estimatedChunks}`;
			const line = `  ${status.padEnd(12)} ${size.padStart(10)} ${chunks.padStart(8)}  ${f.relativePath}`;
			logger.info(line);

			if (f.error) {
				logger.info(`${''.padStart(36)}${f.error}`);
			}
		}
	}

	// Summary
	logger.info('\n=== Summary ===');
	logger.info(
		`Total: ${summary.totalFiles} | Uploadable: ${summary.uploadableFiles} | Need splitting: ${summary.needsSplitting}`,
	);
	logger.info(`Estimated total chunks: ~${summary.totalEstimatedChunks.toLocaleString()}`);

	// Suggestions for oversized files
	const oversized = summary.files.filter((f) => !f.uploadable && !f.error);
	if (oversized.length > 0) {
		logger.info('\n=== Suggested Splits ===');
		for (const f of oversized) {
			const h2Count = f.headings.filter((h) => h.level <= 2).length;
			const splitParts = f.suggestedSplitPoints.length + 1;
			if (h2Count > 0) {
				logger.info(
					`${f.relativePath}: ${h2Count} h2 headings -> split at h2 would create ~${splitParts} parts`,
				);
			} else {
				const h3Count = f.headings.filter((h) => h.level <= 3).length;
				if (h3Count > 0) {
					logger.info(`${f.relativePath}: no h2 headings, ${h3Count} h3 -> try --split-level 3`);
				} else {
					logger.info(`${f.relativePath}: no headings found -> will split at paragraph boundaries`);
				}
			}
			logger.info(`  Run: pnpm split -- ${f.relativePath}`);
		}
	}
}

/**
 * Render detailed analysis for a single file
 */
function renderSingleFile(result: ScanFileResult): void {
	logger.info(`\n=== File Analysis: ${result.relativePath} ===`);

	if (result.error) {
		logger.error(`Error: ${result.error}`);
		return;
	}

	logger.info(`Title: ${result.title || '(no frontmatter)'}`);
	logger.info(
		`Size: ${result.fileSizeMB.toFixed(2)} MB (${result.fileSizeBytes.toLocaleString()} bytes)`,
	);
	logger.info(`Estimated chunks: ~${result.estimatedChunks}`);
	logger.info(`Valid frontmatter: ${result.hasValidFrontmatter ? 'yes' : 'no'}`);
	logger.info(`Uploadable: ${result.uploadable ? 'yes' : 'no'}`);

	if (result.exceedsFileSize) {
		logger.warn('Exceeds file size limit');
	}
	if (result.exceedsChunkLimit) {
		logger.warn('Exceeds chunk count limit');
	}

	// Heading tree
	if (result.headings.length > 0) {
		logger.info(`\n--- Heading Structure (${result.headings.length} headings) ---`);
		for (const h of result.headings) {
			const indent = '  '.repeat(h.level - 1);
			const sizeKB = (h.sectionLength / 1024).toFixed(1);
			logger.info(
				`${indent}${'#'.repeat(h.level)} ${h.text}  (${sizeKB}KB, ~${h.estimatedChunks} chunks)`,
			);
		}
	} else {
		logger.info('\nNo headings found in document.');
	}

	// Split suggestions
	if (result.suggestedSplitPoints.length > 0) {
		const parts = result.suggestedSplitPoints.length + 1;
		logger.info(`\n--- Suggested Split: ${parts} parts ---`);
		for (let i = 0; i < result.suggestedSplitPoints.length; i++) {
			const sp = result.suggestedSplitPoints[i];
			const heading = sp.heading ? `at "${sp.heading.text}"` : `at offset ${sp.offset}`;
			const sizeKB = (sp.estimatedPartSize / 1024).toFixed(1);
			logger.info(`  Part ${i + 1}: ${heading} (${sizeKB}KB, ~${sp.estimatedChunks} chunks)`);
		}
		logger.info(`\n  Run: pnpm split -- ${result.relativePath}`);
	}
}

/**
 * Main scan function
 */
async function scanDocuments(target: string, options: ScanOptions): Promise<void> {
	const resolved = resolve(target);

	if (!existsSync(resolved)) {
		logger.error(`Not found: ${resolved}`);
		process.exit(1);
	}

	const isFile = statSync(resolved).isFile();

	if (isFile) {
		// Single file analysis
		const baseDir = resolve(resolved, '..');
		const result = scanFile(resolved, baseDir, {
			maxFileSize: options.maxFileSize,
			maxChunks: options.maxChunks,
		});

		if (options.format === 'json') {
			console.error(JSON.stringify(result, null, 2));
		} else {
			renderSingleFile(result);
		}
		return;
	}

	// Directory scan
	const pattern = options.recursive ? options.pattern : options.pattern.replace('**/', '');
	const files = await glob(pattern, { cwd: resolved, absolute: true });

	if (files.length === 0) {
		logger.error(`No files found matching pattern: ${pattern}`);
		process.exit(1);
	}

	const summary = scanFiles(files, resolved, {
		maxFileSize: options.maxFileSize,
		maxChunks: options.maxChunks,
	});

	if (options.format === 'json') {
		console.error(JSON.stringify(summary, null, 2));
	} else {
		renderTable(summary, options);
	}
}

// CLI setup
const program = createBaseCommand('scan', 'Analyze files for upload readiness');
addScanOptions(program);

program
	.argument('<target>', 'Directory or file to scan')
	.action(async (target: string, opts: ScanOptions) => {
		await scanDocuments(target, opts);
	});

const argv = process.argv.filter((arg, i) => !(i === 2 && arg === '--'));
program.parse(argv);
