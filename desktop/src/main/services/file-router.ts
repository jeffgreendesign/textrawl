import { spawnSync } from 'node:child_process';
/**
 * File Router - Detect file types and route to appropriate converters
 */
import { existsSync, readdirSync, statSync } from 'node:fs';
import { basename, extname, join } from 'node:path';
import type { ConverterType, FileType, ScannedFile } from '../../shared/types.js';

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
 * Detect file type via macOS mdls command for extensionless files
 */
function detectTypeViaMdls(filePath: string): FileType {
	try {
		const result = spawnSync('mdls', ['-name', 'kMDItemContentType', filePath], {
			encoding: 'utf8',
			timeout: 5000,
		});
		const output = result.stdout;
		console.error(`[file-router] mdls output for "${filePath}": ${output.trim()}`);
		const match = output.match(/"(.+)"/);
		if (match) {
			const uti = match[1];
			let mappedType = UTI_MAP[uti];

			// Fallback: if UTI contains "text", treat as plain text
			if (!mappedType && (uti.includes('text') || uti.includes('plain'))) {
				console.error(
					`[file-router] UTI "${uti}" not in map, but looks like text - treating as txt`,
				);
				mappedType = 'txt';
			}

			console.error(`[file-router] UTI "${uti}" -> type "${mappedType || 'unknown'}"`);
			return mappedType || 'unknown';
		}
		console.error('[file-router] mdls returned no UTI match');
	} catch (err) {
		console.error(`[file-router] mdls failed for "${filePath}":`, err);
	}
	return 'unknown';
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
 * Route a single path to its file type
 */
export function routeFile(filePath: string): {
	type: FileType;
	converterType: ConverterType | null;
} {
	const ext = extname(filePath).toLowerCase();
	console.error(`[file-router] routeFile: "${filePath}" ext="${ext}"`);

	try {
		const stats = statSync(filePath);

		if (stats.isDirectory()) {
			console.error(`[file-router] "${filePath}" is a directory`);
			// Check for .mbox bundle (Apple Mail format)
			if (ext === '.mbox' && isAppleMailBundle(filePath)) {
				console.error('[file-router] -> detected as mbox-bundle');
				return { type: 'mbox-bundle', converterType: 'mbox' };
			}

			// Check for .rtfd bundle (macOS rich text)
			if (isRtfdBundle(filePath)) {
				console.error('[file-router] -> detected as rtfd');
				return { type: 'rtfd', converterType: 'processor' };
			}

			// Regular directory - will be scanned
			console.error('[file-router] -> regular directory, will scan contents');
			return { type: 'unknown', converterType: null };
		}

		// Handle files by extension
		let type = EXTENSION_MAP[ext] || 'unknown';
		console.error(`[file-router] extension lookup: ext="${ext}" -> type="${type}"`);

		// Fallback: use macOS mdls for extensionless files
		if (type === 'unknown' && ext === '' && process.platform === 'darwin') {
			console.error('[file-router] trying mdls fallback for extensionless file');
			type = detectTypeViaMdls(filePath);
		}

		const converterType = CONVERTER_MAP[type];
		console.error(`[file-router] -> final: type="${type}" converterType="${converterType}"`);

		return { type, converterType };
	} catch (err) {
		console.error(`[file-router] error routing "${filePath}":`, err);
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
					const stats = statSync(fullPath);
					results.push({
						id: generateFileId(),
						path: fullPath,
						name: entry.name,
						type: 'mbox-bundle',
						converterType: 'mbox',
						size: stats.size,
						isDirectory: true,
					});
				} else if (isRtfdBundle(fullPath)) {
					// Check for RTFD bundle
					const stats = statSync(fullPath);
					results.push({
						id: generateFileId(),
						path: fullPath,
						name: entry.name,
						type: 'rtfd',
						converterType: 'processor',
						size: stats.size,
						isDirectory: true,
					});
				} else if (isDriveExportFolder(fullPath, entry.name)) {
					// Google Drive export folder - route to takeout converter
					const stats = statSync(fullPath);
					results.push({
						id: generateFileId(),
						path: fullPath,
						name: entry.name,
						type: 'takeout',
						converterType: 'takeout',
						size: stats.size,
						isDirectory: true,
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
					results.push({
						id: generateFileId(),
						path: fullPath,
						name: entry.name,
						type,
						converterType,
						size: stats.size,
						isDirectory: false,
					});
				}
			}
		}
	} catch (error) {
		console.error(`Error scanning directory ${dirPath}:`, error);
	}

	return results;
}

/**
 * Scan multiple paths (files and/or directories)
 */
export async function scanPaths(paths: string[]): Promise<ScannedFile[]> {
	console.error(`[file-router] scanPaths called with ${paths.length} path(s):`);
	paths.forEach((p, i) => console.error(`[file-router]   [${i}] ${p}`));

	const results: ScannedFile[] = [];

	for (const path of paths) {
		try {
			if (!existsSync(path)) {
				console.error(`[file-router] path does not exist: "${path}"`);
				continue;
			}

			const stats = statSync(path);

			if (stats.isDirectory()) {
				const ext = extname(path).toLowerCase();

				// Check for bundle types
				if (ext === '.mbox' && isAppleMailBundle(path)) {
					results.push({
						id: generateFileId(),
						path,
						name: basename(path),
						type: 'mbox-bundle',
						converterType: 'mbox',
						size: stats.size,
						isDirectory: true,
					});
				} else if (isRtfdBundle(path)) {
					results.push({
						id: generateFileId(),
						path,
						name: basename(path),
						type: 'rtfd',
						converterType: 'processor',
						size: stats.size,
						isDirectory: true,
					});
				} else if (isDriveExportFolder(path, basename(path))) {
					console.error(`[file-router] detected Google Drive export folder: "${path}"`);
					results.push({
						id: generateFileId(),
						path,
						name: basename(path),
						type: 'takeout',
						converterType: 'takeout',
						size: stats.size,
						isDirectory: true,
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
					console.error(`[file-router] classifying ZIP file: "${path}"`);
					type = await classifyZip(path);
					converterType = CONVERTER_MAP[type];
					console.error(
						`[file-router] ZIP classified as: type="${type}" converterType="${converterType}"`,
					);
				}

				if (type !== 'unknown' && converterType !== null) {
					console.error(`[file-router] adding file: "${path}" type="${type}"`);
					results.push({
						id: generateFileId(),
						path,
						name: basename(path),
						type,
						converterType,
						size: stats.size,
						isDirectory: false,
					});
				} else {
					console.error(`[file-router] SKIPPING file (unknown type or no converter): "${path}"`);
				}
			}
		} catch (error) {
			console.error(`[file-router] Error scanning path ${path}:`, error);
		}
	}

	console.error(`[file-router] scanPaths complete: found ${results.length} convertible file(s)`);
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
			console.error('[file-router] classifyZip: detected Facebook export');
			return 'facebook';
		}

		// Instagram: has messages/ and account_information/ or your_instagram_activity/
		const hasInstagramSignature =
			entries.some((e) => e.includes('/messages/') || e.startsWith('messages/')) &&
			(entries.some((e) => e.includes('account_information/')) ||
				entries.some((e) => e.includes('your_instagram_activity/')) ||
				entries.some((e) => e.includes('/likes/') || e.startsWith('likes/')));
		if (hasInstagramSignature) {
			console.error('[file-router] classifyZip: detected Instagram export');
			return 'instagram';
		}

		// Spotify: has StreamingHistory*.json files
		const hasSpotifySignature = entries.some(
			(e) => e.includes('StreamingHistory') && e.endsWith('.json'),
		);
		if (hasSpotifySignature) {
			console.error('[file-router] classifyZip: detected Spotify export');
			return 'spotify';
		}

		// Reddit: has comments.csv or posts.csv
		const hasRedditSignature =
			entries.some((e) => e.endsWith('comments.csv')) ||
			entries.some((e) => e.endsWith('posts.csv'));
		if (hasRedditSignature) {
			console.error('[file-router] classifyZip: detected Reddit export');
			return 'reddit';
		}

		// Google Takeout signature
		if (entries.some((e) => e.includes('Takeout/'))) {
			console.error('[file-router] classifyZip: detected Google Takeout');
			return 'takeout';
		}

		// Archive of supported files
		const supportedExts = Object.keys(EXTENSION_MAP);
		const hasSupported = entries.some((entry) =>
			supportedExts.some((ext) => entry.toLowerCase().endsWith(ext)),
		);

		if (hasSupported) {
			console.error('[file-router] classifyZip: detected generic archive');
			return 'zip';
		}

		console.error('[file-router] classifyZip: unknown ZIP format');
		return 'unknown';
	} catch (err) {
		console.error('[file-router] classifyZip error:', err);
		return 'unknown';
	}
}
