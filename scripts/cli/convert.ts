#!/usr/bin/env npx tsx
/**
 * Textrawl Converter CLI
 *
 * Unified entry point for all conversion utilities
 *
 * Usage:
 *   npm run convert -- <command> [options]
 *   npx tsx scripts/cli/convert.ts <command> [options]
 *
 * Commands:
 *   mbox <file>      Convert MBOX email archive
 *   eml <path>       Convert EML file(s)
 *   takeout <path>   Convert Google Takeout archive
 *   html <path>      Convert HTML file(s)
 *   auto <path>      Auto-detect format and convert
 */

import { Command } from 'commander';
import { existsSync, statSync, readdirSync } from 'fs';
import { extname, resolve } from 'path';
import { spawn } from 'child_process';

const program = new Command();

program
  .name('textrawl-convert')
  .description('Convert various file formats to Markdown for Textrawl')
  .version('1.0.0');

/**
 * Run a converter script with arguments
 */
function runConverter(script: string, args: string[]): void {
  const scriptPath = resolve(__dirname, 'converters', `${script}.ts`);

  const child = spawn('npx', ['tsx', scriptPath, ...args], {
    stdio: 'inherit',
    cwd: process.cwd(),
  });

  child.on('exit', (code) => {
    process.exit(code || 0);
  });
}

// MBOX command
program
  .command('mbox <file>')
  .description('Convert MBOX email archive to Markdown')
  .option('-o, --output <dir>', 'Output directory', './converted/emails')
  .option('-v, --verbose', 'Enable verbose logging', false)
  .option('--dry-run', 'Preview without writing files', false)
  .option('--raw', 'Preserve raw text without normalization', false)
  .option('--keep-signatures', 'Keep email signatures', false)
  .option('-t, --tags <tags...>', 'Additional tags', [])
  .option('--extract-attachments', 'Extract attachments', false)
  .option('--date-folders', 'Organize by YYYY-MM folders', true)
  .option('--max-emails <n>', 'Maximum emails to process')
  .option('--from-filter <regex>', 'Filter by sender')
  .option('--date-after <date>', 'Only emails after date')
  .option('--date-before <date>', 'Only emails before date')
  .action((file, opts) => {
    const args = [file];
    if (opts.output) args.push('-o', opts.output);
    if (opts.verbose) args.push('-v');
    if (opts.dryRun) args.push('--dry-run');
    if (opts.raw) args.push('--raw');
    if (opts.keepSignatures) args.push('--keep-signatures');
    if (opts.tags.length) args.push('-t', ...opts.tags);
    if (opts.extractAttachments) args.push('--extract-attachments');
    if (!opts.dateFolders) args.push('--no-date-folders');
    if (opts.maxEmails) args.push('--max-emails', opts.maxEmails);
    if (opts.fromFilter) args.push('--from-filter', opts.fromFilter);
    if (opts.dateAfter) args.push('--date-after', opts.dateAfter);
    if (opts.dateBefore) args.push('--date-before', opts.dateBefore);

    runConverter('mbox', args);
  });

// EML command
program
  .command('eml <path>')
  .description('Convert EML file(s) to Markdown')
  .option('-o, --output <dir>', 'Output directory', './converted/emails')
  .option('-v, --verbose', 'Enable verbose logging', false)
  .option('--dry-run', 'Preview without writing files', false)
  .option('--raw', 'Preserve raw text without normalization', false)
  .option('--keep-signatures', 'Keep email signatures', false)
  .option('-t, --tags <tags...>', 'Additional tags', [])
  .option('--extract-attachments', 'Extract attachments', false)
  .option('--date-folders', 'Organize by YYYY-MM folders', true)
  .action((path, opts) => {
    const args = [path];
    if (opts.output) args.push('-o', opts.output);
    if (opts.verbose) args.push('-v');
    if (opts.dryRun) args.push('--dry-run');
    if (opts.raw) args.push('--raw');
    if (opts.keepSignatures) args.push('--keep-signatures');
    if (opts.tags.length) args.push('-t', ...opts.tags);
    if (opts.extractAttachments) args.push('--extract-attachments');
    if (!opts.dateFolders) args.push('--no-date-folders');

    runConverter('eml', args);
  });

// Takeout command
program
  .command('takeout <path>')
  .description('Convert Google Takeout archive to Markdown')
  .option('-o, --output <dir>', 'Output directory', './converted/takeout')
  .option('-v, --verbose', 'Enable verbose logging', false)
  .option('--dry-run', 'Preview without writing files', false)
  .option('-t, --tags <tags...>', 'Additional tags', [])
  .option('--types <types...>', 'Types to process (youtube,calendar,contacts,mail)', ['youtube', 'calendar', 'contacts'])
  .option('--youtube-history', 'Include YouTube watch history', true)
  .option('--youtube-likes', 'Include YouTube liked videos', true)
  .option('--calendar-name <name>', 'Filter by calendar name')
  .option('--contacts-only-email', 'Only contacts with email', false)
  .action((path, opts) => {
    const args = [path];
    if (opts.output) args.push('-o', opts.output);
    if (opts.verbose) args.push('-v');
    if (opts.dryRun) args.push('--dry-run');
    if (opts.tags.length) args.push('-t', ...opts.tags);
    if (opts.types.length) args.push('--types', ...opts.types);
    if (!opts.youtubeHistory) args.push('--no-youtube-history');
    if (!opts.youtubeLikes) args.push('--no-youtube-likes');
    if (opts.calendarName) args.push('--calendar-name', opts.calendarName);
    if (opts.contactsOnlyEmail) args.push('--contacts-only-email');

    runConverter('takeout', args);
  });

// HTML command
program
  .command('html <path>')
  .description('Convert HTML file(s) to Markdown')
  .option('-o, --output <dir>', 'Output directory', './converted/web')
  .option('-v, --verbose', 'Enable verbose logging', false)
  .option('--dry-run', 'Preview without writing files', false)
  .option('--raw', 'Preserve raw text without normalization', false)
  .option('-t, --tags <tags...>', 'Additional tags', [])
  .option('-r, --recursive', 'Process directories recursively', false)
  .option('--extract-images', 'Extract images', false)
  .option('--clean-boilerplate', 'Remove boilerplate', true)
  .option('--url-base <url>', 'Base URL for relative links')
  .action((path, opts) => {
    const args = [path];
    if (opts.output) args.push('-o', opts.output);
    if (opts.verbose) args.push('-v');
    if (opts.dryRun) args.push('--dry-run');
    if (opts.raw) args.push('--raw');
    if (opts.tags.length) args.push('-t', ...opts.tags);
    if (opts.recursive) args.push('-r');
    if (opts.extractImages) args.push('--extract-images');
    if (!opts.cleanBoilerplate) args.push('--no-clean-boilerplate');
    if (opts.urlBase) args.push('--url-base', opts.urlBase);

    runConverter('html', args);
  });

// Auto-detect command
program
  .command('auto <path>')
  .description('Auto-detect format and convert')
  .option('-o, --output <dir>', 'Output directory', './converted')
  .option('-v, --verbose', 'Enable verbose logging', false)
  .option('--dry-run', 'Preview without writing files', false)
  .action((inputPath, opts) => {
    const resolved = resolve(inputPath);

    if (!existsSync(resolved)) {
      console.error(`Error: Path not found: ${resolved}`);
      process.exit(1);
    }

    const stat = statSync(resolved);

    // Detect format
    let format: string | null = null;
    let targetPath = resolved;

    if (stat.isFile()) {
      const ext = extname(resolved).toLowerCase();

      if (ext === '.mbox') {
        format = 'mbox';
      } else if (ext === '.eml') {
        format = 'eml';
      } else if (ext === '.zip') {
        // Check if it looks like a Takeout archive
        format = 'takeout';
      } else if (ext === '.html' || ext === '.htm') {
        format = 'html';
      }
    } else if (stat.isDirectory()) {
      // Look at contents to determine type
      const files = readdirSync(resolved);

      if (files.some((f) => f.endsWith('.eml'))) {
        format = 'eml';
      } else if (files.some((f) => f.endsWith('.html') || f.endsWith('.htm'))) {
        format = 'html';
      } else if (files.some((f) => f.includes('Takeout') || f.includes('YouTube'))) {
        format = 'takeout';
      }
    }

    if (!format) {
      console.error('Error: Could not auto-detect format. Please use a specific command.');
      process.exit(1);
    }

    console.log(`Detected format: ${format}`);

    const args = [targetPath];
    if (opts.output) args.push('-o', `${opts.output}/${format}`);
    if (opts.verbose) args.push('-v');
    if (opts.dryRun) args.push('--dry-run');

    runConverter(format, args);
  });

program.parse();
