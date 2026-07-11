#!/usr/bin/env npx tsx
/**
 * File Splitting Utility
 *
 * Splits large markdown files at heading boundaries into smaller linked files,
 * preserving frontmatter and adding linking metadata for document relationships.
 *
 * Usage:
 *   pnpm split -- <file-or-directory> [options]
 *   pnpm split -- ./converted/large-file.md
 *   pnpm split -- ./converted/ --only-oversized -r
 */

import { existsSync, statSync } from 'node:fs';
import { basename, relative, resolve } from 'node:path';
import { glob } from 'glob';

import { addSplitOptions, createBaseCommand, type SplitCliOptions } from './lib/args.js';
import { logger } from './lib/progress.js';
import { type SplitOptions, splitFile } from './lib/splitter.js';
import type { SplitFileResult } from './lib/types.js';

/**
 * Main split function
 */
async function splitDocuments(target: string, options: SplitCliOptions): Promise<void> {
	const resolved = resolve(target);

	if (!existsSync(resolved)) {
		logger.error(`Not found: ${resolved}`);
		process.exit(1);
	}

	const isFile = statSync(resolved).isFile();
	const splitOpts: SplitOptions = {
		splitLevel: options.splitLevel,
		targetChunks: options.targetChunks,
		targetSize: options.targetSize,
		outputDir: options.output !== './converted' ? resolve(options.output) : undefined,
		suffix: options.suffix,
		onlyOversized: options.onlyOversized,
		maxFileSize: options.maxFileSize,
		maxChunks: options.maxChunks,
		dryRun: options.dryRun,
	};

	let files: string[];
	let baseDir: string;

	if (isFile) {
		files = [resolved];
		baseDir = resolve(resolved, '..');
	} else {
		baseDir = resolved;
		const pattern = options.recursive ? options.pattern : options.pattern.replace('**/', '');
		files = await glob(pattern, { cwd: resolved, absolute: true });

		if (files.length === 0) {
			logger.error(`No files found matching pattern: ${pattern}`);
			process.exit(1);
		}
	}

	if (options.dryRun) {
		logger.info('[DRY RUN] No files will be written.\n');
	}

	let totalSplit = 0;
	let totalParts = 0;
	let totalSkipped = 0;
	let totalErrors = 0;
	const results: SplitFileResult[] = [];

	for (const file of files) {
		const relPath = relative(baseDir, file);
		const result = splitFile(file, splitOpts);
		results.push(result);

		if (result.error) {
			totalErrors++;
			logger.error(`  \u2717 ${relPath}: ${result.error}`);
		} else if (!result.wasSplit) {
			totalSkipped++;
			if (options.verbose) {
				logger.info(`  - ${relPath}: within limits, skipped`);
			}
		} else {
			totalSplit++;
			totalParts += result.partCount;

			logger.info(`\n=== ${options.dryRun ? '[DRY RUN] ' : ''}Splitting: ${relPath} ===`);
			logger.info(`  -> ${result.partCount} parts`);

			for (let i = 0; i < result.partPaths.length; i++) {
				const partName = basename(result.partPaths[i]);
				logger.info(`  \u2713 ${partName}`);
			}
		}
	}

	// Summary
	logger.info('\n=== Split Summary ===');
	logger.info(`Files processed: ${files.length}`);
	logger.info(`Files split: ${totalSplit} -> ${totalParts} parts`);
	if (totalSkipped > 0) {
		logger.info(`Files skipped (within limits): ${totalSkipped}`);
	}
	if (totalErrors > 0) {
		logger.info(`Errors: ${totalErrors}`);
	}

	if (totalSplit > 0 && !options.dryRun) {
		logger.info('\nSplit files are ready for upload: pnpm upload -- <directory>');
	}

	if (totalErrors > 0) {
		process.exit(1);
	}
}

// CLI setup
const program = createBaseCommand(
	'split',
	'Split large markdown files into smaller linked documents',
);
addSplitOptions(program);

program
	.argument('<target>', 'File or directory to split')
	.action(async (target: string, opts: SplitCliOptions) => {
		await splitDocuments(target, opts);
	});

const argv = process.argv.filter((arg, i) => !(i === 2 && arg === '--'));
program.parse(argv);
