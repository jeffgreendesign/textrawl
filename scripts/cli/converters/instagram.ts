#!/usr/bin/env npx tsx
/**
 * Instagram Data Export Converter
 *
 * Converts Instagram export data (messages, comments, likes) to markdown with YAML front matter
 *
 * Usage:
 *   pnpm convert -- instagram <path> [options]
 *   npx tsx scripts/cli/converters/instagram.ts <path> [options]
 */

import { createHash } from 'node:crypto';
import { existsSync, mkdirSync, readdirSync, readFileSync, statSync, writeFileSync } from 'node:fs';
import { basename, dirname, join, resolve } from 'node:path';

import { analyzeInstagram } from '../lib/analyze.js';
import { type CommonOptions, createBaseCommand } from '../lib/args.js';
import { createFrontmatter, serializeFrontmatter } from '../lib/frontmatter.js';
import { slugify } from '../lib/normalizer.js';
import { logger, ProgressReporter } from '../lib/progress.js';
import { validateOutputPath } from '../lib/security.js';
import type { ContentType } from '../lib/types.js';

/**
 * Instagram converter options
 */
export interface InstagramOptions extends CommonOptions {
	/** Include messages */
	messages: boolean;
	/** Include comments */
	comments: boolean;
	/** Include likes */
	likes: boolean;
	/** Analyze and show stats without converting */
	preview: boolean;
}

/**
 * Parsed Instagram message
 */
interface InstagramMessage {
	sender: string;
	timestamp: string;
	content: string;
}

/**
 * Parsed Instagram conversation
 */
interface InstagramConversation {
	title: string;
	participants: string[];
	messages: InstagramMessage[];
}

/**
 * Find Instagram export directory (may be nested)
 */
function findInstagramDir(inputPath: string): string {
	const files = readdirSync(inputPath);

	// Check for direct Instagram export indicators
	if (files.includes('messages') || files.includes('index.html') || files.includes('comments')) {
		return inputPath;
	}

	// Look for a subdirectory that looks like an Instagram export
	for (const item of files) {
		if (!item.endsWith('.zip')) {
			const itemPath = join(inputPath, item);
			try {
				const stats = statSync(itemPath);
				if (stats.isDirectory()) {
					const subFiles = readdirSync(itemPath);
					if (subFiles.includes('messages') || subFiles.includes('index.html')) {
						return itemPath;
					}
				}
			} catch {
				// Skip if can't read
			}
		}
	}

	return inputPath;
}

/**
 * Parse HTML to extract text content
 */
function extractTextFromHtml(html: string): string {
	// Remove script and style tags
	let text = html.replace(/<script[^>]*>[\s\S]*?<\/script>/gi, '');
	text = text.replace(/<style[^>]*>[\s\S]*?<\/style>/gi, '');

	// Replace common HTML entities
	text = text.replace(/&nbsp;/g, ' ');
	text = text.replace(/&amp;/g, '&');
	text = text.replace(/&lt;/g, '<');
	text = text.replace(/&gt;/g, '>');
	text = text.replace(/&quot;/g, '"');
	text = text.replace(/&#039;/g, "'");
	text = text.replace(/&#064;/g, '@');

	// Remove all HTML tags
	text = text.replace(/<[^>]+>/g, ' ');

	// Clean up whitespace
	text = text.replace(/\s+/g, ' ').trim();

	return text;
}

/**
 * Parse Instagram message HTML file
 */
function parseInstagramMessages(filePath: string): InstagramConversation | null {
	const html = readFileSync(filePath, 'utf-8');

	// Extract title from <title> tag
	const titleMatch = html.match(/<title>([^<]+)<\/title>/);
	const title = titleMatch ? titleMatch[1].trim() : 'Unknown Conversation';

	// Extract participants from "Participants:" text
	const participantsMatch = html.match(/Participants:\s*([^<]+)/);
	const participants = participantsMatch
		? participantsMatch[1]
				.split(',')
				.map((p) => p.trim())
				.filter(Boolean)
		: [];

	// Parse messages from HTML structure
	// Instagram uses: <div class="_3-95 _2pim _2lek _2lel">Sender</div> for sender
	// <div class="_3-95 _2let">Content</div> for content
	// <div class="_3-94 _2lem">Timestamp</div> for timestamp
	const messages: InstagramMessage[] = [];

	// Regex to find message blocks
	// Pattern: sender div followed by content div followed by timestamp div
	const _senderPattern = /<div class="[^"]*_2lel[^"]*">([^<]+)<\/div>/g;
	const _contentPattern = /<div class="[^"]*_2let[^"]*">[\s\S]*?<\/div>/g;
	const _timestampPattern = /<div class="[^"]*_2lem[^"]*">([^<]+)<\/div>/g;

	// Simpler approach: extract all message blocks
	// Each message is in a div with class containing "uiBoxWhite"
	const messageBlockPattern =
		/<div class="pam _3-95 _2ph- _2lej uiBoxWhite noborder">([\s\S]*?)<\/div>(?=<div class="pam|<\/div><\/div><\/div>)/g;

	while (true) {
		const blockMatch = messageBlockPattern.exec(html);
		if (!blockMatch) break;
		const block = blockMatch[1];

		// Skip non-message blocks
		if (block.includes('Participants:') || block.includes('Mailbox thread')) {
			continue;
		}

		// Extract sender
		const senderMatch = block.match(/<div class="[^"]*_2lel[^"]*">([^<]+)<\/div>/);
		const sender = senderMatch ? senderMatch[1].trim() : 'Unknown';

		// Extract content
		const contentMatch = block.match(/<div class="[^"]*_2let[^"]*">([\s\S]*?)<\/div>/);
		const content = contentMatch ? extractTextFromHtml(contentMatch[1]) : '';

		// Extract timestamp
		const timestampMatch = block.match(/<div class="[^"]*_2lem[^"]*">([^<]+)<\/div>/);
		const timestamp = timestampMatch ? timestampMatch[1].trim() : '';

		if (content || sender !== 'Unknown') {
			messages.push({ sender, timestamp, content });
		}
	}

	// Alternative simpler extraction if the above didn't work
	if (messages.length === 0) {
		// Try to find any content between timestamps
		const simplePattern = /<div class="[^"]*_2let[^"]*"><div><div><\/div><div>([^<]+)<\/div>/g;
		while (true) {
			const simpleMatch = simplePattern.exec(html);
			if (!simpleMatch) break;
			const content = simpleMatch[1].trim();
			if (content) {
				messages.push({ sender: 'Unknown', timestamp: '', content });
			}
		}
	}

	return messages.length > 0 || participants.length > 0 ? { title, participants, messages } : null;
}

/**
 * Find all message files in the export
 */
function findMessageFiles(dir: string): string[] {
	const files: string[] = [];
	const messagesDir = join(dir, 'messages');

	if (!existsSync(messagesDir)) {
		return files;
	}

	const items = readdirSync(messagesDir);

	for (const item of items) {
		const itemPath = join(messagesDir, item);

		// Handle direct HTML files (like chats.html)
		if (item.endsWith('.html') && item !== 'chats.html' && item !== 'secret_groups.html') {
			files.push(itemPath);
			continue;
		}

		// Handle subdirectories (like inbox/, message_requests/)
		try {
			const stats = statSync(itemPath);
			if (stats.isDirectory()) {
				const subItems = readdirSync(itemPath);
				for (const subItem of subItems) {
					const subItemPath = join(itemPath, subItem);
					const subStats = statSync(subItemPath);

					if (subStats.isDirectory()) {
						// This is a conversation folder - look for message_*.html files
						const convFiles = readdirSync(subItemPath);
						for (const convFile of convFiles) {
							if (convFile.startsWith('message') && convFile.endsWith('.html')) {
								files.push(join(subItemPath, convFile));
							}
						}
					} else if (subItem.endsWith('.html')) {
						files.push(subItemPath);
					}
				}
			}
		} catch {
			// Skip if can't read
		}
	}

	return files;
}

/**
 * Parse comments HTML file
 */
function parseCommentsHtml(filePath: string): Array<{ content: string; timestamp?: string }> {
	const html = readFileSync(filePath, 'utf-8');
	const comments: Array<{ content: string; timestamp?: string }> = [];

	// Pattern for comment blocks - match content and timestamp together
	const commentBlockPattern =
		/<div class="[^"]*_2let[^"]*">([\s\S]*?)<\/div>[\s\S]*?<div class="[^"]*_2lem[^"]*">([^<]+)<\/div>/g;

	while (true) {
		const match = commentBlockPattern.exec(html);
		if (!match) break;
		const content = extractTextFromHtml(match[1]);
		if (content && !content.includes('Your Posts')) {
			const timestamp = match[2]?.trim();
			comments.push({ content, timestamp });
		}
	}

	return comments;
}

/**
 * Parse likes HTML file
 */
function parseLikesHtml(filePath: string): Array<{ content: string; timestamp?: string }> {
	const html = readFileSync(filePath, 'utf-8');
	const likes: Array<{ content: string; timestamp?: string }> = [];

	// Pattern for like entries - match content and timestamp together
	const likeBlockPattern =
		/<div class="[^"]*_2let[^"]*">([\s\S]*?)<\/div>[\s\S]*?<div class="[^"]*_2lem[^"]*">([^<]+)<\/div>/g;

	while (true) {
		const match = likeBlockPattern.exec(html);
		if (!match) break;
		const content = extractTextFromHtml(match[1]);
		if (content && content.length > 0) {
			const timestamp = match[2]?.trim();
			likes.push({ content, timestamp });
		}
	}

	return likes;
}

/**
 * Convert messages to markdown files
 */
async function convertMessages(
	dir: string,
	messageFiles: string[],
	outputDir: string,
	options: InstagramOptions,
	progress: ProgressReporter,
): Promise<{ success: number; errors: number }> {
	const messagesDir = join(outputDir, 'messages');

	if (!options.dryRun) {
		mkdirSync(messagesDir, { recursive: true });
	}

	let success = 0;
	let errors = 0;

	// Group by conversation (files from the same folder)
	const conversations = new Map<string, InstagramConversation>();

	for (let i = 0; i < messageFiles.length; i++) {
		const file = messageFiles[i];
		progress.update(i + 1, basename(dirname(file)));

		try {
			const conversation = parseInstagramMessages(file);

			if (!conversation) continue;

			// Use folder name as key for grouping
			const folderName = basename(dirname(file));
			const key = folderName !== 'messages' ? folderName : slugify(conversation.title, 100);
			const existing = conversations.get(key);

			if (existing) {
				// Merge messages
				existing.messages.push(...conversation.messages);
				// Update title if more descriptive
				if (conversation.title.length > existing.title.length) {
					existing.title = conversation.title;
				}
			} else {
				conversations.set(key, conversation);
			}
		} catch (error) {
			errors++;
			progress.log(
				`  ✗ ${basename(file)}: ${error instanceof Error ? error.message : String(error)}`,
			);
		}
	}

	// Write conversation files
	for (const [key, conversation] of conversations.entries()) {
		try {
			// Sort messages by timestamp
			conversation.messages.sort((a, b) => {
				const timeA = a.timestamp ? new Date(a.timestamp).getTime() : Number.POSITIVE_INFINITY;
				const timeB = b.timestamp ? new Date(b.timestamp).getTime() : Number.POSITIVE_INFINITY;
				// Handle NaN from malformed timestamps
				const safeA = Number.isNaN(timeA) ? Number.POSITIVE_INFINITY : timeA;
				const safeB = Number.isNaN(timeB) ? Number.POSITIVE_INFINITY : timeB;
				return safeA - safeB;
			});

			// Generate content
			const contentLines = [
				`# ${conversation.title}`,
				'',
				`**Participants:** ${conversation.participants.join(', ') || 'Unknown'}`,
				`**Messages:** ${conversation.messages.length}`,
				'',
			];

			if (conversation.messages.length > 0) {
				contentLines.push('## Messages', '');

				for (const msg of conversation.messages) {
					const timestamp = msg.timestamp ? `*${msg.timestamp}*` : '';
					contentLines.push(
						`**${msg.sender}** ${timestamp}`,
						'',
						msg.content || '[Media/Attachment]',
						'',
						'---',
						'',
					);
				}
			}

			const markdownContent = contentLines.join('\n');

			// Get date from first message or use current date
			const firstMsgDate = conversation.messages.find((m) => m.timestamp)?.timestamp;
			let date = new Date();
			if (firstMsgDate) {
				try {
					date = new Date(firstMsgDate);
					if (Number.isNaN(date.getTime())) date = new Date();
				} catch {
					date = new Date();
				}
			}

			// Create hash
			const hashInput = `ig-conv:${conversation.title}:${conversation.messages.length}`;
			const sourceHash = createHash('sha256').update(hashInput).digest('hex');

			// Create frontmatter
			const frontmatter = createFrontmatter({
				title: conversation.title,
				sourceType: 'file',
				contentType: 'document' as ContentType,
				sourceFile: basename(dir),
				sourceHash: `sha256:${sourceHash}`,
				createdAt: date,
				tags: ['imported', 'instagram', 'message'],
				metadata: {
					participants: conversation.participants,
					message_count: conversation.messages.length,
				},
			});

			// Add user tags
			if (options.tags.length > 0) {
				frontmatter.tags = [...new Set([...frontmatter.tags, ...options.tags])];
			}

			// Generate filename
			const filename = `${key}.md`;
			const outputPath = join(messagesDir, filename);

			if (!options.dryRun) {
				const output = serializeFrontmatter(frontmatter, markdownContent);
				writeFileSync(outputPath, output);
			}

			success++;

			if (options.verbose) {
				progress.log(`  ✓ ${conversation.title} (${conversation.messages.length} messages)`);
			}
		} catch (error) {
			errors++;
			progress.log(
				`  ✗ ${conversation.title}: ${error instanceof Error ? error.message : String(error)}`,
			);
		}
	}

	return { success, errors };
}

/**
 * Convert comments to a markdown file
 */
async function convertComments(
	dir: string,
	outputDir: string,
	options: InstagramOptions,
	progress: ProgressReporter,
): Promise<{ success: number; errors: number }> {
	const commentsDir = join(dir, 'comments');
	if (!existsSync(commentsDir)) {
		return { success: 0, errors: 0 };
	}

	const commentsFile = join(commentsDir, 'post_comments.html');
	if (!existsSync(commentsFile)) {
		return { success: 0, errors: 0 };
	}

	progress.update(1, 'Comments');

	try {
		const comments = parseCommentsHtml(commentsFile);

		if (comments.length === 0) {
			return { success: 0, errors: 0 };
		}

		const contentLines = [
			'# Instagram Comments',
			'',
			`**Total Comments:** ${comments.length}`,
			'',
			'## Your Comments',
			'',
		];

		for (const comment of comments) {
			const timestamp = comment.timestamp ? `*${comment.timestamp}*` : '';
			contentLines.push(`- ${comment.content} ${timestamp}`);
		}

		const markdownContent = contentLines.join('\n');

		// Create hash
		const hashInput = `ig-comments:${comments.length}`;
		const sourceHash = createHash('sha256').update(hashInput).digest('hex');

		// Create frontmatter
		const frontmatter = createFrontmatter({
			title: 'Instagram Comments',
			sourceType: 'file',
			contentType: 'document' as ContentType,
			sourceFile: basename(dir),
			sourceHash: `sha256:${sourceHash}`,
			createdAt: new Date(),
			tags: ['imported', 'instagram', 'comment'],
			metadata: {
				comment_count: comments.length,
			},
		});

		// Add user tags
		if (options.tags.length > 0) {
			frontmatter.tags = [...new Set([...frontmatter.tags, ...options.tags])];
		}

		const outputPath = join(outputDir, 'instagram-comments.md');

		if (!options.dryRun) {
			mkdirSync(outputDir, { recursive: true });
			const output = serializeFrontmatter(frontmatter, markdownContent);
			writeFileSync(outputPath, output);
		}

		if (options.verbose) {
			progress.log(`  ✓ Comments: ${comments.length}`);
		}

		return { success: 1, errors: 0 };
	} catch (error) {
		progress.log(`  ✗ Comments: ${error instanceof Error ? error.message : String(error)}`);
		return { success: 0, errors: 1 };
	}
}

/**
 * Convert likes to a markdown file
 */
async function convertLikes(
	dir: string,
	outputDir: string,
	options: InstagramOptions,
	progress: ProgressReporter,
): Promise<{ success: number; errors: number }> {
	const likesDir = join(dir, 'likes');
	if (!existsSync(likesDir)) {
		return { success: 0, errors: 0 };
	}

	const likedPostsFile = join(likesDir, 'liked_posts.html');
	const likedCommentsFile = join(likesDir, 'liked_comments.html');

	let totalLikes = 0;
	const contentLines = ['# Instagram Likes', ''];

	progress.update(1, 'Likes');

	try {
		if (existsSync(likedPostsFile)) {
			const likedPosts = parseLikesHtml(likedPostsFile);
			totalLikes += likedPosts.length;
			if (likedPosts.length > 0) {
				contentLines.push(`## Liked Posts (${likedPosts.length})`, '');
				for (const like of likedPosts) {
					const timestamp = like.timestamp ? `*${like.timestamp}*` : '';
					contentLines.push(`- ${like.content} ${timestamp}`);
				}
				contentLines.push('');
			}
		}

		if (existsSync(likedCommentsFile)) {
			const likedComments = parseLikesHtml(likedCommentsFile);
			totalLikes += likedComments.length;
			if (likedComments.length > 0) {
				contentLines.push(`## Liked Comments (${likedComments.length})`, '');
				for (const like of likedComments) {
					const timestamp = like.timestamp ? `*${like.timestamp}*` : '';
					contentLines.push(`- ${like.content} ${timestamp}`);
				}
				contentLines.push('');
			}
		}

		if (totalLikes === 0) {
			return { success: 0, errors: 0 };
		}

		// Update total count in header
		contentLines[1] = `**Total Likes:** ${totalLikes}`;
		contentLines.splice(2, 0, '');

		const markdownContent = contentLines.join('\n');

		// Create hash
		const hashInput = `ig-likes:${totalLikes}`;
		const sourceHash = createHash('sha256').update(hashInput).digest('hex');

		// Create frontmatter
		const frontmatter = createFrontmatter({
			title: 'Instagram Likes',
			sourceType: 'file',
			contentType: 'document' as ContentType,
			sourceFile: basename(dir),
			sourceHash: `sha256:${sourceHash}`,
			createdAt: new Date(),
			tags: ['imported', 'instagram', 'like'],
			metadata: {
				like_count: totalLikes,
			},
		});

		// Add user tags
		if (options.tags.length > 0) {
			frontmatter.tags = [...new Set([...frontmatter.tags, ...options.tags])];
		}

		const outputPath = join(outputDir, 'instagram-likes.md');

		if (!options.dryRun) {
			mkdirSync(outputDir, { recursive: true });
			const output = serializeFrontmatter(frontmatter, markdownContent);
			writeFileSync(outputPath, output);
		}

		if (options.verbose) {
			progress.log(`  ✓ Likes: ${totalLikes}`);
		}

		return { success: 1, errors: 0 };
	} catch (error) {
		progress.log(`  ✗ Likes: ${error instanceof Error ? error.message : String(error)}`);
		return { success: 0, errors: 1 };
	}
}

/**
 * Main conversion function
 */
async function convertInstagram(inputPath: string, options: InstagramOptions): Promise<void> {
	const resolvedInput = resolve(inputPath);

	// Check if input exists
	if (!existsSync(resolvedInput)) {
		logger.error(`Input not found: ${resolvedInput}`);
		process.exit(1);
	}

	const stats = statSync(resolvedInput);
	if (!stats.isDirectory()) {
		logger.error('Input must be an Instagram data export directory');
		process.exit(1);
	}

	// Find the actual Instagram export directory (may be nested)
	const instagramDir = findInstagramDir(resolvedInput);

	// Handle preview mode
	if (options.preview) {
		const analysis = await analyzeInstagram(instagramDir);

		logger.info('');
		logger.info('  Instagram Data Export Analysis');
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

		logger.info('');
		return;
	}

	logger.info(`Found Instagram export in: ${instagramDir}`);

	// Security: validate output directory to prevent path traversal
	const outputDir = validateOutputPath(options.output);

	// Create output directory
	if (!options.dryRun) {
		mkdirSync(outputDir, { recursive: true });
	}

	let totalSuccess = 0;
	let totalErrors = 0;

	// Convert messages
	if (options.messages) {
		const messageFiles = findMessageFiles(instagramDir);

		if (messageFiles.length > 0) {
			logger.info(`\nProcessing messages (${messageFiles.length} file(s))...`);

			const progress = new ProgressReporter(messageFiles.length, { verbose: options.verbose });
			progress.start();

			const result = await convertMessages(
				instagramDir,
				messageFiles,
				outputDir,
				options,
				progress,
			);

			progress.finish(`Messages: ${result.success} conversations, ${result.errors} errors`);
			totalSuccess += result.success;
			totalErrors += result.errors;
		} else {
			logger.info('No message files found');
		}
	}

	// Convert comments
	if (options.comments) {
		logger.info('\nProcessing comments...');

		const progress = new ProgressReporter(1, { verbose: options.verbose });
		progress.start();

		const result = await convertComments(instagramDir, outputDir, options, progress);

		progress.finish(`Comments: ${result.success} converted, ${result.errors} errors`);
		totalSuccess += result.success;
		totalErrors += result.errors;
	}

	// Convert likes
	if (options.likes) {
		logger.info('\nProcessing likes...');

		const progress = new ProgressReporter(1, { verbose: options.verbose });
		progress.start();

		const result = await convertLikes(instagramDir, outputDir, options, progress);

		progress.finish(`Likes: ${result.success} converted, ${result.errors} errors`);
		totalSuccess += result.success;
		totalErrors += result.errors;
	}

	// Summary
	logger.info('');
	logger.info(`Done: ${totalSuccess} files created, ${totalErrors} errors`);

	if (totalErrors > 0) {
		process.exit(1);
	}
}

// CLI setup
const program = createBaseCommand(
	'convert-instagram',
	'Convert Instagram data export to Markdown with YAML front matter',
);

program
	.option('--messages', 'Include messages', true)
	.option('--no-messages', 'Exclude messages')
	.option('--comments', 'Include comments', true)
	.option('--no-comments', 'Exclude comments')
	.option('--likes', 'Include likes', true)
	.option('--no-likes', 'Exclude likes')
	.option('--preview', 'Analyze and show stats without converting', false)
	.argument('<path>', 'Instagram data export directory')
	.action(async (path: string, opts: InstagramOptions) => {
		await convertInstagram(path, opts);
	});

program.parse();

export { convertInstagram, type InstagramOptions };
