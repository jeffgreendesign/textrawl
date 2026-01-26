#!/usr/bin/env npx tsx
/**
 * Reddit Data Export Converter
 *
 * Converts Reddit export data (comments, posts, saved items, messages) to markdown with YAML front matter
 *
 * Usage:
 *   npm run convert -- reddit <path> [options]
 *   npx tsx scripts/cli/converters/reddit.ts <path> [options]
 */

import { createHash } from 'node:crypto';
import { existsSync, mkdirSync, readFileSync, readdirSync, statSync, writeFileSync } from 'node:fs';
import { basename, join, resolve } from 'node:path';

import { analyzeReddit } from '../lib/analyze.js';
import { type CommonOptions, createBaseCommand } from '../lib/args.js';
import { createFrontmatter, serializeFrontmatter } from '../lib/frontmatter.js';
import { slugify } from '../lib/normalizer.js';
import { ProgressReporter, logger } from '../lib/progress.js';
import type { ContentType, ConversionResult } from '../lib/types.js';

/**
 * Reddit comment from CSV
 */
interface RedditComment {
	id: string;
	permalink: string;
	date: string;
	ip: string;
	subreddit: string;
	gildings: string;
	link: string;
	parent: string;
	body: string;
}

/**
 * Reddit post from CSV
 */
interface RedditPost {
	id: string;
	permalink: string;
	date: string;
	ip: string;
	subreddit: string;
	gildings: string;
	title: string;
	url: string;
	body: string;
}

/**
 * Reddit message from CSV
 */
interface RedditMessage {
	id: string;
	permalink: string;
	thread_id: string;
	date: string;
	ip: string;
	from: string;
	to: string;
	subject: string;
	body: string;
}

/**
 * Reddit saved item (just id and permalink)
 */
interface RedditSavedItem {
	id: string;
	permalink: string;
}

/**
 * Reddit converter options
 */
export interface RedditOptions extends CommonOptions {
	/** Include comments */
	comments: boolean;
	/** Include posts */
	posts: boolean;
	/** Include messages */
	messages: boolean;
	/** Include saved posts/comments */
	saved: boolean;
	/** Filter by subreddit */
	subreddit?: string;
	/** Analyze and show stats without converting */
	preview: boolean;
}

/**
 * Simple CSV parser that handles quoted fields with commas
 */
function parseCSV<T>(content: string): T[] {
	const lines = content.split('\n');
	if (lines.length < 2) return [];

	// Parse header
	const headerLine = lines[0];
	const headers = parseCSVLine(headerLine);

	// Parse rows
	const rows: T[] = [];

	for (let i = 1; i < lines.length; i++) {
		const line = lines[i].trim();
		if (!line) continue;

		const values = parseCSVLine(line);
		if (values.length !== headers.length) continue;

		const row: Record<string, string> = {};
		for (let j = 0; j < headers.length; j++) {
			row[headers[j]] = values[j];
		}
		rows.push(row as T);
	}

	return rows;
}

/**
 * Parse a single CSV line handling quoted fields
 */
function parseCSVLine(line: string): string[] {
	const values: string[] = [];
	let current = '';
	let inQuotes = false;

	for (let i = 0; i < line.length; i++) {
		const char = line[i];
		const nextChar = line[i + 1];

		if (char === '"') {
			if (inQuotes && nextChar === '"') {
				// Escaped quote
				current += '"';
				i++;
			} else {
				// Toggle quote mode
				inQuotes = !inQuotes;
			}
		} else if (char === ',' && !inQuotes) {
			values.push(current);
			current = '';
		} else {
			current += char;
		}
	}

	values.push(current);
	return values;
}

/**
 * Find Reddit export directory (may be nested)
 */
function findRedditDir(inputPath: string): string {
	// Check if this directory has Reddit files directly
	const files = readdirSync(inputPath);
	if (files.includes('comments.csv') || files.includes('posts.csv')) {
		return inputPath;
	}

	// Look for a subdirectory that looks like a Reddit export
	for (const item of files) {
		const itemPath = join(inputPath, item);
		try {
			const stats = statSync(itemPath);
			if (stats.isDirectory()) {
				const subFiles = readdirSync(itemPath);
				if (subFiles.includes('comments.csv') || subFiles.includes('posts.csv')) {
					return itemPath;
				}
			}
		} catch {
			// Skip if can't read (permission error, deleted, etc.)
		}
	}

	return inputPath;
}

/**
 * Find Reddit data files in a directory
 */
function findRedditFiles(dir: string): {
	comments: string | null;
	posts: string | null;
	messages: string | null;
	savedPosts: string | null;
	savedComments: string | null;
} {
	const files = readdirSync(dir);

	return {
		comments: files.includes('comments.csv') ? join(dir, 'comments.csv') : null,
		posts: files.includes('posts.csv') ? join(dir, 'posts.csv') : null,
		messages: files.includes('messages.csv') ? join(dir, 'messages.csv') : null,
		savedPosts: files.includes('saved_posts.csv') ? join(dir, 'saved_posts.csv') : null,
		savedComments: files.includes('saved_comments.csv') ? join(dir, 'saved_comments.csv') : null,
	};
}

/**
 * Convert comments to markdown files
 */
async function convertComments(
	dir: string,
	commentsFile: string,
	outputDir: string,
	options: RedditOptions,
	progress: ProgressReporter,
): Promise<{ success: number; errors: number; skipped: number }> {
	const content = readFileSync(commentsFile, 'utf-8');
	const comments = parseCSV<RedditComment>(content);

	const commentsDir = join(outputDir, 'comments');
	if (!options.dryRun) {
		mkdirSync(commentsDir, { recursive: true });
	}

	let success = 0;
	let errors = 0;
	let skipped = 0;

	for (let i = 0; i < comments.length; i++) {
		const comment = comments[i];
		progress.update(i + 1, `r/${comment.subreddit}`);

		// Filter by subreddit
		if (options.subreddit && comment.subreddit.toLowerCase() !== options.subreddit.toLowerCase()) {
			skipped++;
			continue;
		}

		try {
			// Parse date
			const date = new Date(comment.date);
			const dateStr = date.toISOString().split('T')[0];

			// Generate content
			const contentLines = [
				`# Comment in r/${comment.subreddit}`,
				'',
				comment.body,
				'',
				'---',
				'',
				`**Subreddit:** r/${comment.subreddit}`,
				`**Date:** ${comment.date}`,
				`**Link:** ${comment.permalink}`,
			];

			if (comment.parent) {
				contentLines.push(`**Parent:** ${comment.parent}`);
			}

			const markdownContent = contentLines.join('\n');

			// Create hash
			const sourceHash = createHash('sha256').update(comment.id).digest('hex');

			// Create frontmatter
			const frontmatter = createFrontmatter({
				title: `Comment in r/${comment.subreddit}`,
				sourceType: 'file',
				contentType: 'document' as ContentType,
				sourceFile: basename(dir),
				sourceHash: `sha256:${sourceHash}`,
				createdAt: date,
				tags: ['imported', 'reddit', 'comment', comment.subreddit],
				metadata: {
					reddit_id: comment.id,
					subreddit: comment.subreddit,
					permalink: comment.permalink,
					gildings: parseInt(comment.gildings) || 0,
				},
			});

			// Add user tags
			if (options.tags.length > 0) {
				frontmatter.tags = [...new Set([...frontmatter.tags, ...options.tags])];
			}

			// Generate filename
			const slug = slugify(comment.body.slice(0, 50), 40);
			const filename = `${dateStr}-${comment.subreddit}-${slug}.md`;
			const outputPath = join(commentsDir, filename);

			if (!options.dryRun) {
				const output = serializeFrontmatter(frontmatter, markdownContent);
				writeFileSync(outputPath, output);
			}

			success++;

			if (options.verbose) {
				progress.log(`  ✓ Comment in r/${comment.subreddit}`);
			}
		} catch (error) {
			errors++;
			progress.log(
				`  ✗ Comment ${comment.id}: ${error instanceof Error ? error.message : String(error)}`,
			);
		}
	}

	return { success, errors, skipped };
}

/**
 * Convert posts to markdown files
 */
async function convertPosts(
	dir: string,
	postsFile: string,
	outputDir: string,
	options: RedditOptions,
	progress: ProgressReporter,
): Promise<{ success: number; errors: number; skipped: number }> {
	const content = readFileSync(postsFile, 'utf-8');
	const posts = parseCSV<RedditPost>(content);

	const postsDir = join(outputDir, 'posts');
	if (!options.dryRun) {
		mkdirSync(postsDir, { recursive: true });
	}

	let success = 0;
	let errors = 0;
	let skipped = 0;

	for (let i = 0; i < posts.length; i++) {
		const post = posts[i];
		progress.update(i + 1, post.title || `r/${post.subreddit}`);

		// Filter by subreddit
		if (options.subreddit && post.subreddit.toLowerCase() !== options.subreddit.toLowerCase()) {
			skipped++;
			continue;
		}

		try {
			// Parse date
			const date = new Date(post.date);
			const dateStr = date.toISOString().split('T')[0];

			// Generate content
			const contentLines = [`# ${post.title || '(No Title)'}`, ''];

			if (post.body) {
				contentLines.push(post.body, '');
			}

			if (post.url && post.url !== post.permalink) {
				contentLines.push(`**Link:** ${post.url}`, '');
			}

			contentLines.push(
				'---',
				'',
				`**Subreddit:** r/${post.subreddit}`,
				`**Date:** ${post.date}`,
				`**Permalink:** ${post.permalink}`,
			);

			const markdownContent = contentLines.join('\n');

			// Create hash
			const sourceHash = createHash('sha256').update(post.id).digest('hex');

			// Create frontmatter
			const frontmatter = createFrontmatter({
				title: post.title || `Post in r/${post.subreddit}`,
				sourceType: 'file',
				contentType: 'document' as ContentType,
				sourceFile: basename(dir),
				sourceHash: `sha256:${sourceHash}`,
				createdAt: date,
				tags: ['imported', 'reddit', 'post', post.subreddit],
				metadata: {
					reddit_id: post.id,
					subreddit: post.subreddit,
					permalink: post.permalink,
					url: post.url || undefined,
					gildings: parseInt(post.gildings) || 0,
				},
			});

			// Add user tags
			if (options.tags.length > 0) {
				frontmatter.tags = [...new Set([...frontmatter.tags, ...options.tags])];
			}

			// Generate filename
			const titleSlug = slugify(post.title || 'untitled', 50);
			const filename = `${dateStr}-${post.subreddit}-${titleSlug}.md`;
			const outputPath = join(postsDir, filename);

			if (!options.dryRun) {
				const output = serializeFrontmatter(frontmatter, markdownContent);
				writeFileSync(outputPath, output);
			}

			success++;

			if (options.verbose) {
				progress.log(`  ✓ Post: ${post.title || '(No Title)'}`);
			}
		} catch (error) {
			errors++;
			progress.log(
				`  ✗ Post ${post.id}: ${error instanceof Error ? error.message : String(error)}`,
			);
		}
	}

	return { success, errors, skipped };
}

/**
 * Convert messages to markdown files
 */
async function convertMessages(
	dir: string,
	messagesFile: string,
	outputDir: string,
	options: RedditOptions,
	progress: ProgressReporter,
): Promise<{ success: number; errors: number }> {
	const content = readFileSync(messagesFile, 'utf-8');
	const messages = parseCSV<RedditMessage>(content);

	const messagesDir = join(outputDir, 'messages');
	if (!options.dryRun) {
		mkdirSync(messagesDir, { recursive: true });
	}

	// Group messages by thread
	const threads = new Map<string, RedditMessage[]>();
	for (const message of messages) {
		const threadId = message.thread_id || message.id;
		const existing = threads.get(threadId) || [];
		existing.push(message);
		threads.set(threadId, existing);
	}

	let success = 0;
	let errors = 0;
	let processed = 0;

	for (const [threadId, threadMessages] of threads.entries()) {
		processed++;
		const firstMessage = threadMessages[0];
		progress.update(processed, firstMessage.subject || 'Message');

		try {
			// Sort by date with NaN handling
			threadMessages.sort((a, b) => {
				const timeA = new Date(a.date).getTime();
				const timeB = new Date(b.date).getTime();
				const safeA = isNaN(timeA) ? Number.POSITIVE_INFINITY : timeA;
				const safeB = isNaN(timeB) ? Number.POSITIVE_INFINITY : timeB;
				return safeA - safeB;
			});

			// Parse date of first message
			const date = new Date(firstMessage.date);
			const dateStr = date.toISOString().split('T')[0];

			// Generate content
			const contentLines = [`# ${firstMessage.subject || '(No Subject)'}`, ''];

			for (const msg of threadMessages) {
				contentLines.push(
					`## ${msg.from} → ${msg.to}`,
					`*${msg.date}*`,
					'',
					msg.body,
					'',
					'---',
					'',
				);
			}

			const markdownContent = contentLines.join('\n');

			// Create hash
			const sourceHash = createHash('sha256').update(threadId).digest('hex');

			// Create frontmatter
			const frontmatter = createFrontmatter({
				title: firstMessage.subject || 'Reddit Message',
				sourceType: 'file',
				contentType: 'document' as ContentType,
				sourceFile: basename(dir),
				sourceHash: `sha256:${sourceHash}`,
				createdAt: date,
				tags: ['imported', 'reddit', 'message'],
				metadata: {
					thread_id: threadId,
					message_count: threadMessages.length,
					participants: [...new Set(threadMessages.flatMap((m) => [m.from, m.to]))],
				},
			});

			// Add user tags
			if (options.tags.length > 0) {
				frontmatter.tags = [...new Set([...frontmatter.tags, ...options.tags])];
			}

			// Generate filename
			const slug = slugify(firstMessage.subject || 'message', 50);
			const filename = `${dateStr}-${slug}.md`;
			const outputPath = join(messagesDir, filename);

			if (!options.dryRun) {
				const output = serializeFrontmatter(frontmatter, markdownContent);
				writeFileSync(outputPath, output);
			}

			success++;

			if (options.verbose) {
				progress.log(`  ✓ Message thread: ${firstMessage.subject || '(No Subject)'}`);
			}
		} catch (error) {
			errors++;
			progress.log(
				`  ✗ Thread ${threadId}: ${error instanceof Error ? error.message : String(error)}`,
			);
		}
	}

	return { success, errors };
}

/**
 * Convert saved items to a single markdown file listing them
 */
async function convertSavedItems(
	dir: string,
	savedPostsFile: string | null,
	savedCommentsFile: string | null,
	outputDir: string,
	options: RedditOptions,
	progress: ProgressReporter,
): Promise<{ success: number; errors: number }> {
	progress.update(1, 'Saved items');

	try {
		const savedPosts: RedditSavedItem[] = savedPostsFile
			? parseCSV<RedditSavedItem>(readFileSync(savedPostsFile, 'utf-8'))
			: [];
		const savedComments: RedditSavedItem[] = savedCommentsFile
			? parseCSV<RedditSavedItem>(readFileSync(savedCommentsFile, 'utf-8'))
			: [];

		if (savedPosts.length === 0 && savedComments.length === 0) {
			return { success: 0, errors: 0 };
		}

		// Generate content
		const contentLines = [
			'# Reddit Saved Items',
			'',
			`**Total Saved:** ${savedPosts.length + savedComments.length}`,
			'',
		];

		if (savedPosts.length > 0) {
			contentLines.push('## Saved Posts', '');
			for (const item of savedPosts) {
				contentLines.push(`- [${item.id}](${item.permalink})`);
			}
			contentLines.push('');
		}

		if (savedComments.length > 0) {
			contentLines.push('## Saved Comments', '');
			for (const item of savedComments) {
				contentLines.push(`- [${item.id}](${item.permalink})`);
			}
			contentLines.push('');
		}

		const markdownContent = contentLines.join('\n');

		// Create hash
		const hashInput = `saved:${savedPosts.length}:${savedComments.length}`;
		const sourceHash = createHash('sha256').update(hashInput).digest('hex');

		// Create frontmatter
		const frontmatter = createFrontmatter({
			title: 'Reddit Saved Items',
			sourceType: 'file',
			contentType: 'document' as ContentType,
			sourceFile: basename(dir),
			sourceHash: `sha256:${sourceHash}`,
			createdAt: new Date(),
			tags: ['imported', 'reddit', 'saved'],
			metadata: {
				saved_posts_count: savedPosts.length,
				saved_comments_count: savedComments.length,
			},
		});

		// Add user tags
		if (options.tags.length > 0) {
			frontmatter.tags = [...new Set([...frontmatter.tags, ...options.tags])];
		}

		// Write file
		const outputPath = join(outputDir, 'reddit-saved-items.md');

		if (!options.dryRun) {
			mkdirSync(outputDir, { recursive: true });
			const output = serializeFrontmatter(frontmatter, markdownContent);
			writeFileSync(outputPath, output);
		}

		if (options.verbose) {
			progress.log(`  ✓ Saved items: ${savedPosts.length} posts, ${savedComments.length} comments`);
		}

		return { success: 1, errors: 0 };
	} catch (error) {
		progress.log(`  ✗ Saved items: ${error instanceof Error ? error.message : String(error)}`);
		return { success: 0, errors: 1 };
	}
}

/**
 * Main conversion function
 */
async function convertReddit(inputPath: string, options: RedditOptions): Promise<void> {
	const resolvedInput = resolve(inputPath);

	// Check if input exists
	if (!existsSync(resolvedInput)) {
		logger.error(`Input not found: ${resolvedInput}`);
		process.exit(1);
	}

	const stats = statSync(resolvedInput);
	if (!stats.isDirectory()) {
		logger.error('Input must be a Reddit data export directory');
		process.exit(1);
	}

	// Find the actual Reddit export directory (may be nested)
	const redditDir = findRedditDir(resolvedInput);

	// Handle preview mode
	if (options.preview) {
		const analysis = await analyzeReddit(redditDir);

		logger.info('');
		logger.info(`  Reddit Data Export Analysis`);
		logger.info(`  ${'─'.repeat(40)}`);
		logger.info(`  Directory: ${analysis.filename}`);
		logger.info(`  Size: ${(analysis.fileSizeBytes / 1024).toFixed(1)} KB`);
		logger.info('');
		logger.info(`  Total Items: ${analysis.totalItems.toLocaleString()}`);
		logger.info(`  Estimated Output Files: ${analysis.estimatedOutputFiles.toLocaleString()}`);
		logger.info(
			`  Estimated Output Size: ${(analysis.estimatedOutputSizeBytes / 1024).toFixed(1)} KB`,
		);
		logger.info('');

		if (analysis.breakdown) {
			logger.info('  Breakdown:');
			for (const [key, value] of Object.entries(analysis.breakdown)) {
				logger.info(`    ${key}: ${value.toLocaleString()}`);
			}
		}

		if (analysis.dateRange) {
			logger.info('');
			logger.info(`  Date Range: ${analysis.dateRange.oldest} to ${analysis.dateRange.newest}`);
		}

		logger.info('');
		return;
	}

	// Find Reddit data files
	const files = findRedditFiles(redditDir);
	const outputDir = resolve(options.output);

	// Check if any files exist
	const hasFiles =
		(options.comments && files.comments) ||
		(options.posts && files.posts) ||
		(options.messages && files.messages) ||
		(options.saved && (files.savedPosts || files.savedComments));

	if (!hasFiles) {
		logger.error(
			'No Reddit data files found. Expected comments.csv, posts.csv, messages.csv, etc.',
		);
		process.exit(1);
	}

	logger.info(`Found Reddit data in: ${redditDir}`);

	// Create output directory
	if (!options.dryRun) {
		mkdirSync(outputDir, { recursive: true });
	}

	let totalSuccess = 0;
	let totalErrors = 0;
	let totalSkipped = 0;

	// Convert comments
	if (options.comments && files.comments) {
		const content = readFileSync(files.comments, 'utf-8');
		const comments = parseCSV<RedditComment>(content);

		logger.info(`\nProcessing comments (${comments.length})...`);

		const progress = new ProgressReporter(comments.length, { verbose: options.verbose });
		progress.start();

		const result = await convertComments(redditDir, files.comments, outputDir, options, progress);

		progress.finish(
			`Comments: ${result.success} converted, ${result.skipped} skipped, ${result.errors} errors`,
		);
		totalSuccess += result.success;
		totalErrors += result.errors;
		totalSkipped += result.skipped;
	}

	// Convert posts
	if (options.posts && files.posts) {
		const content = readFileSync(files.posts, 'utf-8');
		const posts = parseCSV<RedditPost>(content);

		logger.info(`\nProcessing posts (${posts.length})...`);

		const progress = new ProgressReporter(posts.length, { verbose: options.verbose });
		progress.start();

		const result = await convertPosts(redditDir, files.posts, outputDir, options, progress);

		progress.finish(
			`Posts: ${result.success} converted, ${result.skipped} skipped, ${result.errors} errors`,
		);
		totalSuccess += result.success;
		totalErrors += result.errors;
		totalSkipped += result.skipped;
	}

	// Convert messages
	if (options.messages && files.messages) {
		const content = readFileSync(files.messages, 'utf-8');
		const messages = parseCSV<RedditMessage>(content);

		// Count unique threads
		const threads = new Set(messages.map((m) => m.thread_id || m.id));

		logger.info(`\nProcessing messages (${threads.size} threads)...`);

		const progress = new ProgressReporter(threads.size, { verbose: options.verbose });
		progress.start();

		const result = await convertMessages(redditDir, files.messages, outputDir, options, progress);

		progress.finish(`Messages: ${result.success} threads converted, ${result.errors} errors`);
		totalSuccess += result.success;
		totalErrors += result.errors;
	}

	// Convert saved items
	if (options.saved && (files.savedPosts || files.savedComments)) {
		logger.info('\nProcessing saved items...');

		const progress = new ProgressReporter(1, { verbose: options.verbose });
		progress.start();

		const result = await convertSavedItems(
			redditDir,
			files.savedPosts,
			files.savedComments,
			outputDir,
			options,
			progress,
		);

		progress.finish(`Saved items: ${result.success} converted, ${result.errors} errors`);
		totalSuccess += result.success;
		totalErrors += result.errors;
	}

	// Summary
	logger.info('');
	logger.info(
		`Done: ${totalSuccess} files created, ${totalSkipped} skipped, ${totalErrors} errors`,
	);

	if (totalErrors > 0) {
		process.exit(1);
	}
}

// CLI setup
const program = createBaseCommand(
	'convert-reddit',
	'Convert Reddit data export to Markdown with YAML front matter',
);

program
	.option('--comments', 'Include comments', true)
	.option('--no-comments', 'Exclude comments')
	.option('--posts', 'Include posts', true)
	.option('--no-posts', 'Exclude posts')
	.option('--messages', 'Include messages', true)
	.option('--no-messages', 'Exclude messages')
	.option('--saved', 'Include saved posts/comments', true)
	.option('--no-saved', 'Exclude saved items')
	.option('--subreddit <name>', 'Filter by subreddit')
	.option('--preview', 'Analyze and show stats without converting', false)
	.argument('<path>', 'Reddit data export directory')
	.action(async (path: string, opts: RedditOptions) => {
		await convertReddit(path, opts);
	});

program.parse();

export { convertReddit, type RedditOptions };
