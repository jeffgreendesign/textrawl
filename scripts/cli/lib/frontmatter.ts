/**
 * YAML front matter parsing and serialization
 *
 * Uses gray-matter for consistent front matter handling
 */

import matter from 'gray-matter';
import type { DocumentFrontMatter } from './types.js';

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
export function serializeFrontmatter(
  frontmatter: DocumentFrontMatter,
  content: string
): string {
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
  metadata: Record<string, unknown>
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
 * Add tags to front matter (deduplicating)
 */
export function addFrontmatterTags(
  frontmatter: DocumentFrontMatter,
  tags: string[]
): DocumentFrontMatter {
  const uniqueTags = [...new Set([...frontmatter.tags, ...tags])];
  return {
    ...frontmatter,
    tags: uniqueTags,
  };
}
