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
	/** Analyze file and show stats without converting */
	preview?: boolean;
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
		.option('--date-before <date>', 'Only emails before this date (ISO 8601)')
		.option('--preview', 'Analyze file and show stats without converting', false);
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
	/** Types to process: youtube, calendar, contacts, mail, drive */
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
	/** Skip trashed Drive files */
	skipTrashed: boolean;
	/** Analyze and show stats without converting */
	preview: boolean;
}

/**
 * Add Takeout-specific options to a command
 */
export function addTakeoutOptions(command: Command): Command {
	return command
		.addOption(
			new Option('--types <types...>', 'Types to process')
				.choices(['youtube', 'calendar', 'contacts', 'mail', 'drive'])
				.default(['youtube', 'calendar', 'contacts', 'drive']),
		)
		.option('--youtube-history', 'Include YouTube watch history', true)
		.option('--youtube-likes', 'Include YouTube liked videos', true)
		.option('--youtube-playlists', 'Include YouTube playlists', false)
		.option('--calendar-name <name>', 'Filter by calendar name')
		.option('--contacts-only-email', 'Only contacts with email addresses', false)
		.option('--skip-trashed', 'Skip trashed Drive files', true)
		.option('--preview', 'Analyze and show stats without converting', false);
}

/**
 * Scan-specific options
 */
export interface ScanOptions extends CommonOptions {
	/** Process subdirectories */
	recursive: boolean;
	/** Glob pattern for files */
	pattern: string;
	/** Maximum file size threshold in MB */
	maxFileSize: number;
	/** Maximum chunk count threshold */
	maxChunks: number;
	/** Show all files, not just problematic ones */
	all: boolean;
	/** Output format */
	format: 'table' | 'json';
}

/**
 * Add Scan-specific options to a command
 */
export function addScanOptions(command: Command): Command {
	return command
		.option('-r, --recursive', 'Process subdirectories', true)
		.option('--pattern <glob>', 'Glob pattern for files', '**/*.md')
		.option(
			'--max-file-size <mb>',
			'Max file size threshold in MB',
			(v: string) => parseInt(v, 10),
			20,
		)
		.option('--max-chunks <n>', 'Max chunk count threshold', (v: string) => parseInt(v, 10), 500)
		.option('--all', 'Show all files, not just problematic ones', false)
		.option('--format <type>', 'Output format: table or json', 'table');
}

/**
 * Split CLI options
 */
export interface SplitCliOptions extends CommonOptions {
	/** Heading level to split at (1-6) */
	splitLevel: number;
	/** Target max size per part in MB */
	targetSize: number;
	/** Target max chunks per part */
	targetChunks: number;
	/** Filename suffix pattern */
	suffix: string;
	/** Process directories recursively */
	recursive: boolean;
	/** Only split files exceeding upload limits */
	onlyOversized: boolean;
	/** Glob pattern for files */
	pattern: string;
	/** Max file size in MB (for oversized check) */
	maxFileSize: number;
	/** Max chunks per file (for oversized check) */
	maxChunks: number;
}

/**
 * Add Split-specific options to a command
 */
export function addSplitOptions(command: Command): Command {
	return command
		.option(
			'--split-level <n>',
			'Heading level to split at (1-6, default: 2)',
			(v: string) => parseInt(v, 10),
			2,
		)
		.option(
			'--target-size <mb>',
			'Target max size per part in MB',
			(v: string) => parseInt(v, 10),
			15,
		)
		.option(
			'--target-chunks <n>',
			'Target max chunks per part',
			(v: string) => parseInt(v, 10),
			400,
		)
		.option('--suffix <pattern>', 'Suffix for split files (use {n} for part number)', '-part-{n}')
		.option('-r, --recursive', 'Process directories recursively', false)
		.option('--only-oversized', 'Only split files exceeding upload limits', false)
		.option('--pattern <glob>', 'Glob pattern for files', '**/*.md')
		.option(
			'--max-file-size <mb>',
			'Max file size in MB (for --only-oversized)',
			(v: string) => parseInt(v, 10),
			20,
		)
		.option(
			'--max-chunks <n>',
			'Max chunks per file (for --only-oversized)',
			(v: string) => parseInt(v, 10),
			500,
		);
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
	/** Parallel DB insert operations (defaults to concurrency value) */
	insertConcurrency?: number;
	/** Glob pattern for files */
	pattern: string;
	/** Maximum retries for transient failures */
	maxRetries: number;
	/** Drop and recreate HNSW index for bulk uploads */
	dropIndex: boolean;
	/** Delay in ms between batch inserts (helps avoid DB overload) */
	delay: number;
	/** Chunks per INSERT statement (lower = less HNSW pressure) */
	chunkBatchSize: number;
	/** Allow files that would create >500 chunks (may fail) */
	allowLarge: boolean;
	/** Skip files that would create >500 chunks instead of failing */
	skipLarge: boolean;
	/** Maximum file size in MB */
	maxFileSize: number;
	/** Delay in ms between embedding API requests (helps avoid rate limits) */
	embeddingDelay: number;
	/** Automatically split files that exceed upload limits */
	autoSplit: boolean;
	/** Heading level for auto-split (1-6) */
	autoSplitLevel: number;
}

/**
 * Add Upload-specific options to a command
 */
export function addUploadOptions(command: Command): Command {
	return command
		.option('-r, --recursive', 'Process subdirectories', true)
		.option('--force', 'Re-upload even if in manifest', false)
		.option('--batch-size <n>', 'Embeddings per batch', (v: string) => parseInt(v, 10), 50)
		.option(
			'--concurrency <n>',
			'Parallel document processing (recommended: 5-10 for OpenAI, 3-5 for Ollama)',
			(v: string) => parseInt(v, 10),
			5,
		)
		.option(
			'--insert-concurrency <n>',
			'Parallel DB insert operations (defaults to --concurrency)',
			(v: string) => parseInt(v, 10),
		)
		.option('--pattern <glob>', 'Glob pattern for files', '**/*.md')
		.option(
			'--max-retries <n>',
			'Max retries for transient failures',
			(v: string) => parseInt(v, 10),
			3,
		)
		.option(
			'--drop-index',
			'Drop HNSW index before upload and recreate after (faster bulk inserts)',
			false,
		)
		.option(
			'--delay <ms>',
			'Delay in ms between batch inserts to reduce DB pressure',
			(v: string) => parseInt(v, 10),
			0,
		)
		.option(
			'--chunk-batch-size <n>',
			'Chunks per INSERT statement (lower = less HNSW pressure, default: 50)',
			(v: string) => parseInt(v, 10),
			50,
		)
		.option('--allow-large', 'Allow files >500 chunks (may fail with semantic chunking)', false)
		.option('--skip-large', 'Skip files >500 estimated chunks instead of failing', false)
		.option(
			'--max-file-size <mb>',
			'Max file size in MB (default: 20)',
			(v: string) => parseInt(v, 10),
			20,
		)
		.option(
			'--embedding-delay <ms>',
			'Delay in ms between embedding API requests (helps avoid rate limits, default: 0)',
			(v: string) => parseInt(v, 10),
			0,
		)
		.option('--auto-split', 'Automatically split files that exceed upload limits', false)
		.option(
			'--auto-split-level <n>',
			'Heading level for auto-split (1-6, default: 2)',
			(v: string) => parseInt(v, 10),
			2,
		);
}

/**
 * Parse comma-separated tags
 */
export function parseTags(value: string, previous: string[]): string[] {
	return previous.concat(value.split(',').map((t) => t.trim()));
}
