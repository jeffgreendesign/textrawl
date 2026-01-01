/**
 * CLI argument parsing utilities using Commander
 */

import { Command, Option } from 'commander';

/**
 * Common CLI options shared across all commands
 */
export interface CommonOptions {
  /** Output directory for converted files */
  output: string;
  /** Enable verbose logging */
  verbose: boolean;
  /** Preview without writing files */
  dryRun: boolean;
  /** Path to .env file */
  config: string;
  /** Preserve raw text without normalization */
  raw: boolean;
  /** Keep email signatures */
  keepSignatures: boolean;
  /** Additional tags to add */
  tags: string[];
}

/**
 * Create a base command with common options
 */
export function createBaseCommand(name: string, description: string): Command {
  return new Command(name)
    .description(description)
    .option('-o, --output <dir>', 'Output directory for converted files', './converted')
    .option('-v, --verbose', 'Enable verbose logging', false)
    .option('--dry-run', 'Preview without writing files', false)
    .option('-c, --config <path>', 'Path to .env file', '.env')
    .option('--raw', 'Preserve raw text without normalization', false)
    .option('--keep-signatures', 'Keep email signatures', false)
    .option('-t, --tags <tags...>', 'Additional tags to add', []);
}

/**
 * MBOX-specific options
 */
export interface MboxOptions extends CommonOptions {
  /** Extract attachments to subdirectory */
  extractAttachments: boolean;
  /** Organize by YYYY-MM folders */
  dateFolders: boolean;
  /** Maximum emails to process */
  maxEmails?: number;
  /** Filter by sender (regex) */
  fromFilter?: string;
  /** Only emails after this date */
  dateAfter?: string;
  /** Only emails before this date */
  dateBefore?: string;
}

/**
 * Add MBOX-specific options to a command
 */
export function addMboxOptions(command: Command): Command {
  return command
    .option('--extract-attachments', 'Extract attachments to subdirectory', false)
    .option('--date-folders', 'Organize by YYYY-MM folders', true)
    .option('--max-emails <n>', 'Maximum emails to process', parseInt)
    .option('--from-filter <regex>', 'Filter by sender (regex)')
    .option('--date-after <date>', 'Only emails after this date (ISO 8601)')
    .option('--date-before <date>', 'Only emails before this date (ISO 8601)');
}

/**
 * HTML-specific options
 */
export interface HtmlOptions extends CommonOptions {
  /** Process directories recursively */
  recursive: boolean;
  /** Extract and save images */
  extractImages: boolean;
  /** Remove boilerplate (nav, footer, ads) */
  cleanBoilerplate: boolean;
  /** Base URL for relative links */
  urlBase?: string;
}

/**
 * Add HTML-specific options to a command
 */
export function addHtmlOptions(command: Command): Command {
  return command
    .option('-r, --recursive', 'Process directories recursively', false)
    .option('--extract-images', 'Extract and save images', false)
    .option('--clean-boilerplate', 'Remove boilerplate (nav, footer, ads)', true)
    .option('--url-base <url>', 'Base URL for relative links');
}

/**
 * Takeout-specific options
 */
export interface TakeoutOptions extends CommonOptions {
  /** Types to process: youtube, calendar, contacts, mail */
  types: string[];
  /** Include YouTube watch history */
  youtubeHistory: boolean;
  /** Include YouTube liked videos */
  youtubeLikes: boolean;
  /** Include YouTube playlists */
  youtubePlaylists: boolean;
  /** Filter by calendar name */
  calendarName?: string;
  /** Only contacts with email addresses */
  contactsOnlyEmail: boolean;
}

/**
 * Add Takeout-specific options to a command
 */
export function addTakeoutOptions(command: Command): Command {
  return command
    .addOption(
      new Option('--types <types...>', 'Types to process')
        .choices(['youtube', 'calendar', 'contacts', 'mail'])
        .default(['youtube', 'calendar', 'contacts'])
    )
    .option('--youtube-history', 'Include YouTube watch history', true)
    .option('--youtube-likes', 'Include YouTube liked videos', true)
    .option('--youtube-playlists', 'Include YouTube playlists', false)
    .option('--calendar-name <name>', 'Filter by calendar name')
    .option('--contacts-only-email', 'Only contacts with email addresses', false);
}

/**
 * Upload-specific options
 */
export interface UploadOptions extends CommonOptions {
  /** Process subdirectories */
  recursive: boolean;
  /** Re-upload even if in manifest */
  force: boolean;
  /** Embeddings per batch */
  batchSize: number;
  /** Parallel document processing */
  concurrency: number;
  /** Glob pattern for files */
  pattern: string;
}

/**
 * Add Upload-specific options to a command
 */
export function addUploadOptions(command: Command): Command {
  return command
    .option('-r, --recursive', 'Process subdirectories', true)
    .option('--force', 'Re-upload even if in manifest', false)
    .option('--batch-size <n>', 'Embeddings per batch', parseInt, 50)
    .option('--concurrency <n>', 'Parallel document processing', parseInt, 5)
    .option('--pattern <glob>', 'Glob pattern for files', '**/*.md');
}

/**
 * Parse comma-separated tags
 */
export function parseTags(value: string, previous: string[]): string[] {
  return previous.concat(value.split(',').map((t) => t.trim()));
}
