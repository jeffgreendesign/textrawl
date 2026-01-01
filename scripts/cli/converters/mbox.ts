#!/usr/bin/env npx tsx
/**
 * MBOX to Markdown Converter
 *
 * Converts MBOX email archives to markdown files with YAML front matter
 *
 * Usage:
 *   npm run convert:mbox -- <mbox-file> [options]
 *   npx tsx scripts/cli/converters/mbox.ts <mbox-file> [options]
 */

import { createHash } from 'crypto';
import { createReadStream, writeFileSync, existsSync, mkdirSync } from 'fs';
import { dirname, resolve } from 'path';
import { createInterface } from 'readline';
import { simpleParser, type ParsedMail } from 'mailparser';

import { createBaseCommand, addMboxOptions, type MboxOptions } from '../lib/args.js';
import { serializeFrontmatter } from '../lib/frontmatter.js';
import { ProgressReporter, logger } from '../lib/progress.js';
import type { ConversionResult } from '../lib/types.js';
import { convertEmail, generateOutputPath } from './eml.js';

/**
 * Parse MBOX file and yield individual messages
 *
 * MBOX format: Messages are separated by lines starting with "From "
 * Each message is a complete email including headers and body
 */
async function* parseMbox(
  filePath: string
): AsyncGenerator<{ raw: string; index: number }> {
  const stream = createReadStream(filePath, { encoding: 'utf-8' });
  const rl = createInterface({ input: stream, crlfDelay: Infinity });

  let currentMessage: string[] = [];
  let messageIndex = 0;
  let inMessage = false;

  for await (const line of rl) {
    // Check for message boundary (line starting with "From ")
    // Note: "From " at the start of a line in the body should be escaped as ">From "
    if (line.startsWith('From ') && (currentMessage.length === 0 || line.match(/^From \S+.*\d{4}$/))) {
      // Yield previous message if exists
      if (currentMessage.length > 0 && inMessage) {
        yield { raw: currentMessage.join('\n'), index: messageIndex };
        messageIndex++;
      }

      // Start new message (skip the "From " line itself)
      currentMessage = [];
      inMessage = true;
    } else if (inMessage) {
      // Unescape "From " lines in body
      if (line.startsWith('>From ')) {
        currentMessage.push(line.slice(1));
      } else {
        currentMessage.push(line);
      }
    }
  }

  // Yield final message
  if (currentMessage.length > 0 && inMessage) {
    yield { raw: currentMessage.join('\n'), index: messageIndex };
  }
}

/**
 * Count messages in MBOX file (for progress reporting)
 */
async function countMboxMessages(filePath: string): Promise<number> {
  const stream = createReadStream(filePath, { encoding: 'utf-8' });
  const rl = createInterface({ input: stream, crlfDelay: Infinity });

  let count = 0;
  let prevLineEmpty = true;

  for await (const line of rl) {
    if (line.startsWith('From ') && line.match(/^From \S+.*\d{4}$/)) {
      count++;
    }
    prevLineEmpty = line.trim() === '';
  }

  return count;
}

/**
 * Extract addresses helper
 */
function extractAddresses(mail: ParsedMail): string[] {
  const result: string[] = [];
  if (mail.from) {
    const from = Array.isArray(mail.from) ? mail.from : [mail.from];
    for (const f of from) {
      if (f.value) {
        for (const v of f.value) {
          if (v.address) result.push(v.address);
        }
      }
    }
  }
  return result;
}

/**
 * Convert a single message from MBOX
 */
async function convertMboxMessage(
  rawMessage: string,
  index: number,
  mboxPath: string,
  outputDir: string,
  options: MboxOptions
): Promise<ConversionResult> {
  try {
    // Parse the email
    const mail = await simpleParser(rawMessage);

    // Apply filters
    if (options.fromFilter) {
      const fromRegex = new RegExp(options.fromFilter, 'i');
      const fromAddresses = extractAddresses(mail);
      if (!fromAddresses.some((addr) => fromRegex.test(addr))) {
        return { success: true, sourceHash: 'skipped' };
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

    // Convert email using shared logic
    const { frontmatter, content } = await convertEmail(mail, `${mboxPath}#${index}`, options);

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
      const attachmentDir = dirname(outputPath).replace(/\/[^/]+$/, '/attachments');

      if (!options.dryRun) {
        mkdirSync(attachmentDir, { recursive: true });

        for (const attachment of mail.attachments) {
          const filename = attachment.filename || `unnamed-${attachment.checksum}`;
          // Prefix with date to avoid collisions
          const date = mail.date || new Date();
          const prefix = `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}-${String(date.getDate()).padStart(2, '0')}`;
          const attachmentPath = `${attachmentDir}/${prefix}-${filename}`;
          writeFileSync(attachmentPath, attachment.content);
        }
      }
    }

    return {
      success: true,
      outputPath,
      sourceHash: frontmatter.source_hash,
      stats: {
        originalChars: rawMessage.length,
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
async function convertMbox(inputPath: string, options: MboxOptions): Promise<void> {
  const resolvedInput = resolve(inputPath);

  // Check if input exists
  if (!existsSync(resolvedInput)) {
    logger.error(`MBOX file not found: ${resolvedInput}`);
    process.exit(1);
  }

  const outputDir = resolve(options.output);

  logger.info(`Counting messages in MBOX file...`);
  let totalMessages = await countMboxMessages(resolvedInput);

  // Apply max emails limit
  if (options.maxEmails && totalMessages > options.maxEmails) {
    logger.info(`Limiting to first ${options.maxEmails} of ${totalMessages} messages`);
    totalMessages = options.maxEmails;
  }

  logger.info(`Processing ${totalMessages} messages`);

  // Process messages
  const progress = new ProgressReporter(totalMessages, { verbose: options.verbose });
  progress.start();

  let successCount = 0;
  let errorCount = 0;
  let skippedCount = 0;
  let processedCount = 0;

  for await (const { raw, index } of parseMbox(resolvedInput)) {
    // Check max emails limit
    if (options.maxEmails && processedCount >= options.maxEmails) {
      break;
    }

    progress.update(processedCount, `Message ${index + 1}`);

    const result = await convertMboxMessage(
      raw,
      index,
      resolvedInput,
      outputDir,
      options
    );

    if (result.sourceHash === 'skipped') {
      skippedCount++;
    } else if (result.success) {
      successCount++;
      if (options.verbose && result.outputPath) {
        progress.log(`  ✓ Message ${index + 1} → ${result.outputPath}`);
      }
    } else {
      errorCount++;
      progress.log(`  ✗ Message ${index + 1}: ${result.error}`);
    }

    processedCount++;
  }

  progress.finish(
    `Done: ${successCount} converted, ${skippedCount} skipped, ${errorCount} failed`
  );

  // Summary
  logger.info('Summary:', {
    total: processedCount,
    converted: successCount,
    skipped: skippedCount,
    errors: errorCount,
    outputDir,
  });

  if (errorCount > 0) {
    process.exit(1);
  }
}

// CLI setup
const program = createBaseCommand(
  'convert-mbox',
  'Convert MBOX email archive to Markdown files with YAML front matter'
);

addMboxOptions(program);

program
  .argument('<mbox-file>', 'MBOX file to convert')
  .action(async (path: string, opts: MboxOptions) => {
    await convertMbox(path, opts);
  });

program.parse();
