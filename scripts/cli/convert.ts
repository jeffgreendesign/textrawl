#!/usr/bin/env npx tsx
/**
 * Textrawl Converter CLI
 *
 * Unified entry point for all conversion utilities
 *
 * Usage:
 *   pnpm convert -- <command> [options]
 *   npx tsx scripts/cli/convert.ts <command> [options]
 *
 * Commands:
 *   mbox <file>      Convert MBOX email archive
 *   eml <path>       Convert EML file(s)
 *   takeout <path>   Convert Google Takeout archive
 *   html <path>      Convert HTML file(s)
 *   spotify <path>   Convert Spotify data export
 *   reddit <path>    Convert Reddit data export
 *   facebook <path>  Convert Facebook data export
 *   instagram <path> Convert Instagram data export
 *   auto <path>      Auto-detect format and convert
 */

import { spawn } from 'node:child_process';
import { existsSync, readdirSync, statSync } from 'node:fs';
import { dirname, extname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { Command } from 'commander';

const __dirname = dirname(fileURLToPath(import.meta.url));

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

	child.on('error', (err) => {
		console.error(`Failed to spawn converter "${script}": ${err.message}`);
		process.exit(1);
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
	.option('--types <types...>', 'Types to process (youtube,calendar,contacts,mail,drive)', [
		'youtube',
		'calendar',
		'contacts',
		'drive',
	])
	.option('--youtube-history', 'Include YouTube watch history', true)
	.option('--youtube-likes', 'Include YouTube liked videos', true)
	.option('--calendar-name <name>', 'Filter by calendar name')
	.option('--contacts-only-email', 'Only contacts with email', false)
	.option('--skip-trashed', 'Skip trashed Drive files', true)
	.option('--preview', 'Analyze and show stats without converting', false)
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
		if (!opts.skipTrashed) args.push('--no-skip-trashed');
		if (opts.preview) args.push('--preview');

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

// Spotify command
program
	.command('spotify <path>')
	.description('Convert Spotify data export to Markdown')
	.option('-o, --output <dir>', 'Output directory', './converted/spotify')
	.option('-v, --verbose', 'Enable verbose logging', false)
	.option('--dry-run', 'Preview without writing files', false)
	.option('-t, --tags <tags...>', 'Additional tags', [])
	.option('--history', 'Include streaming history', true)
	.option('--no-history', 'Exclude streaming history')
	.option('--playlists', 'Include playlists', true)
	.option('--no-playlists', 'Exclude playlists')
	.option('--library', 'Include library', true)
	.option('--no-library', 'Exclude library')
	.option('--min-play-time <seconds>', 'Minimum play time in seconds', '30')
	.option('--preview', 'Analyze and show stats without converting', false)
	.action((path, opts) => {
		const args = [path];
		if (opts.output) args.push('-o', opts.output);
		if (opts.verbose) args.push('-v');
		if (opts.dryRun) args.push('--dry-run');
		if (opts.tags.length) args.push('-t', ...opts.tags);
		if (!opts.history) args.push('--no-history');
		if (!opts.playlists) args.push('--no-playlists');
		if (!opts.library) args.push('--no-library');
		if (opts.minPlayTime) args.push('--min-play-time', opts.minPlayTime);
		if (opts.preview) args.push('--preview');

		runConverter('spotify', args);
	});

// Reddit command
program
	.command('reddit <path>')
	.description('Convert Reddit data export to Markdown')
	.option('-o, --output <dir>', 'Output directory', './converted/reddit')
	.option('-v, --verbose', 'Enable verbose logging', false)
	.option('--dry-run', 'Preview without writing files', false)
	.option('-t, --tags <tags...>', 'Additional tags', [])
	.option('--comments', 'Include comments', true)
	.option('--no-comments', 'Exclude comments')
	.option('--posts', 'Include posts', true)
	.option('--no-posts', 'Exclude posts')
	.option('--messages', 'Include messages', true)
	.option('--no-messages', 'Exclude messages')
	.option('--saved', 'Include saved items', true)
	.option('--no-saved', 'Exclude saved items')
	.option('--subreddit <name>', 'Filter by subreddit')
	.option('--preview', 'Analyze and show stats without converting', false)
	.action((path, opts) => {
		const args = [path];
		if (opts.output) args.push('-o', opts.output);
		if (opts.verbose) args.push('-v');
		if (opts.dryRun) args.push('--dry-run');
		if (opts.tags.length) args.push('-t', ...opts.tags);
		if (!opts.comments) args.push('--no-comments');
		if (!opts.posts) args.push('--no-posts');
		if (!opts.messages) args.push('--no-messages');
		if (!opts.saved) args.push('--no-saved');
		if (opts.subreddit) args.push('--subreddit', opts.subreddit);
		if (opts.preview) args.push('--preview');

		runConverter('reddit', args);
	});

// Facebook command
program
	.command('facebook <path>')
	.description('Convert Facebook data export to Markdown')
	.option('-o, --output <dir>', 'Output directory', './converted/facebook')
	.option('-v, --verbose', 'Enable verbose logging', false)
	.option('--dry-run', 'Preview without writing files', false)
	.option('-t, --tags <tags...>', 'Additional tags', [])
	.option('--messages', 'Include messages', true)
	.option('--no-messages', 'Exclude messages')
	.option('--posts', 'Include timeline posts', true)
	.option('--no-posts', 'Exclude timeline posts')
	.option('--preview', 'Analyze and show stats without converting', false)
	.action((path, opts) => {
		const args = [path];
		if (opts.output) args.push('-o', opts.output);
		if (opts.verbose) args.push('-v');
		if (opts.dryRun) args.push('--dry-run');
		if (opts.tags.length) args.push('-t', ...opts.tags);
		if (!opts.messages) args.push('--no-messages');
		if (!opts.posts) args.push('--no-posts');
		if (opts.preview) args.push('--preview');

		runConverter('facebook', args);
	});

// Instagram command
program
	.command('instagram <path>')
	.description('Convert Instagram data export to Markdown')
	.option('-o, --output <dir>', 'Output directory', './converted/instagram')
	.option('-v, --verbose', 'Enable verbose logging', false)
	.option('--dry-run', 'Preview without writing files', false)
	.option('-t, --tags <tags...>', 'Additional tags', [])
	.option('--messages', 'Include messages', true)
	.option('--no-messages', 'Exclude messages')
	.option('--comments', 'Include comments', true)
	.option('--no-comments', 'Exclude comments')
	.option('--likes', 'Include likes', true)
	.option('--no-likes', 'Exclude likes')
	.option('--preview', 'Analyze and show stats without converting', false)
	.action((path, opts) => {
		const args = [path];
		if (opts.output) args.push('-o', opts.output);
		if (opts.verbose) args.push('-v');
		if (opts.dryRun) args.push('--dry-run');
		if (opts.tags.length) args.push('-t', ...opts.tags);
		if (!opts.messages) args.push('--no-messages');
		if (!opts.comments) args.push('--no-comments');
		if (!opts.likes) args.push('--no-likes');
		if (opts.preview) args.push('--preview');

		runConverter('instagram', args);
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
		const targetPath = resolved;

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

			// Check for Spotify export
			if (files.some((f) => f.startsWith('StreamingHistory') && f.endsWith('.json'))) {
				format = 'spotify';
			}
			// Check for Reddit export
			else if (files.includes('comments.csv') || files.includes('posts.csv')) {
				format = 'reddit';
			}
			// Check for nested Reddit export
			else if (files.some((f) => f.includes('export_') && !f.endsWith('.zip'))) {
				format = 'reddit';
			}
			// Check for Facebook export
			else if (
				files.includes('messages') &&
				(files.includes('index.htm') || files.includes('html'))
			) {
				format = 'facebook';
			}
			// Check for Instagram export
			else if (
				files.includes('messages') &&
				files.includes('likes') &&
				files.includes('comments')
			) {
				format = 'instagram';
			}
			// Check for EML files
			else if (files.some((f) => f.endsWith('.eml'))) {
				format = 'eml';
			}
			// Check for Google Drive Takeout folder (has -info.json companion files)
			else if (files.some((f) => f.endsWith('-info.json'))) {
				format = 'takeout';
			}
			// Check for Takeout archive
			else if (files.some((f) => f.includes('Takeout') || f.includes('YouTube'))) {
				format = 'takeout';
			}
			// Default to HTML for web pages
			else if (files.some((f) => f.endsWith('.html') || f.endsWith('.htm'))) {
				format = 'html';
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
