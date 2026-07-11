import { spawnSync } from 'node:child_process';
/**
 * File Router - Detect file types and route to appropriate converters
 */
import { existsSync, readdirSync, statSync } from 'node:fs';
import { basename, extname, join } from 'node:path';
import type { ConverterType, FileType, ScannedFile, SizeTier } from '../../shared/types.js';
import { logger } from '../utils/logger.js';

// Extension to file type mapping
const EXTENSION_MAP: Record<string, FileType> = {
	// Email (CLI converters)
	'.mbox': 'mbox',
	'.eml': 'eml',
	'.html': 'html',
	'.htm': 'html',

	// Documents
	'.pdf': 'pdf',
	'.docx': 'docx',
	'.doc': 'doc',
	'.rtf': 'rtf',
	'.odt': 'odt',

	// Spreadsheets
	'.xlsx': 'xlsx',
	'.xls': 'xls',
	'.xlsb': 'xlsb',
	'.csv': 'csv',
	'.ods': 'ods',

	// Presentations
	'.pptx': 'pptx',
	'.ppt': 'ppt',
	'.odp': 'odp',

	// Text files
	'.txt': 'txt',
	'.md': 'md',
	'.text': 'text',

	// Data formats
	'.xml': 'xml',
	'.json': 'json',

	// Archives
	'.zip': 'zip',
};

// File type to converter type mapping
const CONVERTER_MAP: Record<FileType, ConverterType | null> = {
	// Email formats -> CLI converters
	mbox: 'mbox',
	'mbox-bundle': 'mbox',
	eml: 'eml',
	html: 'html',
	takeout: 'takeout',
	facebook: 'facebook',
	instagram: 'instagram',
	spotify: 'spotify',
	reddit: 'reddit',
	zip: null, // Needs classification first

	// Documents -> processor
	pdf: 'processor',
	docx: 'processor',
	doc: 'processor',
	rtf: 'processor',
	odt: 'processor',

	// Spreadsheets -> processor
	xlsx: 'processor',
	xls: 'processor',
	xlsb: 'processor',
	csv: 'processor',
	ods: 'processor',

	// Presentations -> processor
	pptx: 'processor',
	ppt: 'processor',
	odp: 'processor',

	// Text -> processor
	txt: 'processor',
	md: 'processor',
	text: 'processor',
	rtfd: 'processor',

	// Data -> processor
	xml: 'processor',
	json: 'processor',

	unknown: null,
};

// UTI (Uniform Type Identifier) to FileType mapping for macOS extensionless files
const UTI_MAP: Record<string, FileType> = {
	// Plain text variants
	'public.plain-text': 'txt',
	'public.utf8-plain-text': 'txt',
	'public.text': 'txt',
	'com.apple.traditional-mac-plain-text': 'txt',
	// Rich text / HTML
	'public.rtf': 'rtf',
	'public.html': 'html',
	// Email
	'com.apple.mail.mbox': 'mbox',
	'public.email-message': 'eml',
};

/**
 * Get the actual content size for bundle directories.
 * statSync on a directory returns the directory entry size, not the content size.
 * For known bundle types, stat the inner payload file instead.
 */
export function getBundleContentSize(dirPath: string, type: FileType): number {
	try {
		if (type === 'mbox-bundle') {
			// Apple Mail .mbox bundle: actual data is in the inner "mbox" file
			const innerPath = join(dirPath, 'mbox');
			if (existsSync(innerPath)) {
				return statSync(innerPath).size;
			}
		}
		if (type === 'rtfd') {
			// macOS RTFD bundle: main content is in TXT.rtf
			const innerPath = join(dirPath, 'TXT.rtf');
			if (existsSync(innerPath)) {
				return statSync(innerPath).size;
			}
		}
		if (type === 'takeout') {
			// Google Drive export: sum all files recursively
			return getRecursiveDirectorySize(dirPath);
		}
	} catch {
		// Fall through to directory stat
	}
	// Fallback: use the directory entry size (inaccurate but safe)
	return statSync(dirPath).size;
}

/**
 * Recursively compute the total size of all files in a directory.
 * Skips dotfiles and node_modules, consistent with project conventions.
 */
function getRecursiveDirectorySize(dirPath: string): number {
	let total = 0;
	const entries = readdirSync(dirPath, { withFileTypes: true });
	for (const entry of entries) {
		if (entry.name.startsWith('.') || entry.name === 'node_modules') continue;
		const fullPath = join(dirPath, entry.name);
		try {
			if (entry.isDirectory()) {
				total += getRecursiveDirectorySize(fullPath);
			} else {
				total += statSync(fullPath).size;
			}
		} catch {
			// Skip unreadable entries (permission denied, broken symlink, etc.)
		}
	}
	return total;
}

/**
 * Classify file size into tiers with appropriate warning messages
 */
export function classifyFileSize(
	sizeBytes: number,
	type: FileType,
): { sizeTier: SizeTier; sizeWarning?: string } {
	const sizeMB = sizeBytes / (1024 * 1024);

	if (type === 'mbox' || type === 'mbox-bundle') {
		if (sizeMB > 10) {
			return {
				sizeTier: 'large',
				sizeWarning: `Large MBOX (${sizeMB.toFixed(1)}MB) - will be split by date during conversion`,
			};
		}
		if (sizeMB > 5) {
			return {
				sizeTier: 'warning',
				sizeWarning: 'Large file - conversion may take several minutes',
			};
		}
	} else if (type === 'html') {
		if (sizeMB > 5) {
			return {
				sizeTier: 'large',
				sizeWarning: 'Very large HTML file - consider splitting',
			};
		}
		if (sizeMB > 2) {
			return {
				sizeTier: 'warning',
				sizeWarning: 'Large HTML file - conversion may be slow',
			};
		}
	} else {
		if (sizeMB > 10) {
			return {
				sizeTier: 'large',
				sizeWarning: `Large file (${sizeMB.toFixed(1)}MB) - may fail upload`,
			};
		}
		if (sizeMB > 5) {
			return {
				sizeTier: 'warning',
				sizeWarning: 'Large file detected',
			};
		}
	}

	return { sizeTier: 'normal' };
}

/**
 * Cache for mdls results — avoids re-spawning mdls for the same file.
 * Keyed by absolute file path.
 */
const mdlsCache = new Map<string, FileType>();

/**
 * Detect file type via macOS mdls command for extensionless files.
 * Results are cached to reduce redundant process spawns during large scans.
 */
function detectTypeViaMdls(filePath: string): FileType {
	const cached = mdlsCache.get(filePath);
	if (cached !== undefined) return cached;

	let result: FileType = 'unknown';
	try {
		const proc = spawnSync('mdls', ['-name', 'kMDItemContentType', filePath], {
			encoding: 'utf8',
			timeout: 5000,
			stdio: ['pipe', 'pipe', 'pipe'],
		});
		const output = proc.stdout;
		logger.debug(`[file-router] mdls output for "${filePath}": ${output.trim()}`);
		const match = output.match(/"(.+)"/);
		if (match) {
			const uti = match[1];
			let mappedType = UTI_MAP[uti];

			// Fallback: if UTI contains "text", treat as plain text
			if (!mappedType && (uti.includes('text') || uti.includes('plain'))) {
				logger.debug(
					`[file-router] UTI "${uti}" not in map, but looks like text - treating as txt`,
				);
				mappedType = 'txt';
			}

			logger.debug(`[file-router] UTI "${uti}" -> type "${mappedType || 'unknown'}"`);
			result = mappedType || 'unknown';
		} else {
			logger.debug('[file-router] mdls returned no UTI match');
		}
	} catch (err) {
		logger.debug(`[file-router] mdls failed for "${filePath}":`, err);
	}

	mdlsCache.set(filePath, result);
	return result;
}

/**
 * Check if a directory is an Apple Mail .mbox bundle
 * Apple Mail stores .mbox as directories containing:
 *   - mbox (the actual mbox file)
 *   - table_of_contents
 *   - Info.plist (optional)
 */
export function isAppleMailBundle(dirPath: string): boolean {
	try {
		const entries = readdirSync(dirPath);
		return entries.includes('mbox');
	} catch {
		return false;
	}
}

/**
 * Check if a directory is a macOS RTFD bundle
 */
export function isRtfdBundle(dirPath: string): boolean {
	const ext = extname(dirPath).toLowerCase();
	if (ext !== '.rtfd') return false;

	try {
		const entries = readdirSync(dirPath);
		return entries.includes('TXT.rtf');
	} catch {
		return false;
	}
}

/**
 * Check if a directory is a Google Drive export folder
 * Drive export folders have -info.json companion files alongside documents
 */
export function isDriveExportFolder(dirPath: string, dirName: string): boolean {
	const driveNames = ['Drive', 'Google Drive', 'My Drive'];
	if (!driveNames.some((n) => dirName.includes(n))) return false;

	try {
		const entries = readdirSync(dirPath);
		return entries.some((e) => e.endsWith('-info.json'));
	} catch {
		return false;
	}
}

/**
 * Get the actual mbox file path from an Apple Mail bundle
 */
export function getMboxPathFromBundle(bundlePath: string): string {
	return join(bundlePath, 'mbox');
}

/**
 * Route a file by extension alone (no stat call). Use when the caller already
 * knows the path is a regular file. Falls back to mdls on macOS for
 * extensionless files.
 */
export function routeFileByExt(filePath: string): {
	type: FileType;
	converterType: ConverterType | null;
} {
	const ext = extname(filePath).toLowerCase();
	let type = EXTENSION_MAP[ext] || 'unknown';

	if (type === 'unknown' && ext === '' && process.platform === 'darwin') {
		type = detectTypeViaMdls(filePath);
	}

	const converterType = CONVERTER_MAP[type];
	return { type, converterType };
}

/**
 * Route a single path to its file type
 */
export function routeFile(filePath: string): {
	type: FileType;
	converterType: ConverterType | null;
} {
	const ext = extname(filePath).toLowerCase();
	logger.debug(`[file-router] routeFile: "${filePath}" ext="${ext}"`);

	try {
		const stats = statSync(filePath);

		if (stats.isDirectory()) {
			logger.debug(`[file-router] "${filePath}" is a directory`);
			// Check for .mbox bundle (Apple Mail format)
			if (ext === '.mbox' && isAppleMailBundle(filePath)) {
				logger.debug('[file-router] -> detected as mbox-bundle');
				return { type: 'mbox-bundle', converterType: 'mbox' };
			}

			// Check for .rtfd bundle (macOS rich text)
			if (isRtfdBundle(filePath)) {
				logger.debug('[file-router] -> detected as rtfd');
				return { type: 'rtfd', converterType: 'processor' };
			}

			// Regular directory - will be scanned
			logger.debug('[file-router] -> regular directory, will scan contents');
			return { type: 'unknown', converterType: null };
		}

		// Handle files by extension
		let type = EXTENSION_MAP[ext] || 'unknown';
		logger.debug(`[file-router] extension lookup: ext="${ext}" -> type="${type}"`);

		// Fallback: use macOS mdls for extensionless files
		if (type === 'unknown' && ext === '' && process.platform === 'darwin') {
			logger.debug('[file-router] trying mdls fallback for extensionless file');
			type = detectTypeViaMdls(filePath);
		}

		const converterType = CONVERTER_MAP[type];
		logger.debug(`[file-router] -> final: type="${type}" converterType="${converterType}"`);

		return { type, converterType };
	} catch (err) {
		logger.debug(`[file-router] error routing "${filePath}":`, err);
		return { type: 'unknown', converterType: null };
	}
}

/**
 * Generate a unique ID for a file
 */
function generateFileId(): string {
	return `file-${Date.now()}-${Math.random().toString(36).slice(2, 9)}`;
}

/**
 * Recursively scan a directory for convertible files
 */
export function scanDirectory(dirPath: string): ScannedFile[] {
	const results: ScannedFile[] = [];

	try {
		const entries = readdirSync(dirPath, { withFileTypes: true });

		for (const entry of entries) {
			// Skip hidden files and system files
			if (entry.name.startsWith('.') || entry.name === 'node_modules') {
				continue;
			}

			const fullPath = join(dirPath, entry.name);

			if (entry.isDirectory()) {
				const ext = extname(entry.name).toLowerCase();

				// Check for .mbox bundle
				if (ext === '.mbox' && isAppleMailBundle(fullPath)) {
					const contentSize = getBundleContentSize(fullPath, 'mbox-bundle');
					const { sizeTier, sizeWarning } = classifyFileSize(contentSize, 'mbox-bundle');
					results.push({
						id: generateFileId(),
						path: fullPath,
						name: entry.name,
						type: 'mbox-bundle',
						converterType: 'mbox',
						size: contentSize,
						isDirectory: true,
						sizeTier,
						sizeWarning,
					});
				} else if (isRtfdBundle(fullPath)) {
					// Check for RTFD bundle
					const contentSize = getBundleContentSize(fullPath, 'rtfd');
					const { sizeTier, sizeWarning } = classifyFileSize(contentSize, 'rtfd');
					results.push({
						id: generateFileId(),
						path: fullPath,
						name: entry.name,
						type: 'rtfd',
						converterType: 'processor',
						size: contentSize,
						isDirectory: true,
						sizeTier,
						sizeWarning,
					});
				} else if (isDriveExportFolder(fullPath, entry.name)) {
					// Google Drive export folder - route to takeout converter
					const contentSize = getBundleContentSize(fullPath, 'takeout');
					const { sizeTier, sizeWarning } = classifyFileSize(contentSize, 'takeout');
					results.push({
						id: generateFileId(),
						path: fullPath,
						name: entry.name,
						type: 'takeout',
						converterType: 'takeout',
						size: contentSize,
						isDirectory: true,
						sizeTier,
						sizeWarning,
					});
				} else {
					// Recurse into regular directories
					const children = scanDirectory(fullPath);
					results.push(...children);
				}
			} else {
				const { type, converterType } = routeFile(fullPath);
				if (type !== 'unknown' && converterType !== null) {
					const stats = statSync(fullPath);
					const { sizeTier, sizeWarning } = classifyFileSize(stats.size, type);
					results.push({
						id: generateFileId(),
						path: fullPath,
						name: entry.name,
						type,
						converterType,
						size: stats.size,
						isDirectory: false,
						sizeTier,
						sizeWarning,
					});
				}
			}
		}
	} catch (error) {
		logger.error(`[file-router] Error scanning directory ${dirPath}:`, error);
	}

	return results;
}

/**
 * Scan multiple paths (files and/or directories)
 */
export async function scanPaths(paths: string[]): Promise<ScannedFile[]> {
	logger.debug(`[file-router] scanPaths called with ${paths.length} path(s):`);
	paths.forEach((p, i) => {
		logger.debug(`[file-router]   [${i}] ${p}`);
	});

	const results: ScannedFile[] = [];

	for (const path of paths) {
		try {
			if (!existsSync(path)) {
				logger.debug(`[file-router] path does not exist: "${path}"`);
				continue;
			}

			const stats = statSync(path);

			if (stats.isDirectory()) {
				const ext = extname(path).toLowerCase();

				// Check for bundle types
				if (ext === '.mbox' && isAppleMailBundle(path)) {
					const contentSize = getBundleContentSize(path, 'mbox-bundle');
					const { sizeTier, sizeWarning } = classifyFileSize(contentSize, 'mbox-bundle');
					results.push({
						id: generateFileId(),
						path,
						name: basename(path),
						type: 'mbox-bundle',
						converterType: 'mbox',
						size: contentSize,
						isDirectory: true,
						sizeTier,
						sizeWarning,
					});
				} else if (isRtfdBundle(path)) {
					const contentSize = getBundleContentSize(path, 'rtfd');
					const { sizeTier, sizeWarning } = classifyFileSize(contentSize, 'rtfd');
					results.push({
						id: generateFileId(),
						path,
						name: basename(path),
						type: 'rtfd',
						converterType: 'processor',
						size: contentSize,
						isDirectory: true,
						sizeTier,
						sizeWarning,
					});
				} else if (isDriveExportFolder(path, basename(path))) {
					logger.debug(`[file-router] detected Google Drive export folder: "${path}"`);
					const contentSize = getBundleContentSize(path, 'takeout');
					const { sizeTier, sizeWarning } = classifyFileSize(contentSize, 'takeout');
					results.push({
						id: generateFileId(),
						path,
						name: basename(path),
						type: 'takeout',
						converterType: 'takeout',
						size: contentSize,
						isDirectory: true,
						sizeTier,
						sizeWarning,
					});
				} else {
					// Scan directory contents
					const children = scanDirectory(path);
					results.push(...children);
				}
			} else {
				// Single file
				let { type, converterType } = routeFile(path);

				// For ZIP files, classify to determine actual type
				if (type === 'zip') {
					logger.debug(`[file-router] classifying ZIP file: "${path}"`);
					type = await classifyZip(path);
					converterType = CONVERTER_MAP[type];
					logger.debug(
						`[file-router] ZIP classified as: type="${type}" converterType="${converterType}"`,
					);
				}

				if (type !== 'unknown' && converterType !== null) {
					logger.debug(`[file-router] adding file: "${path}" type="${type}"`);
					const { sizeTier, sizeWarning } = classifyFileSize(stats.size, type);
					results.push({
						id: generateFileId(),
						path,
						name: basename(path),
						type,
						converterType,
						size: stats.size,
						isDirectory: false,
						sizeTier,
						sizeWarning,
					});
				} else {
					logger.debug(`[file-router] SKIPPING file (unknown type or no converter): "${path}"`);
				}
			}
		} catch (error) {
			logger.error(`[file-router] Error scanning path ${path}:`, error);
		}
	}

	logger.debug(`[file-router] scanPaths complete: found ${results.length} convertible file(s)`);
	return results;
}

/**
 * Classify a ZIP file to determine its type
 */
export async function classifyZip(zipPath: string): Promise<FileType> {
	try {
		const unzipper = await import('unzipper');

		const directory = await unzipper.Open.file(zipPath);
		const entries = directory.files.map((f) => f.path);

		// Facebook: has messages/ folder and index.htm at root level or nested
		const hasFacebookSignature = entries.some(
			(e) =>
				(e.includes('/messages/') || e.startsWith('messages/')) &&
				entries.some((f) => f.endsWith('index.htm') || f.endsWith('index.html')),
		);
		if (hasFacebookSignature) {
			logger.debug('[file-router] classifyZip: detected Facebook export');
			return 'facebook';
		}

		// Instagram: has messages/ and account_information/ or your_instagram_activity/
		const hasInstagramSignature =
			entries.some((e) => e.includes('/messages/') || e.startsWith('messages/')) &&
			(entries.some((e) => e.includes('account_information/')) ||
				entries.some((e) => e.includes('your_instagram_activity/')) ||
				entries.some((e) => e.includes('/likes/') || e.startsWith('likes/')));
		if (hasInstagramSignature) {
			logger.debug('[file-router] classifyZip: detected Instagram export');
			return 'instagram';
		}

		// Spotify: has StreamingHistory*.json files
		const hasSpotifySignature = entries.some(
			(e) => e.includes('StreamingHistory') && e.endsWith('.json'),
		);
		if (hasSpotifySignature) {
			logger.debug('[file-router] classifyZip: detected Spotify export');
			return 'spotify';
		}

		// Reddit: has comments.csv or posts.csv
		const hasRedditSignature =
			entries.some((e) => e.endsWith('comments.csv')) ||
			entries.some((e) => e.endsWith('posts.csv'));
		if (hasRedditSignature) {
			logger.debug('[file-router] classifyZip: detected Reddit export');
			return 'reddit';
		}

		// Google Takeout signature
		if (entries.some((e) => e.includes('Takeout/'))) {
			logger.debug('[file-router] classifyZip: detected Google Takeout');
			return 'takeout';
		}

		// Archive of supported files
		const supportedExts = Object.keys(EXTENSION_MAP);
		const hasSupported = entries.some((entry) =>
			supportedExts.some((ext) => entry.toLowerCase().endsWith(ext)),
		);

		if (hasSupported) {
			logger.debug('[file-router] classifyZip: detected generic archive');
			return 'zip';
		}

		logger.debug('[file-router] classifyZip: unknown ZIP format');
		return 'unknown';
	} catch (err) {
		logger.debug('[file-router] classifyZip error:', err);
		return 'unknown';
	}
}
