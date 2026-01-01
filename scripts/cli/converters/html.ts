#!/usr/bin/env npx tsx
/**
 * HTML to Markdown Converter
 *
 * Converts HTML files to markdown with YAML front matter
 *
 * Usage:
 *   npm run convert:html -- <path> [options]
 *   npx tsx scripts/cli/converters/html.ts <path> [options]
 */

import { createHash } from 'crypto';
import { readFileSync, writeFileSync, existsSync, statSync, mkdirSync } from 'fs';
import { basename, dirname, extname, join, resolve } from 'path';
import { glob } from 'glob';
import { JSDOM } from 'jsdom';
import TurndownService from 'turndown';
import { gfm } from 'turndown-plugin-gfm';

import { createBaseCommand, addHtmlOptions, type HtmlOptions } from '../lib/args.js';
import {
  createFrontmatter,
  serializeFrontmatter,
  type ParsedDocument,
} from '../lib/frontmatter.js';
import { normalizeText, slugify } from '../lib/normalizer.js';
import { ProgressReporter, logger } from '../lib/progress.js';
import type { ConversionResult, WebpageMetadata } from '../lib/types.js';

/**
 * Extract metadata from HTML document
 */
function extractMetadata(doc: Document, url?: string): Partial<WebpageMetadata> {
  const metadata: Partial<WebpageMetadata> = {
    raw_meta: {},
  };

  // Get URL from various sources
  const canonicalLink = doc.querySelector('link[rel="canonical"]');
  const ogUrl = doc.querySelector('meta[property="og:url"]');
  metadata.url =
    url ||
    canonicalLink?.getAttribute('href') ||
    ogUrl?.getAttribute('content') ||
    '';

  if (metadata.url) {
    try {
      const urlObj = new URL(metadata.url);
      metadata.domain = urlObj.hostname;
    } catch {
      // Invalid URL, ignore
    }
  }

  // Extract all meta tags
  const metaTags = doc.querySelectorAll('meta');
  metaTags.forEach((meta) => {
    const name =
      meta.getAttribute('name') ||
      meta.getAttribute('property') ||
      meta.getAttribute('itemprop');
    const content = meta.getAttribute('content');
    if (name && content && metadata.raw_meta) {
      metadata.raw_meta[name] = content;
    }
  });

  // Author
  const authorMeta =
    doc.querySelector('meta[name="author"]') ||
    doc.querySelector('meta[property="article:author"]');
  metadata.author = authorMeta?.getAttribute('content') || undefined;

  // Published date
  const dateMeta =
    doc.querySelector('meta[property="article:published_time"]') ||
    doc.querySelector('meta[name="date"]') ||
    doc.querySelector('time[datetime]');
  if (dateMeta) {
    const dateStr =
      dateMeta.getAttribute('content') || dateMeta.getAttribute('datetime');
    if (dateStr) {
      try {
        metadata.published_at = new Date(dateStr).toISOString();
      } catch {
        // Invalid date, ignore
      }
    }
  }

  // Language
  const htmlLang = doc.documentElement.getAttribute('lang');
  const langMeta = doc.querySelector('meta[name="language"]');
  metadata.language =
    htmlLang || langMeta?.getAttribute('content') || undefined;

  // Count images
  const images = doc.querySelectorAll('img');
  metadata.has_images = images.length > 0;
  metadata.image_count = images.length;

  // Fetched timestamp
  metadata.fetched_at = new Date().toISOString();

  return metadata;
}

/**
 * Extract title from HTML document
 */
function extractTitle(doc: Document): string {
  // Try various sources in order of preference
  const ogTitle = doc.querySelector('meta[property="og:title"]');
  if (ogTitle?.getAttribute('content')) {
    return ogTitle.getAttribute('content')!;
  }

  const titleTag = doc.querySelector('title');
  if (titleTag?.textContent) {
    return titleTag.textContent.trim();
  }

  const h1 = doc.querySelector('h1');
  if (h1?.textContent) {
    return h1.textContent.trim();
  }

  return 'Untitled';
}

/**
 * Remove boilerplate elements from document
 */
function removeBoilerplate(doc: Document): void {
  // Elements to remove
  const selectorsToRemove = [
    'script',
    'style',
    'noscript',
    'iframe',
    'nav',
    'header:not(article header)',
    'footer:not(article footer)',
    'aside',
    '.sidebar',
    '.navigation',
    '.nav',
    '.menu',
    '.header',
    '.footer',
    '.advertisement',
    '.ad',
    '.ads',
    '.social-share',
    '.share-buttons',
    '.comments',
    '.comment-section',
    '#comments',
    '.related-posts',
    '.newsletter',
    '.popup',
    '.modal',
    '[role="navigation"]',
    '[role="banner"]',
    '[role="contentinfo"]',
    '[aria-hidden="true"]',
  ];

  selectorsToRemove.forEach((selector) => {
    try {
      doc.querySelectorAll(selector).forEach((el) => el.remove());
    } catch {
      // Invalid selector or element not found, ignore
    }
  });

  // Remove hidden elements
  doc.querySelectorAll('[hidden], [style*="display:none"], [style*="display: none"]')
    .forEach((el) => el.remove());

  // Remove tracking pixels (1x1 images)
  doc.querySelectorAll('img').forEach((img) => {
    const width = img.getAttribute('width');
    const height = img.getAttribute('height');
    if (
      (width === '1' || width === '0') &&
      (height === '1' || height === '0')
    ) {
      img.remove();
    }
  });
}

/**
 * Find the main content element
 */
function findMainContent(doc: Document): Element | null {
  // Try common main content selectors
  const mainSelectors = [
    'main',
    'article',
    '[role="main"]',
    '#content',
    '#main',
    '.content',
    '.main',
    '.post',
    '.article',
    '.entry',
    '.post-content',
    '.article-content',
    '.entry-content',
  ];

  for (const selector of mainSelectors) {
    const element = doc.querySelector(selector);
    if (element && element.textContent && element.textContent.trim().length > 100) {
      return element;
    }
  }

  // Fall back to body
  return doc.body;
}

/**
 * Convert HTML to Markdown
 */
function htmlToMarkdown(html: string, options: { cleanBoilerplate?: boolean } = {}): string {
  const dom = new JSDOM(html);
  const doc = dom.window.document;

  // Clean boilerplate if requested
  if (options.cleanBoilerplate !== false) {
    removeBoilerplate(doc);
  }

  // Find main content
  const mainContent = findMainContent(doc);
  if (!mainContent) {
    return '';
  }

  // Configure turndown
  const turndown = new TurndownService({
    headingStyle: 'atx',
    bulletListMarker: '-',
    codeBlockStyle: 'fenced',
    emDelimiter: '*',
    strongDelimiter: '**',
    linkStyle: 'inlined',
  });

  // Add GitHub Flavored Markdown support
  turndown.use(gfm);

  // Custom rules
  turndown.addRule('removeEmptyParagraphs', {
    filter: (node) => {
      return (
        node.nodeName === 'P' &&
        (!node.textContent || node.textContent.trim() === '')
      );
    },
    replacement: () => '',
  });

  // Convert to markdown
  const markdown = turndown.turndown(mainContent.innerHTML);

  return markdown;
}

/**
 * Convert a single HTML file
 */
async function convertHtmlFile(
  inputPath: string,
  outputDir: string,
  options: HtmlOptions
): Promise<ConversionResult> {
  try {
    // Read file
    const html = readFileSync(inputPath, 'utf-8');

    // Generate source hash
    const sourceHash = createHash('sha256').update(html).digest('hex');

    // Parse HTML
    const dom = new JSDOM(html);
    const doc = dom.window.document;

    // Extract metadata
    const metadata = extractMetadata(doc, options.urlBase);
    const title = extractTitle(doc);

    // Convert to markdown
    const markdownContent = htmlToMarkdown(html, {
      cleanBoilerplate: options.cleanBoilerplate,
    });

    // Normalize text
    const normalizedContent = normalizeText(markdownContent, {
      raw: options.raw,
      maxNewlines: 2,
    });

    // Calculate stats
    const wordCount = normalizedContent.split(/\s+/).filter(Boolean).length;
    const readingTime = Math.ceil(wordCount / 200); // ~200 WPM

    // Create front matter
    const frontmatter = createFrontmatter({
      title,
      sourceType: 'file',
      contentType: 'webpage',
      sourceFile: inputPath,
      sourceHash: `sha256:${sourceHash}`,
      createdAt: metadata.published_at ? new Date(metadata.published_at) : undefined,
      tags: ['imported', 'webpage'],
      metadata: {
        ...metadata,
        word_count: wordCount,
        reading_time_minutes: readingTime,
      } as WebpageMetadata,
    });

    // Add additional tags from options
    if (options.tags.length > 0) {
      frontmatter.tags = [...new Set([...frontmatter.tags, ...options.tags])];
    }

    // Generate output path
    const inputBasename = basename(inputPath, extname(inputPath));
    const slug = slugify(title || inputBasename);
    const outputFilename = `${slug}.md`;
    const outputPath = join(outputDir, outputFilename);

    // Write output
    if (!options.dryRun) {
      mkdirSync(outputDir, { recursive: true });
      const output = serializeFrontmatter(frontmatter, normalizedContent);
      writeFileSync(outputPath, output);
    }

    return {
      success: true,
      outputPath,
      sourceHash: `sha256:${sourceHash}`,
      stats: {
        originalChars: html.length,
        normalizedChars: normalizedContent.length,
        metadataFields: Object.keys(metadata.raw_meta || {}).length,
      },
    };
  } catch (error) {
    return {
      success: false,
      error: error instanceof Error ? error.message : String(error),
    };
  }
}

/**
 * Main conversion function
 */
async function convertHtml(inputPath: string, options: HtmlOptions): Promise<void> {
  const resolvedInput = resolve(inputPath);

  // Check if input exists
  if (!existsSync(resolvedInput)) {
    logger.error(`Input not found: ${resolvedInput}`);
    process.exit(1);
  }

  const stats = statSync(resolvedInput);
  const outputDir = resolve(options.output);

  let files: string[] = [];

  if (stats.isDirectory()) {
    // Find HTML files
    const pattern = options.recursive ? '**/*.{html,htm}' : '*.{html,htm}';
    files = await glob(pattern, { cwd: resolvedInput, absolute: true });
  } else {
    files = [resolvedInput];
  }

  if (files.length === 0) {
    logger.error('No HTML files found');
    process.exit(1);
  }

  logger.info(`Found ${files.length} HTML file(s)`);

  // Process files
  const progress = new ProgressReporter(files.length, { verbose: options.verbose });
  progress.start();

  let successCount = 0;
  let errorCount = 0;

  for (let i = 0; i < files.length; i++) {
    const file = files[i];
    const relativePath = file.replace(resolvedInput, '').replace(/^\//, '');

    progress.update(i, relativePath);

    const result = await convertHtmlFile(file, outputDir, options);

    if (result.success) {
      successCount++;
      if (options.verbose) {
        progress.log(`  ✓ ${relativePath} → ${result.outputPath}`);
      }
    } else {
      errorCount++;
      progress.log(`  ✗ ${relativePath}: ${result.error}`);
    }
  }

  progress.finish(`Done: ${successCount} converted, ${errorCount} failed`);

  if (errorCount > 0) {
    process.exit(1);
  }
}

// CLI setup
const program = createBaseCommand(
  'convert-html',
  'Convert HTML files to Markdown with YAML front matter'
);

addHtmlOptions(program);

program
  .argument('<path>', 'HTML file or directory to convert')
  .action(async (path: string, opts: HtmlOptions) => {
    await convertHtml(path, opts);
  });

program.parse();
