#!/usr/bin/env npx tsx
/**
 * Facebook Data Export Converter
 *
 * Converts Facebook export data (messages, posts, etc.) to markdown with YAML front matter
 * Supports both HTML (older format) and JSON (newer format) exports
 *
 * Usage:
 *   pnpm convert -- facebook <path> [options]
 *   npx tsx scripts/cli/converters/facebook.ts <path> [options]
 */

import { createHash } from 'node:crypto';
import {
	createReadStream,
	existsSync,
	mkdirSync,
	readFileSync,
	readdirSync,
	rmSync,
	statSync,
	writeFileSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import { basename, join, resolve } from 'node:path';
// @ts-ignore - unzipper types
import * as unzipper from 'unzipper';

import { analyzeFacebook } from '../lib/analyze.js';
import { type CommonOptions, createBaseCommand } from '../lib/args.js';
import { createFrontmatter, serializeFrontmatter } from '../lib/frontmatter.js';
import { slugify, stripHtml } from '../lib/normalizer.js';
import { ProgressReporter, logger } from '../lib/progress.js';
import { validateOutputPath } from '../lib/security.js';
import type { ContentType, ConversionResult } from '../lib/types.js';

/**
 * Facebook converter options
 */
export interface FacebookOptions extends CommonOptions {
	/** Include messages */
	messages: boolean;
	/** Analyze and show stats without converting */
	preview: boolean;
	/** Keep extracted files after conversion (ZIP only) */
	keepExtracted: boolean;
}

/**
 * Parsed Facebook message
 */
interface FacebookMessage {
	sender: string;
	timestamp: string;
	content: string;
}

/**
 * Parsed Facebook conversation
 */
interface FacebookConversation {
	title: string;
	participants: string[];
	messages: FacebookMessage[];
}

/**
 * Extract ZIP file to temporary directory
 */
async function extractZip(zipPath: string): Promise<string> {
	const tempDir = join(tmpdir(), `facebook-${Date.now()}`);
	mkdirSync(tempDir, { recursive: true });

	logger.info(`Extracting to ${tempDir}...`);

	await new Promise<void>((resolve, reject) => {
		createReadStream(zipPath)
			.pipe(unzipper.Extract({ path: tempDir }))
			.on('close', resolve)
			.on('error', reject);
	});

	return tempDir;
}

/**
 * Find Facebook export directory (may be nested)
 */
function findFacebookDir(inputPath: string): string {
	const files = readdirSync(inputPath);

	// Check for direct Facebook export indicators
	if (files.includes('messages') || files.includes('html') || files.includes('index.htm')) {
		return inputPath;
	}

	// Look for a subdirectory that looks like a Facebook export
	for (const item of files) {
		if (item.startsWith('facebook-') && !item.endsWith('.zip')) {
			const itemPath = join(inputPath, item);
			try {
				const stats = statSync(itemPath);
				if (stats.isDirectory()) {
					return itemPath;
				}
			} catch {
				// Skip if can't read (permission error, deleted, etc.)
			}
		}
	}

	return inputPath;
}

/**
 * Detect export format (HTML or JSON)
 */
function detectFormat(dir: string): 'html' | 'json' | 'unknown' {
	const files = readdirSync(dir);

	// HTML format has index.htm and html/ folder
	if (files.includes('index.htm') || files.includes('html')) {
		return 'html';
	}

	// JSON format has folders like messages/inbox/
	if (files.includes('messages')) {
		const messagesPath = join(dir, 'messages');
		if (existsSync(messagesPath)) {
			const msgContents = readdirSync(messagesPath);
			if (msgContents.includes('inbox') || msgContents.some((f) => f.endsWith('.json'))) {
				return 'json';
			}
		}
	}

	return 'unknown';
}

/**
 * Parse HTML message file (old format)
 */
function parseHTMLMessages(filePath: string): FacebookConversation | null {
	const html = readFileSync(filePath, 'utf-8');

	// Extract title from <h3> or <title>
	const titleMatch = html.match(/<h3>([^<]+)<\/h3>/) || html.match(/<title>([^<]+)<\/title>/);
	const title = titleMatch ? titleMatch[1].trim() : 'Unknown Conversation';

	// Extract participants from text after "Participants:"
	const participantsMatch = html.match(/Participants:\s*([^<]+)/);
	const participants = participantsMatch
		? participantsMatch[1]
				.split(',')
				.map((p) => p.trim())
				.filter(Boolean)
		: [];

	// Extract messages - they're in divs with class "message"
	const messages: FacebookMessage[] = [];

	// Regex to find message blocks
	// Pattern: <div class="message_header"><span class="user">Name</span><span class="meta">Date</span></div></div><p>Content</p>
	const messagePattern =
		/<div class="message_header">[\s\S]*?<span class="user">([^<]*)<\/span>[\s\S]*?<span class="meta">([^<]+)<\/span>[\s\S]*?<\/div>[\s\S]*?<\/div>(?:<p>([^<]*)<\/p>)?/g;

	while (true) {
		const match = messagePattern.exec(html);
		if (!match) break;
		const sender = match[1]?.trim() || 'Unknown';
		const timestamp = match[2]?.trim() || '';
		const content = match[3]?.trim() || '';

		if (content) {
			messages.push({ sender, timestamp, content });
		}
	}

	// Alternative pattern for simpler message format
	if (messages.length === 0) {
		// Try a simpler extraction - find all <p> tags after message_header divs
		const simplePattern = /<p>([^<]+)<\/p>/g;
		while (true) {
			const simpleMatch = simplePattern.exec(html);
			if (!simpleMatch) break;
			const content = simpleMatch[1]?.trim();
			if (content && content.length > 0) {
				messages.push({
					sender: 'Unknown',
					timestamp: '',
					content,
				});
			}
		}
	}

	if (messages.length === 0 && !title.includes('Unknown')) {
		// Even if no messages extracted, return the conversation if it has a title
		return { title, participants, messages: [] };
	}

	return messages.length > 0 || participants.length > 0 ? { title, participants, messages } : null;
}

/**
 * Parse JSON message file (new format)
 */
function parseJSONMessages(filePath: string): FacebookConversation | null {
	try {
		const content = readFileSync(filePath, 'utf-8');
		const data = JSON.parse(content);

		// New format structure
		const title = data.title || 'Unknown Conversation';
		const participants = (data.participants || []).map((p: { name: string }) => p.name);
		const messages: FacebookMessage[] = [];

		for (const msg of data.messages || []) {
			// Facebook encodes some text in latin1, need to decode
			let msgContent = msg.content || '';
			if (msg.photos) {
				msgContent += ` [${msg.photos.length} photo(s)]`;
			}
			if (msg.videos) {
				msgContent += ` [${msg.videos.length} video(s)]`;
			}
			if (msg.audio_files) {
				msgContent += ` [${msg.audio_files.length} audio file(s)]`;
			}
			if (msg.sticker) {
				msgContent += ' [sticker]';
			}

			if (msgContent.trim()) {
				messages.push({
					sender: msg.sender_name || 'Unknown',
					timestamp: msg.timestamp_ms ? new Date(msg.timestamp_ms).toISOString() : '',
					content: msgContent.trim(),
				});
			}
		}

		return { title, participants, messages };
	} catch {
		return null;
	}
}

/**
 * Find all message files in the export
 */
function findMessageFiles(dir: string, format: 'html' | 'json'): string[] {
	const files: string[] = [];

	if (format === 'html') {
		// HTML format: messages are in messages/*.html
		const messagesDir = join(dir, 'messages');
		if (existsSync(messagesDir)) {
			const msgFiles = readdirSync(messagesDir);
			for (const file of msgFiles) {
				if (file.endsWith('.html')) {
					files.push(join(messagesDir, file));
				}
			}
		}
	} else if (format === 'json') {
		// JSON format: messages are in messages/inbox/*/message_1.json
		const inboxDir = join(dir, 'messages', 'inbox');
		if (existsSync(inboxDir)) {
			const conversations = readdirSync(inboxDir);
			for (const conv of conversations) {
				const convDir = join(inboxDir, conv);
				try {
					const stats = statSync(convDir);
					if (stats.isDirectory()) {
						const convFiles = readdirSync(convDir);
						for (const file of convFiles) {
							if (file.startsWith('message') && file.endsWith('.json')) {
								files.push(join(convDir, file));
							}
						}
					}
				} catch {
					// Skip if can't read (permission error, deleted, etc.)
				}
			}
		}
	}

	return files;
}

/**
 * Convert messages to markdown files
 */
async function convertMessages(
	dir: string,
	messageFiles: string[],
	format: 'html' | 'json',
	outputDir: string,
	options: FacebookOptions,
	progress: ProgressReporter,
): Promise<{ success: number; errors: number }> {
	const messagesDir = join(outputDir, 'messages');

	if (!options.dryRun) {
		mkdirSync(messagesDir, { recursive: true });
	}

	let success = 0;
	let errors = 0;

	// Group by conversation (for JSON format where a conversation may span multiple files)
	const conversations = new Map<string, FacebookConversation>();

	for (let i = 0; i < messageFiles.length; i++) {
		const file = messageFiles[i];
		progress.update(i + 1, basename(file));

		try {
			const conversation = format === 'html' ? parseHTMLMessages(file) : parseJSONMessages(file);

			if (!conversation) continue;

			const key = slugify(conversation.title, 100);
			const existing = conversations.get(key);

			if (existing) {
				// Merge messages
				existing.messages.push(...conversation.messages);
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
					const timestamp = msg.timestamp ? `*${new Date(msg.timestamp).toLocaleString()}*` : '';
					contentLines.push(`**${msg.sender}** ${timestamp}`, '', msg.content, '', '---', '');
				}
			}

			const markdownContent = contentLines.join('\n');

			// Get date from first message or use current date
			const firstMsgDate = conversation.messages.find((m) => m.timestamp)?.timestamp;
			const date = firstMsgDate ? new Date(firstMsgDate) : new Date();

			// Create hash
			const hashInput = `fb-conv:${conversation.title}:${conversation.messages.length}`;
			const sourceHash = createHash('sha256').update(hashInput).digest('hex');

			// Create frontmatter
			const frontmatter = createFrontmatter({
				title: conversation.title,
				sourceType: 'file',
				contentType: 'document' as ContentType,
				sourceFile: basename(dir),
				sourceHash: `sha256:${sourceHash}`,
				createdAt: date,
				tags: ['imported', 'facebook', 'message'],
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
 * Main conversion function
 */
async function convertFacebook(inputPath: string, options: FacebookOptions): Promise<void> {
	const resolvedInput = resolve(inputPath);

	// Check if input exists
	if (!existsSync(resolvedInput)) {
		logger.error(`Input not found: ${resolvedInput}`);
		process.exit(1);
	}

	const stats = statSync(resolvedInput);
	const isZip = resolvedInput.toLowerCase().endsWith('.zip');

	let workingDir: string;
	let needsCleanup = false;

	if (isZip) {
		if (!stats.isFile()) {
			logger.error('ZIP path exists but is not a file');
			process.exit(1);
		}
		logger.info('Extracting Facebook export from ZIP...');
		workingDir = await extractZip(resolvedInput);
		needsCleanup = !options.keepExtracted;

		// Validate it's a Facebook export
		const format = detectFormat(findFacebookDir(workingDir));
		if (format === 'unknown') {
			logger.error('ZIP does not contain a valid Facebook export');
			if (needsCleanup) {
				rmSync(workingDir, { recursive: true, force: true });
			}
			process.exit(1);
		}
	} else if (!stats.isDirectory()) {
		logger.error('Input must be a Facebook data export directory or ZIP file');
		process.exit(1);
	} else {
		workingDir = resolvedInput;
	}

	// Find the actual Facebook export directory (may be nested)
	const facebookDir = findFacebookDir(workingDir);

	try {
		// Handle preview mode
		if (options.preview) {
			const analysis = await analyzeFacebook(facebookDir);

			logger.info('');
			logger.info('  Facebook Data Export Analysis');
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

		// Detect export format
		const format = detectFormat(facebookDir);
		if (format === 'unknown') {
			logger.error('Unable to detect Facebook export format. Expected HTML or JSON format.');
			process.exit(1);
		}

		logger.info(`Found Facebook ${format.toUpperCase()} export in: ${facebookDir}`);

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
			const messageFiles = findMessageFiles(facebookDir, format);

			if (messageFiles.length > 0) {
				logger.info(`\nProcessing messages (${messageFiles.length} file(s))...`);

				const progress = new ProgressReporter(messageFiles.length, { verbose: options.verbose });
				progress.start();

				const result = await convertMessages(
					facebookDir,
					messageFiles,
					format,
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

		// Summary
		logger.info('');
		logger.info(`Done: ${totalSuccess} files created, ${totalErrors} errors`);

		if (totalErrors > 0) {
			process.exit(1);
		}
	} finally {
		// Clean up extracted files if we extracted a ZIP
		if (needsCleanup && workingDir !== resolvedInput) {
			logger.info('Cleaning up temporary files...');
			try {
				rmSync(workingDir, { recursive: true, force: true });
			} catch {
				logger.warn(`Failed to clean up ${workingDir}`);
			}
		}
	}
}

// CLI setup
const program = createBaseCommand(
	'convert-facebook',
	'Convert Facebook data export to Markdown with YAML front matter',
);

program
	.option('--messages', 'Include messages', true)
	.option('--no-messages', 'Exclude messages')
	.option('--preview', 'Analyze and show stats without converting', false)
	.option('--keep-extracted', 'Keep extracted files after conversion (ZIP only)', false)
	.argument('<path>', 'Facebook data export directory or ZIP file')
	.action(async (path: string, opts: FacebookOptions) => {
		await convertFacebook(path, opts);
	});

program.parse();

export { convertFacebook };
