/**
 * YAML front matter parsing and serialization
 *
 * Uses gray-matter for consistent front matter handling
 */

import { closeSync, openSync, readSync } from 'node:fs';
import matter from 'gray-matter';
import { logger } from './progress.js';
import type { ContentType, DocumentFrontMatter, SourceType } from './types.js';

const VALID_SOURCE_TYPES = new Set<SourceType>(['note', 'file', 'url']);
const VALID_CONTENT_TYPES = new Set<ContentType>([
	'email',
	'youtube',
	'calendar',
	'contact',
	'webpage',
	'document',
]);

/**
 * Parsed document with front matter and content
 */
export interface ParsedDocument {
	frontmatter: DocumentFrontMatter;
	content: string;
}

/**
 * Parse front matter from a markdown string
 */
export function parseFrontmatter(markdown: string): ParsedDocument {
	const { data, content } = matter(markdown);

	// Validate required fields
	if (!data.title) {
		throw new Error('Missing required front matter field: title');
	}
	if (!data.source_type) {
		throw new Error('Missing required front matter field: source_type');
	}

	// Coerce invalid source_type to 'file' (CLI uploads are file-based)
	if (!VALID_SOURCE_TYPES.has(data.source_type as SourceType)) {
		logger.debug(`Coercing source_type '${data.source_type}' -> 'file'`);
		data.source_type = 'file';
	}

	// Coerce invalid content_type to 'document'
	if (!data.content_type || !VALID_CONTENT_TYPES.has(data.content_type as ContentType)) {
		logger.debug(`Coercing content_type '${data.content_type ?? 'undefined'}' -> 'document'`);
		data.content_type = 'document';
	}

	// Ensure tags is an array of strings
	if (!Array.isArray(data.tags)) {
		logger.debug(`Coercing tags '${String(data.tags ?? 'undefined')}' -> array`);
		data.tags = data.tags ? [String(data.tags)] : [];
	}

	return {
		frontmatter: data as DocumentFrontMatter,
		content: content.trim(),
	};
}

/**
 * Recursively remove undefined values from an object (YAML can't serialize undefined)
 */
function removeUndefined<T>(obj: T): T {
	if (obj === null || obj === undefined) {
		return obj;
	}
	if (Array.isArray(obj)) {
		return obj.map(removeUndefined) as T;
	}
	if (typeof obj === 'object') {
		const result: Record<string, unknown> = {};
		for (const [key, value] of Object.entries(obj)) {
			if (value !== undefined) {
				result[key] = removeUndefined(value);
			}
		}
		return result as T;
	}
	return obj;
}

/**
 * Serialize front matter and content to a markdown string
 */
export function serializeFrontmatter(frontmatter: DocumentFrontMatter, content: string): string {
	// Remove undefined values before YAML serialization
	const cleanedFrontmatter = removeUndefined(frontmatter);
	// Use gray-matter's stringify which handles YAML serialization
	return matter.stringify(content, cleanedFrontmatter);
}

/**
 * Create front matter for a document
 */
export function createFrontmatter(options: {
	title: string;
	sourceType: DocumentFrontMatter['source_type'];
	contentType: DocumentFrontMatter['content_type'];
	sourceFile: string;
	sourceHash: string;
	createdAt?: Date;
	tags?: string[];
	metadata?: Record<string, unknown>;
}): DocumentFrontMatter {
	return {
		title: options.title,
		source_type: options.sourceType,
		content_type: options.contentType,
		created_at: (options.createdAt || new Date()).toISOString(),
		converted_at: new Date().toISOString(),
		source_file: options.sourceFile,
		source_hash: options.sourceHash,
		tags: options.tags || [],
		metadata: options.metadata || {},
	};
}

/**
 * Merge additional metadata into front matter
 */
export function mergeFrontmatterMetadata(
	frontmatter: DocumentFrontMatter,
	metadata: Record<string, unknown>,
): DocumentFrontMatter {
	return {
		...frontmatter,
		metadata: {
			...frontmatter.metadata,
			...metadata,
		},
	};
}

/**
 * Read only the source_hash from a file's YAML frontmatter without loading
 * the entire file into memory. Reads at most 8KB via a fixed buffer.
 *
 * Used by the upload skip-filter to check 15K+ files against the manifest
 * without triggering OOM from full-file reads + gray-matter string ops.
 */
export function readFrontmatterHash(filePath: string): string | null {
	let fd: number;
	try {
		fd = openSync(filePath, 'r');
	} catch {
		return null;
	}

	try {
		// Try 4KB first (covers most frontmatter blocks)
		const buf = Buffer.alloc(4096);
		const bytesRead = readSync(fd, buf, 0, 4096, 0);
		if (bytesRead < 8) return null; // Too small for valid frontmatter

		let header = buf.toString('utf-8', 0, bytesRead);

		// Must start with ---
		if (!header.startsWith('---')) return null;

		// Find closing --- delimiter
		let closeIdx = header.indexOf('\n---', 3);

		// Fallback: read 8KB if closing delimiter not found in first 4KB
		if (closeIdx === -1 && bytesRead === 4096) {
			const buf2 = Buffer.alloc(8192);
			const bytesRead2 = readSync(fd, buf2, 0, 8192, 0);
			header = buf2.toString('utf-8', 0, bytesRead2);
			closeIdx = header.indexOf('\n---', 3);
		}

		if (closeIdx === -1) return null;

		// Extract YAML block between delimiters
		const yaml = header.slice(4, closeIdx);

		// Extract source_hash with regex (always a sha256: prefixed hex string)
		const match = yaml.match(/^source_hash:\s*['"]?(\S+?)['"]?\s*$/m);
		return match ? match[1] : null;
	} catch {
		return null;
	} finally {
		closeSync(fd);
	}
}

/**
 * Add tags to front matter (deduplicating)
 */
export function addFrontmatterTags(
	frontmatter: DocumentFrontMatter,
	tags: string[],
): DocumentFrontMatter {
	const uniqueTags = [...new Set([...frontmatter.tags, ...tags])];
	return {
		...frontmatter,
		tags: uniqueTags,
	};
}
