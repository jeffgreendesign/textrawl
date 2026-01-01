#!/usr/bin/env npx tsx
/**
 * EML to Markdown Converter
 *
 * Converts individual .eml email files to markdown with YAML front matter
 *
 * Usage:
 *   npm run convert:eml -- <path> [options]
 *   npx tsx scripts/cli/converters/eml.ts <path> [options]
 */

import { createHash } from 'crypto';
import { readFileSync, writeFileSync, existsSync, statSync, mkdirSync } from 'fs';
import { basename, dirname, extname, join, resolve } from 'path';
import { glob } from 'glob';
import { simpleParser, type ParsedMail, type AddressObject, type HeaderValue } from 'mailparser';
import TurndownService from 'turndown';
import { gfm } from 'turndown-plugin-gfm';

import { createBaseCommand, addMboxOptions, type MboxOptions } from '../lib/args.js';
import { createFrontmatter, serializeFrontmatter } from '../lib/frontmatter.js';
import { normalizeText, slugify, stripHtml } from '../lib/normalizer.js';
import { ProgressReporter, logger } from '../lib/progress.js';
import type { ConversionResult, EmailMetadata } from '../lib/types.js';

/**
 * Extract email addresses from an AddressObject
 */
function extractAddresses(addr: AddressObject | AddressObject[] | undefined): string[] {
  if (!addr) return [];

  const addresses = Array.isArray(addr) ? addr : [addr];
  const result: string[] = [];

  for (const a of addresses) {
    if (a.value) {
      for (const v of a.value) {
        if (v.address) {
          result.push(v.address);
        }
      }
    }
  }

  return result;
}

/**
 * Extract sender name from AddressObject
 */
function extractSenderName(addr: AddressObject | AddressObject[] | undefined): string | undefined {
  if (!addr) return undefined;

  const addresses = Array.isArray(addr) ? addr : [addr];
  for (const a of addresses) {
    if (a.value && a.value[0]) {
      return a.value[0].name || undefined;
    }
  }

  return undefined;
}

/**
 * Convert HTML email body to markdown
 */
function emailHtmlToMarkdown(html: string): string {
  const turndown = new TurndownService({
    headingStyle: 'atx',
    bulletListMarker: '-',
    codeBlockStyle: 'fenced',
    emDelimiter: '*',
    strongDelimiter: '**',
    linkStyle: 'inlined',
  });

  turndown.use(gfm);

  // Remove style and script tags first
  let cleaned = html.replace(/<style[^>]*>[\s\S]*?<\/style>/gi, '');
  cleaned = cleaned.replace(/<script[^>]*>[\s\S]*?<\/script>/gi, '');

  return turndown.turndown(cleaned);
}

/**
 * Extract raw headers as a plain object
 */
function extractRawHeaders(mail: ParsedMail): Record<string, string | string[]> {
  const rawHeaders: Record<string, string | string[]> = {};

  if (mail.headers) {
    mail.headers.forEach((value: HeaderValue, key: string) => {
      if (typeof value === 'string') {
        rawHeaders[key] = value;
      } else if (Array.isArray(value)) {
        rawHeaders[key] = value.map(v => String(v));
      } else if (value && typeof value === 'object') {
        rawHeaders[key] = JSON.stringify(value);
      }
    });
  }

  return rawHeaders;
}

/**
 * Generate a thread ID from email headers
 */
function generateThreadId(mail: ParsedMail): string | undefined {
  // Use References or In-Reply-To to group threads
  const references = mail.references;
  const inReplyTo = mail.inReplyTo;

  if (references && references.length > 0) {
    // Use the first reference (root of thread)
    return createHash('md5').update(references[0]).digest('hex').slice(0, 12);
  }

  if (inReplyTo) {
    return createHash('md5').update(inReplyTo).digest('hex').slice(0, 12);
  }

  return undefined;
}

/**
 * Convert a parsed email to markdown with front matter
 */
export async function convertEmail(
  mail: ParsedMail,
  sourceFile: string,
  options: MboxOptions
): Promise<{ frontmatter: ReturnType<typeof createFrontmatter>; content: string }> {
  // Get email body
  let bodyContent = '';

  if (mail.html && typeof mail.html === 'string') {
    // Convert HTML to markdown
    bodyContent = emailHtmlToMarkdown(mail.html);
  } else if (mail.text) {
    // Use plain text
    bodyContent = mail.text;
  }

  // Normalize content
  const normalizedContent = normalizeText(bodyContent, {
    raw: options.raw,
    keepSignatures: options.keepSignatures,
    maxNewlines: 2,
  });

  // Extract addresses
  const fromAddresses = extractAddresses(mail.from);
  const toAddresses = extractAddresses(mail.to);
  const ccAddresses = extractAddresses(mail.cc);
  const bccAddresses = extractAddresses(mail.bcc);

  // Build metadata
  const emailMetadata: EmailMetadata = {
    from: fromAddresses[0] || 'unknown',
    from_name: extractSenderName(mail.from),
    to: toAddresses,
    cc: ccAddresses.length > 0 ? ccAddresses : undefined,
    bcc: bccAddresses.length > 0 ? bccAddresses : undefined,
    subject: mail.subject || '(No Subject)',
    message_id: mail.messageId || '',
    in_reply_to: mail.inReplyTo || undefined,
    thread_id: generateThreadId(mail),
    has_attachments: mail.attachments && mail.attachments.length > 0,
    attachment_count: mail.attachments?.length || 0,
    attachments: mail.attachments?.map((att) => ({
      name: att.filename || 'unnamed',
      type: att.contentType,
      size: att.size,
    })),
    raw_headers: extractRawHeaders(mail),
  };

  // Generate source hash from message ID or content
  const hashInput = mail.messageId || bodyContent;
  const sourceHash = createHash('sha256').update(hashInput).digest('hex');

  // Create front matter
  const frontmatter = createFrontmatter({
    title: mail.subject || '(No Subject)',
    sourceType: 'file',
    contentType: 'email',
    sourceFile,
    sourceHash: `sha256:${sourceHash}`,
    createdAt: mail.date || undefined,
    tags: ['imported', 'email'],
    metadata: emailMetadata as unknown as Record<string, unknown>,
  });

  // Add additional tags
  if (options.tags.length > 0) {
    frontmatter.tags = [...new Set([...frontmatter.tags, ...options.tags])];
  }

  return { frontmatter, content: normalizedContent };
}

/**
 * Generate output path for an email
 */
function generateOutputPath(
  mail: ParsedMail,
  outputDir: string,
  options: MboxOptions
): string {
  const date = mail.date || new Date();
  const subject = mail.subject || 'no-subject';

  // Format date components
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, '0');
  const day = String(date.getDate()).padStart(2, '0');
  const hours = String(date.getHours()).padStart(2, '0');
  const minutes = String(date.getMinutes()).padStart(2, '0');
  const seconds = String(date.getSeconds()).padStart(2, '0');

  // Generate slug from subject
  const slug = slugify(subject, 40);

  // Build filename
  const filename = `${year}-${month}-${day}-${hours}-${minutes}-${seconds}-${slug}.md`;

  // Build directory path
  let dir = outputDir;
  if (options.dateFolders) {
    dir = join(outputDir, `${year}-${month}`);
  }

  return join(dir, filename);
}

/**
 * Convert a single EML file
 */
async function convertEmlFile(
  inputPath: string,
  outputDir: string,
  options: MboxOptions
): Promise<ConversionResult> {
  try {
    // Read file
    const emlContent = readFileSync(inputPath, 'utf-8');

    // Parse email
    const mail = await simpleParser(emlContent);

    // Apply filters
    if (options.fromFilter) {
      const fromRegex = new RegExp(options.fromFilter, 'i');
      const fromAddresses = extractAddresses(mail.from);
      if (!fromAddresses.some((addr) => fromRegex.test(addr))) {
        return { success: true, sourceHash: 'skipped' }; // Skip this email
      }
    }

    if (options.dateAfter && mail.date) {
      const afterDate = new Date(options.dateAfter);
      if (mail.date < afterDate) {
        return { success: true, sourceHash: 'skipped' };
      }
    }

    if (options.dateBefore && mail.date) {
      const beforeDate = new Date(options.dateBefore);
      if (mail.date > beforeDate) {
        return { success: true, sourceHash: 'skipped' };
      }
    }

    // Convert email
    const { frontmatter, content } = await convertEmail(mail, inputPath, options);

    // Generate output path
    const outputPath = generateOutputPath(mail, outputDir, options);

    // Write output
    if (!options.dryRun) {
      mkdirSync(dirname(outputPath), { recursive: true });
      const output = serializeFrontmatter(frontmatter, content);
      writeFileSync(outputPath, output);
    }

    // Handle attachments
    if (options.extractAttachments && mail.attachments && mail.attachments.length > 0) {
      const attachmentDir = join(dirname(outputPath), 'attachments');

      if (!options.dryRun) {
        mkdirSync(attachmentDir, { recursive: true });

        for (const attachment of mail.attachments) {
          const attachmentPath = join(
            attachmentDir,
            attachment.filename || `unnamed-${attachment.checksum}`
          );
          writeFileSync(attachmentPath, attachment.content);
        }
      }
    }

    return {
      success: true,
      outputPath,
      sourceHash: frontmatter.source_hash,
      stats: {
        originalChars: emlContent.length,
        normalizedChars: content.length,
        metadataFields: Object.keys(frontmatter.metadata).length,
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
async function convertEml(inputPath: string, options: MboxOptions): Promise<void> {
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
    // Find EML files
    const pattern = '**/*.eml';
    files = await glob(pattern, { cwd: resolvedInput, absolute: true });
  } else {
    files = [resolvedInput];
  }

  // Apply max emails limit
  if (options.maxEmails && files.length > options.maxEmails) {
    files = files.slice(0, options.maxEmails);
  }

  if (files.length === 0) {
    logger.error('No EML files found');
    process.exit(1);
  }

  logger.info(`Found ${files.length} EML file(s)`);

  // Process files
  const progress = new ProgressReporter(files.length, { verbose: options.verbose });
  progress.start();

  let successCount = 0;
  let errorCount = 0;
  let skippedCount = 0;

  for (let i = 0; i < files.length; i++) {
    const file = files[i];
    const relativePath = file.replace(resolvedInput, '').replace(/^\//, '') || basename(file);

    progress.update(i, relativePath);

    const result = await convertEmlFile(file, outputDir, options);

    if (result.sourceHash === 'skipped') {
      skippedCount++;
    } else if (result.success) {
      successCount++;
      if (options.verbose) {
        progress.log(`  ✓ ${relativePath} → ${result.outputPath}`);
      }
    } else {
      errorCount++;
      progress.log(`  ✗ ${relativePath}: ${result.error}`);
    }
  }

  progress.finish(
    `Done: ${successCount} converted, ${skippedCount} skipped, ${errorCount} failed`
  );

  if (errorCount > 0) {
    process.exit(1);
  }
}

// CLI setup
const program = createBaseCommand(
  'convert-eml',
  'Convert EML email files to Markdown with YAML front matter'
);

addMboxOptions(program);

program
  .argument('<path>', 'EML file or directory to convert')
  .action(async (path: string, opts: MboxOptions) => {
    await convertEml(path, opts);
  });

program.parse();

// Export for use by MBOX converter (convertEmail already exported at declaration)
export { generateOutputPath };
