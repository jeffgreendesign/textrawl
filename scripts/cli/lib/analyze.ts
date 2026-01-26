/**
 * Universal Export Analysis Module
 *
 * Provides lightweight preview/analysis for various data export formats
 * without performing full conversion. Used to show users what to expect
 * before committing to a potentially lengthy conversion process.
 */

import {
	createReadStream,
	existsSync,
	mkdirSync,
	readFileSync,
	readdirSync,
	rmSync,
	statSync,
} from 'node:fs';
import { homedir, tmpdir } from 'node:os';
import { basename, extname, join, resolve, sep } from 'node:path';
import { createInterface } from 'node:readline';
import { Open } from 'unzipper';

/**
 * Sanitize and normalize a folder path to prevent path traversal attacks.
 * Resolves to absolute path, validates it exists as a directory, and ensures
 * it is within an allowed base directory (home, temp, or current working directory).
 */
function sanitizeFolderPath(folderPath: string): string {
	// Resolve to absolute path, normalizing any '..' segments
	const resolvedPath = resolve(folderPath);

	// Verify the path exists and is a directory
	if (!existsSync(resolvedPath)) {
		throw new Error(`Path does not exist: ${resolvedPath}`);
	}

	const stat = statSync(resolvedPath);
	if (!stat.isDirectory()) {
		throw new Error(`Path is not a directory: ${resolvedPath}`);
	}

	// Security: ensure the directory is within an allowed base directory
	const homeDir = resolve(homedir());
	const tempDir = resolve(tmpdir());
	const cwdDir = resolve(process.cwd());

	const isWithinHome = resolvedPath === homeDir || resolvedPath.startsWith(homeDir + sep);
	const isWithinTemp = resolvedPath === tempDir || resolvedPath.startsWith(tempDir + sep);
	const isWithinCwd = resolvedPath === cwdDir || resolvedPath.startsWith(cwdDir + sep);

	if (!isWithinHome && !isWithinTemp && !isWithinCwd) {
		throw new Error(
			`Directory must be within home, temp, or working directory: ${resolvedPath}`,
		);
	}

	return resolvedPath;
}

/**
 * Unified analysis result returned by all format analyzers
 */
export interface AnalysisResult {
	/** Format identifier */
	format: 'mbox' | 'takeout' | 'spotify' | 'reddit' | 'facebook' | 'instagram' | 'unknown';
	/** Original filename or folder name */
	filename: string;
	/** Size of input in bytes */
	fileSizeBytes: number;
	/** Whether preview is available */
	canPreview: boolean;

	/** Total count of primary items */
	totalItems: number;
	/** Estimated number of output markdown files */
	estimatedOutputFiles: number;
	/** Estimated total size of output in bytes */
	estimatedOutputSizeBytes: number;

	/** Date range of content (ISO strings) */
	dateRange?: { oldest: string; newest: string };
	/** Format-specific breakdown (e.g., { youtube: 2847, calendar: 156 }) */
	breakdown?: Record<string, number>;
	/** Sample items for context (first few titles/subjects) */
	samples?: string[];
}

/**
 * Analyze MBOX email archive
 */
export async function analyzeMbox(filePath: string): Promise<AnalysisResult> {
	const stream = createReadStream(filePath, { encoding: 'utf-8' });
	const rl = createInterface({ input: stream, crlfDelay: Infinity });

	let emailCount = 0;
	const subjects: string[] = [];
	const dates: Date[] = [];

	let inHeaders = false;
	let currentSubject: string | null = null;
	let currentDate: string | null = null;

	for await (const line of rl) {
		if (line.startsWith('From ') && line.match(/^From \S+.*\d{4}$/)) {
			if (currentSubject && subjects.length < 5) {
				subjects.push(currentSubject);
			}
			if (currentDate) {
				const parsed = new Date(currentDate);
				if (!isNaN(parsed.getTime())) {
					dates.push(parsed);
				}
			}
			emailCount++;
			inHeaders = true;
			currentSubject = null;
			currentDate = null;
		} else if (inHeaders) {
			if (line.trim() === '') {
				inHeaders = false;
			} else if (line.startsWith('Subject:') && !currentSubject) {
				currentSubject = line.slice(8).trim();
			} else if (line.startsWith('Date:') && !currentDate) {
				currentDate = line.slice(5).trim();
			}
		}
	}

	// Don't forget the last message
	if (currentSubject && subjects.length < 5) {
		subjects.push(currentSubject);
	}
	if (currentDate) {
		const parsed = new Date(currentDate);
		if (!isNaN(parsed.getTime())) {
			dates.push(parsed);
		}
	}

	const fileSizeBytes = statSync(filePath).size;
	const avgOutputPerEmail = 3000;

	let dateRange: { oldest: string; newest: string } | undefined;
	if (dates.length > 0) {
		dates.sort((a, b) => a.getTime() - b.getTime());
		dateRange = {
			oldest: dates[0].toISOString(),
			newest: dates[dates.length - 1].toISOString(),
		};
	}

	return {
		format: 'mbox',
		filename: basename(filePath),
		fileSizeBytes,
		canPreview: true,
		totalItems: emailCount,
		estimatedOutputFiles: emailCount,
		estimatedOutputSizeBytes: emailCount * avgOutputPerEmail,
		dateRange,
		breakdown: { emails: emailCount },
		samples: subjects.length > 0 ? subjects : undefined,
	};
}

/**
 * Analyze Spotify export folder
 */
export async function analyzeSpotify(folderPath: string): Promise<AnalysisResult> {
	const sanitizedPath = sanitizeFolderPath(folderPath);
	const files = readdirSync(sanitizedPath);
	let streamingCount = 0;
	let playlistCount = 0;
	let libraryCount = 0;
	const dates: Date[] = [];
	const samples: string[] = [];

	// Count streaming history entries
	const streamingFiles = files.filter(
		(f) => f.startsWith('StreamingHistory') && f.endsWith('.json'),
	);
	for (const file of streamingFiles) {
		try {
			const content = readFileSync(join(sanitizedPath, file), 'utf-8');
			const data = JSON.parse(content) as Array<{
				endTime?: string;
				artistName?: string;
				trackName?: string;
			}>;
			streamingCount += data.length;

			// Extract dates and samples from first file
			if (dates.length === 0 && data.length > 0) {
				for (const entry of data.slice(0, 100)) {
					if (entry.endTime) {
						const parsed = new Date(entry.endTime);
						if (!isNaN(parsed.getTime())) {
							dates.push(parsed);
						}
					}
					if (samples.length < 5 && entry.artistName && entry.trackName) {
						samples.push(`${entry.artistName} - ${entry.trackName}`);
					}
				}
			}
		} catch {
			// Skip malformed files
		}
	}

	// Count playlist entries
	const playlistFiles = files.filter((f) => f.startsWith('Playlist') && f.endsWith('.json'));
	for (const file of playlistFiles) {
		try {
			const content = readFileSync(join(sanitizedPath, file), 'utf-8');
			const data = JSON.parse(content);
			if (data.playlists) {
				playlistCount += data.playlists.length;
			}
		} catch {
			// Skip malformed files
		}
	}

	// Count library items
	if (files.includes('YourLibrary.json')) {
		try {
			const content = readFileSync(join(sanitizedPath, 'YourLibrary.json'), 'utf-8');
			const data = JSON.parse(content);
			if (data.tracks) libraryCount += data.tracks.length;
			if (data.albums) libraryCount += data.albums.length;
			if (data.artists) libraryCount += data.artists.length;
		} catch {
			// Skip malformed files
		}
	}

	const totalItems = streamingCount + playlistCount + libraryCount;
	const folderSize = files.reduce((sum, f) => {
		try {
			return sum + statSync(join(sanitizedPath, f)).size;
		} catch {
			return sum;
		}
	}, 0);

	let dateRange: { oldest: string; newest: string } | undefined;
	if (dates.length > 0) {
		dates.sort((a, b) => a.getTime() - b.getTime());
		dateRange = {
			oldest: dates[0].toISOString(),
			newest: dates[dates.length - 1].toISOString(),
		};
	}

	// Estimate: deduplicate streaming by day+track (~10% of raw), plus playlists
	const estimatedOutputFiles = Math.ceil(streamingCount * 0.1) + playlistCount;

	return {
		format: 'spotify',
		filename: basename(sanitizedPath),
		fileSizeBytes: folderSize,
		canPreview: true,
		totalItems,
		estimatedOutputFiles,
		estimatedOutputSizeBytes: estimatedOutputFiles * 2000,
		dateRange,
		breakdown: {
			streamingHistory: streamingCount,
			playlists: playlistCount,
			library: libraryCount,
		},
		samples: samples.length > 0 ? samples : undefined,
	};
}

/**
 * Analyze Reddit export folder
 */
export async function analyzeReddit(folderPath: string): Promise<AnalysisResult> {
	const sanitizedPath = sanitizeFolderPath(folderPath);
	const files = readdirSync(sanitizedPath);
	let comments = 0;
	let posts = 0;
	let savedPosts = 0;
	let messages = 0;
	const samples: string[] = [];

	// Count CSV rows (subtract 1 for header)
	const countCsvRows = (filename: string): number => {
		if (!files.includes(filename)) return 0;
		try {
			const content = readFileSync(join(sanitizedPath, filename), 'utf-8');
			const lines = content.split('\n').filter((l) => l.trim());
			return Math.max(0, lines.length - 1);
		} catch {
			return 0;
		}
	};

	comments = countCsvRows('comments.csv');
	posts = countCsvRows('posts.csv');
	savedPosts = countCsvRows('saved_posts.csv');
	messages = countCsvRows('messages.csv');

	// Get sample comments
	if (files.includes('comments.csv')) {
		try {
			const content = readFileSync(join(sanitizedPath, 'comments.csv'), 'utf-8');
			const lines = content.split('\n').slice(1, 6);
			for (const line of lines) {
				const parts = line.split(',');
				if (parts.length > 2 && samples.length < 5) {
					// Typically: id,permalink,body
					const body = parts.slice(2).join(',').slice(0, 80);
					if (body) samples.push(body.replace(/"/g, '').trim());
				}
			}
		} catch {
			// Skip
		}
	}

	const totalItems = comments + posts + savedPosts + messages;
	const folderSize = files.reduce((sum, f) => {
		try {
			return sum + statSync(join(sanitizedPath, f)).size;
		} catch {
			return sum;
		}
	}, 0);

	return {
		format: 'reddit',
		filename: basename(sanitizedPath),
		fileSizeBytes: folderSize,
		canPreview: true,
		totalItems,
		estimatedOutputFiles: comments + posts + savedPosts + Math.ceil(messages / 10), // Group messages by thread
		estimatedOutputSizeBytes: totalItems * 1500,
		breakdown: {
			comments,
			posts,
			savedPosts,
			messages,
		},
		samples: samples.length > 0 ? samples : undefined,
	};
}

/**
 * Analyze Facebook export folder
 */
export async function analyzeFacebook(folderPath: string): Promise<AnalysisResult> {
	const sanitizedPath = sanitizeFolderPath(folderPath);
	let messageThreads = 0;
	let photos = 0;
	let videos = 0;
	let posts = 0;
	const samples: string[] = [];

	// Count message threads
	const messagesDir = join(sanitizedPath, 'messages');
	if (existsSync(messagesDir)) {
		try {
			const threads = readdirSync(messagesDir).filter((f) => {
				const stat = statSync(join(messagesDir, f));
				return stat.isDirectory();
			});
			messageThreads = threads.length;
			// Get sample thread names
			for (const thread of threads.slice(0, 5)) {
				samples.push(thread.replace(/_/g, ' '));
			}
		} catch {
			// Skip
		}
	}

	// Count photos
	const photosDir = join(sanitizedPath, 'photos');
	if (existsSync(photosDir)) {
		try {
			const countFiles = (dir: string): number => {
				let count = 0;
				const items = readdirSync(dir);
				for (const item of items) {
					const itemPath = join(dir, item);
					const stat = statSync(itemPath);
					if (stat.isDirectory()) {
						count += countFiles(itemPath);
					} else if (/\.(jpg|jpeg|png|gif)$/i.test(item)) {
						count++;
					}
				}
				return count;
			};
			photos = countFiles(photosDir);
		} catch {
			// Skip
		}
	}

	// Count videos
	const videosDir = join(sanitizedPath, 'videos');
	if (existsSync(videosDir)) {
		try {
			const items = readdirSync(videosDir);
			videos = items.filter((f) => /\.(mp4|mov|avi|webm)$/i.test(f)).length;
		} catch {
			// Skip
		}
	}

	// Check for posts in HTML
	const htmlDir = join(sanitizedPath, 'html');
	if (existsSync(htmlDir)) {
		try {
			const htmlFiles = readdirSync(htmlDir).filter(
				(f) => f.endsWith('.htm') || f.endsWith('.html'),
			);
			posts = htmlFiles.length;
		} catch {
			// Skip
		}
	}

	const totalItems = messageThreads + photos + videos + posts;

	// Calculate folder size
	const getFolderSize = (dir: string): number => {
		let size = 0;
		try {
			const items = readdirSync(dir);
			for (const item of items) {
				const itemPath = join(dir, item);
				const stat = statSync(itemPath);
				if (stat.isDirectory()) {
					size += getFolderSize(itemPath);
				} else {
					size += stat.size;
				}
			}
		} catch {
			// Skip inaccessible dirs
		}
		return size;
	};

	const fileSizeBytes = getFolderSize(sanitizedPath);

	return {
		format: 'facebook',
		filename: basename(sanitizedPath),
		fileSizeBytes,
		canPreview: true,
		totalItems,
		estimatedOutputFiles: messageThreads + posts, // One file per thread/post, no media conversion
		estimatedOutputSizeBytes: (messageThreads + posts) * 5000,
		breakdown: {
			messageThreads,
			photos,
			videos,
			posts,
		},
		samples: samples.length > 0 ? samples : undefined,
	};
}

/**
 * Analyze Instagram export folder
 */
export async function analyzeInstagram(folderPath: string): Promise<AnalysisResult> {
	const sanitizedPath = sanitizeFolderPath(folderPath);
	let messageThreads = 0;
	let likes = 0;
	let comments = 0;
	let posts = 0;
	let media = 0;
	const samples: string[] = [];

	// Count message threads
	const messagesDir = join(sanitizedPath, 'messages');
	if (existsSync(messagesDir)) {
		try {
			// Check inbox subfolder
			const inboxDir = join(messagesDir, 'inbox');
			if (existsSync(inboxDir)) {
				const threads = readdirSync(inboxDir).filter((f) => {
					const stat = statSync(join(inboxDir, f));
					return stat.isDirectory();
				});
				messageThreads = threads.length;
				for (const thread of threads.slice(0, 5)) {
					samples.push(thread.replace(/_/g, ' '));
				}
			} else {
				// Direct messages folder structure
				const threads = readdirSync(messagesDir).filter((f) => {
					const p = join(messagesDir, f);
					return existsSync(p) && statSync(p).isDirectory();
				});
				messageThreads = threads.length;
			}
		} catch {
			// Skip
		}
	}

	// Count likes
	const likesDir = join(sanitizedPath, 'likes');
	if (existsSync(likesDir)) {
		try {
			const files = readdirSync(likesDir);
			for (const file of files) {
				if (file.endsWith('.json')) {
					const content = readFileSync(join(likesDir, file), 'utf-8');
					const data = JSON.parse(content);
					if (Array.isArray(data)) {
						likes += data.length;
					} else if (data.likes_media_likes) {
						likes += data.likes_media_likes.length;
					}
				}
			}
		} catch {
			// Skip
		}
	}

	// Count comments
	const commentsDir = join(sanitizedPath, 'comments');
	if (existsSync(commentsDir)) {
		try {
			const files = readdirSync(commentsDir);
			for (const file of files) {
				if (file.endsWith('.json')) {
					const content = readFileSync(join(commentsDir, file), 'utf-8');
					const data = JSON.parse(content);
					if (Array.isArray(data)) {
						comments += data.length;
					} else if (data.comments_media_comments) {
						comments += data.comments_media_comments.length;
					}
				}
			}
		} catch {
			// Skip
		}
	}

	// Count media
	const mediaDir = join(sanitizedPath, 'media');
	if (existsSync(mediaDir)) {
		try {
			const countMedia = (dir: string): number => {
				let count = 0;
				const items = readdirSync(dir);
				for (const item of items) {
					const itemPath = join(dir, item);
					const stat = statSync(itemPath);
					if (stat.isDirectory()) {
						count += countMedia(itemPath);
					} else if (/\.(jpg|jpeg|png|gif|mp4|mov)$/i.test(item)) {
						count++;
					}
				}
				return count;
			};
			media = countMedia(mediaDir);
		} catch {
			// Skip
		}
	}

	// Count content/posts
	const contentDir = join(sanitizedPath, 'content');
	if (existsSync(contentDir)) {
		try {
			const files = readdirSync(contentDir);
			for (const file of files) {
				if (file.endsWith('.json')) {
					const content = readFileSync(join(contentDir, file), 'utf-8');
					const data = JSON.parse(content);
					if (Array.isArray(data)) {
						posts += data.length;
					}
				}
			}
		} catch {
			// Skip
		}
	}

	const totalItems = messageThreads + likes + comments + posts + media;

	// Calculate folder size
	const getFolderSize = (dir: string): number => {
		let size = 0;
		try {
			const items = readdirSync(dir);
			for (const item of items) {
				const itemPath = join(dir, item);
				const stat = statSync(itemPath);
				if (stat.isDirectory()) {
					size += getFolderSize(itemPath);
				} else {
					size += stat.size;
				}
			}
		} catch {
			// Skip
		}
		return size;
	};

	const fileSizeBytes = getFolderSize(sanitizedPath);

	return {
		format: 'instagram',
		filename: basename(sanitizedPath),
		fileSizeBytes,
		canPreview: true,
		totalItems,
		estimatedOutputFiles: messageThreads + comments + Math.ceil(likes / 50), // Group likes
		estimatedOutputSizeBytes: (messageThreads + comments) * 3000,
		breakdown: {
			messageThreads,
			likes,
			comments,
			posts,
			media,
		},
		samples: samples.length > 0 ? samples : undefined,
	};
}

/**
 * Analyze ZIP archive by extracting and detecting format
 */
async function analyzeZip(zipPath: string): Promise<AnalysisResult> {
	const tempDir = join(tmpdir(), `analyze-zip-${Date.now()}`);
	mkdirSync(tempDir, { recursive: true });

	try {
		// Extract to temp using unzipper
		const directory = await Open.file(zipPath);
		await directory.extract({ path: tempDir });

		// Find content root (may be nested like facebook-username-date/)
		const entries = readdirSync(tempDir);
		let contentRoot = tempDir;
		if (entries.length === 1) {
			const nested = join(tempDir, entries[0]);
			if (statSync(nested).isDirectory()) {
				contentRoot = nested;
			}
		}

		// Detect format and analyze
		const files = readdirSync(contentRoot);
		const zipSize = statSync(zipPath).size;
		const zipFilename = basename(zipPath);

		// Facebook: messages/ folder + index.htm
		if (
			files.includes('messages') &&
			(files.includes('index.htm') || files.includes('index.html'))
		) {
			const result = await analyzeFacebook(contentRoot);
			result.filename = zipFilename;
			result.fileSizeBytes = zipSize;
			return result;
		}

		// Spotify: StreamingHistory*.json
		if (files.some((f) => f.startsWith('StreamingHistory') && f.endsWith('.json'))) {
			const result = await analyzeSpotify(contentRoot);
			result.filename = zipFilename;
			result.fileSizeBytes = zipSize;
			return result;
		}

		// Instagram: messages/ + account_information/ or content/ or likes/
		if (
			files.includes('messages') &&
			(files.includes('account_information') ||
				files.includes('content') ||
				files.includes('likes'))
		) {
			const result = await analyzeInstagram(contentRoot);
			result.filename = zipFilename;
			result.fileSizeBytes = zipSize;
			return result;
		}

		// Reddit: comments.csv or posts.csv
		if (files.includes('comments.csv') || files.includes('posts.csv')) {
			const result = await analyzeReddit(contentRoot);
			result.filename = zipFilename;
			result.fileSizeBytes = zipSize;
			return result;
		}

		// Google Takeout: Takeout/ folder
		if (files.includes('Takeout')) {
			return {
				format: 'takeout',
				filename: zipFilename,
				fileSizeBytes: zipSize,
				canPreview: true,
				totalItems: 0,
				estimatedOutputFiles: 0,
				estimatedOutputSizeBytes: 0,
				breakdown: { note: 'Google Takeout detected' },
			};
		}

		// Unknown format
		return {
			format: 'unknown',
			filename: zipFilename,
			fileSizeBytes: zipSize,
			canPreview: false,
			totalItems: 0,
			estimatedOutputFiles: 0,
			estimatedOutputSizeBytes: 0,
		};
	} finally {
		// Clean up temp directory
		rmSync(tempDir, { recursive: true, force: true });
	}
}

/**
 * Detect format and analyze export
 */
export async function analyzeExport(path: string): Promise<AnalysisResult> {
	const stat = statSync(path);
	const name = basename(path);
	const ext = extname(path).toLowerCase();

	// File-based detection
	if (stat.isFile()) {
		if (ext === '.mbox') {
			return analyzeMbox(path);
		}
		// ZIP files - extract and analyze contents
		if (ext === '.zip') {
			return analyzeZip(path);
		}
	}

	// Folder-based detection
	if (stat.isDirectory()) {
		const files = readdirSync(path);

		// Spotify: has StreamingHistory*.json
		if (files.some((f) => f.startsWith('StreamingHistory') && f.endsWith('.json'))) {
			return analyzeSpotify(path);
		}

		// Reddit: has comments.csv or posts.csv
		if (files.includes('comments.csv') || files.includes('posts.csv')) {
			return analyzeReddit(path);
		}

		// Facebook: has messages/ folder and index.htm
		if (
			files.includes('messages') &&
			(files.includes('index.htm') || files.includes('index.html'))
		) {
			return analyzeFacebook(path);
		}

		// Instagram: has messages/ and account_information/ or content/
		if (
			files.includes('messages') &&
			(files.includes('account_information') ||
				files.includes('content') ||
				files.includes('likes'))
		) {
			return analyzeInstagram(path);
		}
	}

	// Unknown format
	return {
		format: 'unknown',
		filename: name,
		fileSizeBytes: stat.size,
		canPreview: false,
		totalItems: 0,
		estimatedOutputFiles: 0,
		estimatedOutputSizeBytes: 0,
	};
}
