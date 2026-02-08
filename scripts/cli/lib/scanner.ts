/**
 * File scanning and analysis for upload readiness
 *
 * Pure analysis module — no side effects, no file writes, no network calls.
 * Scans markdown files to determine if they're uploadable or need splitting.
 */

import { readFileSync, statSync } from 'node:fs';
import { relative } from 'node:path';
import { parseFrontmatter } from './frontmatter.js';
import type { HeadingNode, ScanFileResult, ScanSummary, SplitPoint } from './types.js';

/** Approximate characters per chunk (512 tokens * ~4 chars/token) */
const CHARS_PER_CHUNK = 2048;

/**
 * Extract markdown headings from body content
 */
export function extractHeadings(content: string): HeadingNode[] {
	const headings: HeadingNode[] = [];
	const lines = content.split('\n');
	let offset = 0;

	for (let i = 0; i < lines.length; i++) {
		const match = lines[i].match(/^(#{1,6})\s+(.+)$/);
		if (match) {
			headings.push({
				level: match[1].length,
				text: match[2].trim(),
				line: i + 1,
				offset,
				sectionLength: 0,
				estimatedChunks: 0,
			});
		}
		offset += lines[i].length + 1; // +1 for newline
	}

	// Compute section lengths and estimated chunks
	for (let i = 0; i < headings.length; i++) {
		const nextOffset = i + 1 < headings.length ? headings[i + 1].offset : content.length;
		headings[i].sectionLength = nextOffset - headings[i].offset;
		headings[i].estimatedChunks = Math.max(
			1,
			Math.ceil(headings[i].sectionLength / CHARS_PER_CHUNK),
		);
	}

	return headings;
}

/**
 * Suggest split points using greedy accumulation at heading boundaries
 */
export function suggestSplitPoints(
	headings: HeadingNode[],
	contentLength: number,
	options: { targetChunks: number; splitLevel: number },
): SplitPoint[] {
	// Filter headings at or above the split level
	const candidates = headings.filter((h) => h.level <= options.splitLevel);

	if (candidates.length === 0) {
		// No headings at target level — suggest fixed-size splits
		return suggestFixedSplitPoints(contentLength, options.targetChunks);
	}

	const points: SplitPoint[] = [];
	let accumulatedChunks = 0;
	let partStart = 0;

	for (const heading of candidates) {
		const sectionChunks = heading.estimatedChunks;

		if (accumulatedChunks + sectionChunks > options.targetChunks && accumulatedChunks > 0) {
			points.push({
				offset: heading.offset,
				heading,
				estimatedPartSize: heading.offset - partStart,
				estimatedChunks: accumulatedChunks,
			});
			partStart = heading.offset;
			accumulatedChunks = sectionChunks;
		} else {
			accumulatedChunks += sectionChunks;
		}
	}

	return points;
}

/**
 * Suggest split points for files without headings (paragraph-based)
 */
function suggestFixedSplitPoints(contentLength: number, targetChunks: number): SplitPoint[] {
	const targetSize = targetChunks * CHARS_PER_CHUNK;
	const partCount = Math.ceil(contentLength / targetSize);

	if (partCount <= 1) return [];

	const points: SplitPoint[] = [];
	for (let i = 1; i < partCount; i++) {
		points.push({
			offset: i * targetSize,
			estimatedPartSize: targetSize,
			estimatedChunks: targetChunks,
		});
	}

	return points;
}

/**
 * Scan a single file for upload readiness
 */
export function scanFile(
	filePath: string,
	baseDir: string,
	options: { maxFileSize: number; maxChunks: number },
): ScanFileResult {
	const relativePath = relative(baseDir, filePath);

	try {
		const stats = statSync(filePath);
		const fileSizeBytes = stats.size;
		const fileSizeMB = fileSizeBytes / (1024 * 1024);

		const content = readFileSync(filePath, 'utf-8');
		let title: string | undefined;
		let bodyContent: string;
		let hasValidFrontmatter = false;

		try {
			const parsed = parseFrontmatter(content);
			title = parsed.frontmatter.title;
			bodyContent = parsed.content;
			hasValidFrontmatter = true;
		} catch {
			// No valid frontmatter — use raw content
			bodyContent = content;
		}

		const estimatedChunks = Math.max(1, Math.ceil(bodyContent.length / CHARS_PER_CHUNK));
		const exceedsFileSize = fileSizeMB > options.maxFileSize;
		const exceedsChunkLimit = estimatedChunks > options.maxChunks;
		const headings = extractHeadings(bodyContent);
		const suggestedSplitPoints =
			exceedsFileSize || exceedsChunkLimit
				? suggestSplitPoints(headings, bodyContent.length, {
						targetChunks: Math.min(options.maxChunks, 400),
						splitLevel: 2,
					})
				: [];

		return {
			relativePath,
			fileSizeBytes,
			fileSizeMB,
			estimatedChunks,
			exceedsFileSize,
			exceedsChunkLimit,
			uploadable: !exceedsFileSize && !exceedsChunkLimit,
			headings,
			suggestedSplitPoints,
			hasValidFrontmatter,
			title,
		};
	} catch (err) {
		return {
			relativePath,
			fileSizeBytes: 0,
			fileSizeMB: 0,
			estimatedChunks: 0,
			exceedsFileSize: false,
			exceedsChunkLimit: false,
			uploadable: false,
			headings: [],
			suggestedSplitPoints: [],
			hasValidFrontmatter: false,
			error: err instanceof Error ? err.message : String(err),
		};
	}
}

/**
 * Scan a directory of files and produce an aggregate summary
 */
export function scanFiles(
	filePaths: string[],
	baseDir: string,
	options: { maxFileSize: number; maxChunks: number },
): ScanSummary {
	const files = filePaths.map((f) => scanFile(f, baseDir, options));

	return {
		totalFiles: files.length,
		uploadableFiles: files.filter((f) => f.uploadable).length,
		needsSplitting: files.filter((f) => !f.uploadable && !f.error).length,
		exceedsSizeLimit: files.filter((f) => f.exceedsFileSize).length,
		exceedsChunkLimit: files.filter((f) => f.exceedsChunkLimit).length,
		totalEstimatedChunks: files.reduce((sum, f) => sum + f.estimatedChunks, 0),
		files,
	};
}
