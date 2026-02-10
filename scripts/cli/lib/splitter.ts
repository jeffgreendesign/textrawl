/**
 * File splitting for large markdown documents
 *
 * Splits markdown files at heading boundaries into smaller linked files,
 * preserving frontmatter and adding linking metadata.
 */

import { createHash } from 'node:crypto';
import { mkdirSync, readFileSync, statSync, writeFileSync } from 'node:fs';
import { basename, dirname, join, relative } from 'node:path';
import { parseFrontmatter, serializeFrontmatter } from './frontmatter.js';
import { extractHeadings, suggestSplitPoints } from './scanner.js';
import type { DocumentFrontMatter, SplitFileResult, SplitMetadata } from './types.js';

/** Approximate characters per chunk */
const CHARS_PER_CHUNK = 2048;

/**
 * Generate a deterministic hash for a split part
 */
function generatePartHash(originalHash: string, partNumber: number): string {
	return createHash('sha256').update(`${originalHash}:part:${partNumber}`).digest('hex');
}

/**
 * Create a slug from a filename (strip extension and sanitize)
 */
function fileSlug(filePath: string): string {
	return basename(filePath).replace(/\.md$/i, '');
}

/**
 * Split body content at the given offsets
 */
function splitContentAtOffsets(content: string, offsets: number[]): string[] {
	const parts: string[] = [];
	let lastOffset = 0;

	for (const offset of offsets) {
		const part = content.slice(lastOffset, offset);
		if (part.trim().length > 0) {
			parts.push(part);
		}
		lastOffset = offset;
	}

	// Final part
	const last = content.slice(lastOffset);
	if (last.trim().length > 0) {
		parts.push(last);
	}

	return parts;
}

/**
 * Split content at paragraph boundaries (\n\n) for files without headings
 */
function splitAtParagraphs(
	content: string,
	targetChunks: number,
): { parts: string[]; headings: (string | undefined)[] } {
	const targetSize = targetChunks * CHARS_PER_CHUNK;
	const paragraphs = content.split(/\n\n+/);

	const parts: string[] = [];
	const headings: (string | undefined)[] = [];
	let currentPart = '';

	for (const para of paragraphs) {
		if (currentPart.length + para.length > targetSize && currentPart.length > 0) {
			parts.push(currentPart);
			headings.push(undefined);
			currentPart = para;
		} else {
			currentPart += (currentPart ? '\n\n' : '') + para;
		}
	}

	if (currentPart.trim().length > 0) {
		parts.push(currentPart);
		headings.push(undefined);
	}

	return { parts, headings };
}

export interface SplitOptions {
	/** Heading level to split at (1-6) */
	splitLevel: number;
	/** Target max chunks per part */
	targetChunks: number;
	/** Target max file size in MB */
	targetSize: number;
	/** Output directory (default: same as input) */
	outputDir?: string;
	/** Filename suffix pattern */
	suffix: string;
	/** Only split if file exceeds limits */
	onlyOversized: boolean;
	/** Max file size in MB (for oversized check) */
	maxFileSize: number;
	/** Max chunks per file (for oversized check) */
	maxChunks: number;
	/** Preview mode — don't write files */
	dryRun: boolean;
}

/**
 * Split a single markdown file into smaller linked files
 */
export function splitFile(filePath: string, options: SplitOptions): SplitFileResult {
	const originalPath = filePath;

	try {
		const stats = statSync(filePath);
		const fileSizeMB = stats.size / (1024 * 1024);
		const content = readFileSync(filePath, 'utf-8');

		// Parse frontmatter
		let frontmatter: DocumentFrontMatter;
		let bodyContent: string;
		try {
			const parsed = parseFrontmatter(content);
			frontmatter = parsed.frontmatter;
			bodyContent = parsed.content;
		} catch (err) {
			return {
				originalPath,
				wasSplit: false,
				partPaths: [],
				partCount: 0,
				error: `Invalid frontmatter: ${err instanceof Error ? err.message : String(err)}`,
			};
		}

		const estimatedChunks = Math.max(1, Math.ceil(bodyContent.length / CHARS_PER_CHUNK));

		// Check if splitting is needed
		if (options.onlyOversized) {
			const exceedsSize = fileSizeMB > options.maxFileSize;
			const exceedsChunks = estimatedChunks > options.maxChunks;
			if (!exceedsSize && !exceedsChunks) {
				return { originalPath, wasSplit: false, partPaths: [], partCount: 0 };
			}
		}

		// If file is already within targets, don't split
		if (estimatedChunks <= options.targetChunks && fileSizeMB <= options.targetSize) {
			return { originalPath, wasSplit: false, partPaths: [], partCount: 0 };
		}

		// Extract headings and compute split points
		const headings = extractHeadings(bodyContent);
		const splitPoints = suggestSplitPoints(headings, bodyContent.length, {
			targetChunks: options.targetChunks,
			splitLevel: options.splitLevel,
		});

		let contentParts: string[];
		let partHeadings: (string | undefined)[];

		if (splitPoints.length > 0) {
			// Split at heading boundaries
			const offsets = splitPoints.map((sp) => sp.offset);
			contentParts = splitContentAtOffsets(bodyContent, offsets);
			partHeadings = contentParts.map((part) => {
				const match = part.match(/^(#{1,6})\s+(.+)$/m);
				return match ? `${'#'.repeat(match[1].length)} ${match[2].trim()}` : undefined;
			});
		} else {
			// Fallback: split at paragraph boundaries
			const result = splitAtParagraphs(bodyContent, options.targetChunks);
			contentParts = result.parts;
			partHeadings = result.headings;
		}

		if (contentParts.length <= 1) {
			return { originalPath, wasSplit: false, partPaths: [], partCount: 0 };
		}

		// Determine output directory
		const outputDir = options.outputDir || dirname(filePath);
		const slug = fileSlug(filePath);
		const originalHash = frontmatter.source_hash;
		const totalParts = contentParts.length;

		const partPaths: string[] = [];

		for (let i = 0; i < totalParts; i++) {
			const partNum = i + 1;
			const partHash = generatePartHash(originalHash, partNum);

			const splitMeta: SplitMetadata = {
				split_group: originalHash,
				split_part: partNum,
				split_total: totalParts,
				split_source_title: frontmatter.title,
			};

			const heading = partHeadings[i];
			if (heading) {
				splitMeta.split_heading = heading.slice(0, 200);
			}

			const partFrontmatter: DocumentFrontMatter = {
				title: `${frontmatter.title} (Part ${partNum}/${totalParts})`,
				source_type: frontmatter.source_type,
				content_type: frontmatter.content_type,
				created_at: frontmatter.created_at,
				converted_at: new Date().toISOString(),
				source_file: frontmatter.source_file,
				source_hash: partHash,
				tags: [...new Set([...frontmatter.tags, 'split-document'])],
				metadata: {
					...frontmatter.metadata,
					...splitMeta,
				},
			};

			const suffix = options.suffix.replace('{n}', String(partNum));
			const partFilename = `${slug}${suffix}.md`;
			const partPath = join(outputDir, partFilename);

			if (!options.dryRun) {
				mkdirSync(outputDir, { recursive: true });
				const serialized = serializeFrontmatter(partFrontmatter, contentParts[i]);
				writeFileSync(partPath, serialized, 'utf-8');
			}

			partPaths.push(partPath);
		}

		return {
			originalPath,
			wasSplit: true,
			partPaths,
			partCount: totalParts,
		};
	} catch (err) {
		return {
			originalPath,
			wasSplit: false,
			partPaths: [],
			partCount: 0,
			error: err instanceof Error ? err.message : String(err),
		};
	}
}
