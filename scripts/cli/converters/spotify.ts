#!/usr/bin/env npx tsx
/**
 * Spotify Data Export Converter
 *
 * Converts Spotify streaming history, playlists, and library to markdown with YAML front matter
 *
 * Usage:
 *   npm run convert -- spotify <path> [options]
 *   npx tsx scripts/cli/converters/spotify.ts <path> [options]
 */

import { createHash } from 'node:crypto';
import { existsSync, mkdirSync, readFileSync, readdirSync, statSync, writeFileSync } from 'node:fs';
import { basename, dirname, join, resolve } from 'node:path';

import { analyzeSpotify } from '../lib/analyze.js';
import { type CommonOptions, createBaseCommand } from '../lib/args.js';
import { createFrontmatter, serializeFrontmatter } from '../lib/frontmatter.js';
import { slugify } from '../lib/normalizer.js';
import { ProgressReporter, logger } from '../lib/progress.js';
import type { ContentType, ConversionResult, DocumentFrontMatter } from '../lib/types.js';

/**
 * Spotify streaming history entry
 */
interface StreamingEntry {
	endTime: string; // "YYYY-MM-DD HH:MM"
	artistName: string;
	trackName: string;
	msPlayed: number;
}

/**
 * Spotify playlist track
 */
interface PlaylistTrack {
	track: {
		trackName: string;
		artistName: string;
		albumName: string;
		trackUri: string;
	} | null;
	episode: unknown;
	localTrack: unknown;
}

/**
 * Spotify playlist
 */
interface SpotifyPlaylist {
	name: string;
	lastModifiedDate: string;
	items: PlaylistTrack[];
	description: string | null;
	numberOfFollowers: number;
}

/**
 * Spotify library track
 */
interface LibraryTrack {
	artist: string;
	album: string;
	track: string;
	uri: string;
}

/**
 * Spotify converter options
 */
export interface SpotifyOptions extends CommonOptions {
	/** Include streaming history */
	history: boolean;
	/** Include playlists */
	playlists: boolean;
	/** Include library (saved tracks) */
	library: boolean;
	/** Minimum play time in seconds to include */
	minPlayTime: number;
	/** Deduplicate consecutive plays of the same track on the same day */
	dedupe: boolean;
	/** Analyze and show stats without converting */
	preview: boolean;
}

/**
 * Spotify metadata for streaming history
 */
interface SpotifyStreamingMetadata {
	artist: string;
	track: string;
	play_count: number;
	total_ms_played: number;
	dates: string[];
}

/**
 * Spotify metadata for playlists
 */
interface SpotifyPlaylistMetadata {
	playlist_name: string;
	track_count: number;
	last_modified: string;
	description?: string;
}

/**
 * Spotify metadata for library
 */
interface SpotifyLibraryMetadata {
	track_count: number;
}

/**
 * Format milliseconds to human-readable duration
 */
function formatDuration(ms: number): string {
	const totalSeconds = Math.floor(ms / 1000);
	const hours = Math.floor(totalSeconds / 3600);
	const minutes = Math.floor((totalSeconds % 3600) / 60);
	const seconds = totalSeconds % 60;

	if (hours > 0) {
		return `${hours}h ${minutes}m ${seconds}s`;
	}
	if (minutes > 0) {
		return `${minutes}m ${seconds}s`;
	}
	return `${seconds}s`;
}

/**
 * Find Spotify data files in a directory
 */
function findSpotifyFiles(dir: string): {
	streamingHistory: string[];
	playlists: string[];
	library: string | null;
} {
	const files = readdirSync(dir);

	return {
		streamingHistory: files
			.filter((f) => f.startsWith('StreamingHistory') && f.endsWith('.json'))
			.map((f) => join(dir, f))
			.sort(),
		playlists: files
			.filter((f) => f.startsWith('Playlist') && f.endsWith('.json'))
			.map((f) => join(dir, f))
			.sort(),
		library: files.includes('YourLibrary.json') ? join(dir, 'YourLibrary.json') : null,
	};
}

/**
 * Parse streaming history entries with deduplication
 */
function parseStreamingHistory(
	files: string[],
	options: SpotifyOptions,
): Map<string, { entries: StreamingEntry[]; totalMs: number }> {
	const minMs = options.minPlayTime * 1000;
	const trackMap = new Map<string, { entries: StreamingEntry[]; totalMs: number }>();
	// For dedupe: track which date+track combos we've seen
	const seenDayPlays = new Set<string>();

	for (const file of files) {
		const content = readFileSync(file, 'utf-8');
		const entries: StreamingEntry[] = JSON.parse(content);

		for (const entry of entries) {
			// Filter by minimum play time
			if (entry.msPlayed < minMs) {
				continue;
			}

			const trackKey = `${entry.artistName}|||${entry.trackName}`;

			// Dedupe: skip if we've already seen this track on this day
			if (options.dedupe) {
				const dateKey = entry.endTime.split(' ')[0]; // "YYYY-MM-DD"
				const dayPlayKey = `${trackKey}|||${dateKey}`;
				if (seenDayPlays.has(dayPlayKey)) {
					// Still add to totalMs but don't add another entry
					const existing = trackMap.get(trackKey);
					if (existing) {
						existing.totalMs += entry.msPlayed;
					}
					continue;
				}
				seenDayPlays.add(dayPlayKey);
			}

			const existing = trackMap.get(trackKey);

			if (existing) {
				existing.entries.push(entry);
				existing.totalMs += entry.msPlayed;
			} else {
				trackMap.set(trackKey, {
					entries: [entry],
					totalMs: entry.msPlayed,
				});
			}
		}
	}

	return trackMap;
}

/**
 * Convert streaming history to markdown files
 */
async function convertStreamingHistory(
	dir: string,
	files: string[],
	outputDir: string,
	options: SpotifyOptions,
	progress: ProgressReporter,
): Promise<{ success: number; errors: number }> {
	const trackMap = parseStreamingHistory(files, options);
	const historyDir = join(outputDir, 'streaming-history');

	if (!options.dryRun) {
		mkdirSync(historyDir, { recursive: true });
	}

	let success = 0;
	let errors = 0;

	const tracks = Array.from(trackMap.entries());
	let processed = 0;

	for (const [key, data] of tracks) {
		const [artistName, trackName] = key.split('|||');
		processed++;

		progress.update(processed, `${artistName} - ${trackName}`);

		try {
			// Get date range
			const dates = data.entries.map((e) => e.endTime.split(' ')[0]).sort();
			const oldestDate = dates[0];
			const newestDate = dates[dates.length - 1];

			// Generate content
			const content = [
				`# ${trackName}`,
				'',
				`**Artist:** ${artistName}`,
				`**Play Count:** ${data.entries.length}`,
				`**Total Time:** ${formatDuration(data.totalMs)}`,
				'',
				`First played: ${oldestDate}`,
				`Last played: ${newestDate}`,
				'',
				'## Play History',
				'',
				...data.entries
					.sort((a, b) => a.endTime.localeCompare(b.endTime))
					.map((e) => `- ${e.endTime} (${formatDuration(e.msPlayed)})`),
			].join('\n');

			// Create hash from track details
			const hashInput = `${artistName}|${trackName}`;
			const sourceHash = createHash('sha256').update(hashInput).digest('hex');

			// Parse the first play date
			const firstPlayDate = new Date(oldestDate);

			// Create frontmatter
			const frontmatter = createFrontmatter({
				title: `${trackName} - ${artistName}`,
				sourceType: 'file',
				contentType: 'document' as ContentType,
				sourceFile: basename(dir),
				sourceHash: `sha256:${sourceHash}`,
				createdAt: firstPlayDate,
				tags: ['imported', 'spotify', 'music', 'streaming-history'],
				metadata: {
					artist: artistName,
					track: trackName,
					play_count: data.entries.length,
					total_ms_played: data.totalMs,
					date_range: { oldest: oldestDate, newest: newestDate },
				} as SpotifyStreamingMetadata & { date_range: { oldest: string; newest: string } },
			});

			// Add user tags
			if (options.tags.length > 0) {
				frontmatter.tags = [...new Set([...frontmatter.tags, ...options.tags])];
			}

			// Generate filename
			const slug = slugify(`${artistName}-${trackName}`, 60);
			const filename = `${oldestDate}-${slug}.md`;
			const outputPath = join(historyDir, filename);

			if (!options.dryRun) {
				const output = serializeFrontmatter(frontmatter, content);
				writeFileSync(outputPath, output);
			}

			success++;

			if (options.verbose) {
				progress.log(`  ✓ ${artistName} - ${trackName}`);
			}
		} catch (error) {
			errors++;
			progress.log(
				`  ✗ ${artistName} - ${trackName}: ${error instanceof Error ? error.message : String(error)}`,
			);
		}
	}

	return { success, errors };
}

/**
 * Convert playlists to markdown files
 */
async function convertPlaylists(
	dir: string,
	files: string[],
	outputDir: string,
	options: SpotifyOptions,
	progress: ProgressReporter,
): Promise<{ success: number; errors: number }> {
	const playlistDir = join(outputDir, 'playlists');

	if (!options.dryRun) {
		mkdirSync(playlistDir, { recursive: true });
	}

	let success = 0;
	let errors = 0;
	let processed = 0;

	for (const file of files) {
		const content = readFileSync(file, 'utf-8');
		const data: { playlists: SpotifyPlaylist[] } = JSON.parse(content);

		for (const playlist of data.playlists) {
			processed++;
			progress.update(processed, playlist.name);

			try {
				const tracks = playlist.items
					.filter((item) => item.track !== null)
					.map((item) => item.track!);

				// Generate content
				const contentLines = [
					`# ${playlist.name}`,
					'',
					`**Track Count:** ${tracks.length}`,
					`**Last Modified:** ${playlist.lastModifiedDate}`,
				];

				if (playlist.description) {
					contentLines.push('', `> ${playlist.description}`);
				}

				contentLines.push('', '## Tracks', '');

				for (let i = 0; i < tracks.length; i++) {
					const track = tracks[i];
					contentLines.push(
						`${i + 1}. **${track.trackName}** - ${track.artistName} (*${track.albumName}*)`,
					);
				}

				const markdownContent = contentLines.join('\n');

				// Create hash
				const hashInput = `playlist:${playlist.name}:${playlist.lastModifiedDate}`;
				const sourceHash = createHash('sha256').update(hashInput).digest('hex');

				// Parse date
				const modifiedDate = new Date(playlist.lastModifiedDate);

				// Create frontmatter
				const frontmatter = createFrontmatter({
					title: playlist.name,
					sourceType: 'file',
					contentType: 'document' as ContentType,
					sourceFile: basename(dir),
					sourceHash: `sha256:${sourceHash}`,
					createdAt: modifiedDate,
					tags: ['imported', 'spotify', 'music', 'playlist'],
					metadata: {
						playlist_name: playlist.name,
						track_count: tracks.length,
						last_modified: playlist.lastModifiedDate,
						description: playlist.description || undefined,
					} as SpotifyPlaylistMetadata,
				});

				// Add user tags
				if (options.tags.length > 0) {
					frontmatter.tags = [...new Set([...frontmatter.tags, ...options.tags])];
				}

				// Generate filename
				const slug = slugify(playlist.name, 60);
				const filename = `${playlist.lastModifiedDate}-${slug}.md`;
				const outputPath = join(playlistDir, filename);

				if (!options.dryRun) {
					const output = serializeFrontmatter(frontmatter, markdownContent);
					writeFileSync(outputPath, output);
				}

				success++;

				if (options.verbose) {
					progress.log(`  ✓ Playlist: ${playlist.name}`);
				}
			} catch (error) {
				errors++;
				progress.log(
					`  ✗ Playlist: ${playlist.name}: ${error instanceof Error ? error.message : String(error)}`,
				);
			}
		}
	}

	return { success, errors };
}

/**
 * Convert library to a single markdown file
 */
async function convertLibrary(
	dir: string,
	libraryFile: string,
	outputDir: string,
	options: SpotifyOptions,
	progress: ProgressReporter,
): Promise<{ success: number; errors: number }> {
	progress.update(1, 'Library');

	try {
		const content = readFileSync(libraryFile, 'utf-8');
		const data: { tracks: LibraryTrack[] } = JSON.parse(content);
		const tracks = data.tracks || [];

		// Generate content
		const contentLines = [
			'# Spotify Library',
			'',
			`**Saved Tracks:** ${tracks.length}`,
			'',
			'## Tracks',
			'',
		];

		// Group by artist
		const byArtist = new Map<string, LibraryTrack[]>();
		for (const track of tracks) {
			const existing = byArtist.get(track.artist) || [];
			existing.push(track);
			byArtist.set(track.artist, existing);
		}

		// Sort artists alphabetically
		const sortedArtists = Array.from(byArtist.keys()).sort((a, b) =>
			a.toLowerCase().localeCompare(b.toLowerCase()),
		);

		for (const artist of sortedArtists) {
			const artistTracks = byArtist.get(artist)!;
			contentLines.push(`### ${artist}`);
			contentLines.push('');
			for (const track of artistTracks) {
				contentLines.push(`- **${track.track}** (*${track.album}*)`);
			}
			contentLines.push('');
		}

		const markdownContent = contentLines.join('\n');

		// Create hash
		const hashInput = `library:${tracks.length}:${tracks.map((t) => t.uri).join(',')}`;
		const sourceHash = createHash('sha256').update(hashInput).digest('hex');

		// Create frontmatter
		const frontmatter = createFrontmatter({
			title: 'Spotify Library',
			sourceType: 'file',
			contentType: 'document' as ContentType,
			sourceFile: basename(dir),
			sourceHash: `sha256:${sourceHash}`,
			createdAt: new Date(),
			tags: ['imported', 'spotify', 'music', 'library'],
			metadata: {
				track_count: tracks.length,
			} as SpotifyLibraryMetadata,
		});

		// Add user tags
		if (options.tags.length > 0) {
			frontmatter.tags = [...new Set([...frontmatter.tags, ...options.tags])];
		}

		// Write file
		const outputPath = join(outputDir, 'spotify-library.md');

		if (!options.dryRun) {
			mkdirSync(outputDir, { recursive: true });
			const output = serializeFrontmatter(frontmatter, markdownContent);
			writeFileSync(outputPath, output);
		}

		if (options.verbose) {
			progress.log(`  ✓ Library: ${tracks.length} tracks`);
		}

		return { success: 1, errors: 0 };
	} catch (error) {
		progress.log(`  ✗ Library: ${error instanceof Error ? error.message : String(error)}`);
		return { success: 0, errors: 1 };
	}
}

/**
 * Main conversion function
 */
async function convertSpotify(inputPath: string, options: SpotifyOptions): Promise<void> {
	const resolvedInput = resolve(inputPath);

	// Check if input exists
	if (!existsSync(resolvedInput)) {
		logger.error(`Input not found: ${resolvedInput}`);
		process.exit(1);
	}

	const stats = statSync(resolvedInput);
	if (!stats.isDirectory()) {
		logger.error('Input must be a Spotify data export directory');
		process.exit(1);
	}

	// Handle preview mode
	if (options.preview) {
		const analysis = await analyzeSpotify(resolvedInput);

		logger.info('');
		logger.info('  Spotify Data Export Analysis');
		logger.info(`  ${'─'.repeat(40)}`);
		logger.info(`  File: ${analysis.filename}`);
		logger.info(`  Size: ${(analysis.fileSizeBytes / 1024 / 1024).toFixed(1)} MB`);
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

		if (analysis.samples && analysis.samples.length > 0) {
			logger.info('');
			logger.info('  Sample Tracks:');
			for (const sample of analysis.samples.slice(0, 5)) {
				logger.info(`    - ${sample}`);
			}
		}

		logger.info('');
		return;
	}

	// Find Spotify data files
	const files = findSpotifyFiles(resolvedInput);
	const outputDir = resolve(options.output);

	// Count total items for progress
	let totalItems = 0;
	if (options.history && files.streamingHistory.length > 0) {
		// Count unique tracks (will be calculated during processing)
		totalItems += 100; // Placeholder
	}
	if (options.playlists && files.playlists.length > 0) {
		for (const file of files.playlists) {
			const content = readFileSync(file, 'utf-8');
			const data: { playlists: SpotifyPlaylist[] } = JSON.parse(content);
			totalItems += data.playlists.length;
		}
	}
	if (options.library && files.library) {
		totalItems += 1;
	}

	if (totalItems === 0) {
		logger.error(
			'No Spotify data files found. Expected StreamingHistory*.json, Playlist*.json, or YourLibrary.json',
		);
		process.exit(1);
	}

	logger.info(`Found Spotify data in: ${resolvedInput}`);

	// Create output directory
	if (!options.dryRun) {
		mkdirSync(outputDir, { recursive: true });
	}

	let totalSuccess = 0;
	let totalErrors = 0;

	// Convert streaming history
	if (options.history && files.streamingHistory.length > 0) {
		logger.info(`\nProcessing streaming history (${files.streamingHistory.length} file(s))...`);

		const trackMap = parseStreamingHistory(files.streamingHistory, options);
		const progress = new ProgressReporter(trackMap.size, { verbose: options.verbose });
		progress.start();

		const result = await convertStreamingHistory(
			resolvedInput,
			files.streamingHistory,
			outputDir,
			options,
			progress,
		);

		progress.finish(`Streaming history: ${result.success} tracks, ${result.errors} errors`);
		totalSuccess += result.success;
		totalErrors += result.errors;
	}

	// Convert playlists
	if (options.playlists && files.playlists.length > 0) {
		let playlistCount = 0;
		for (const file of files.playlists) {
			const content = readFileSync(file, 'utf-8');
			const data: { playlists: SpotifyPlaylist[] } = JSON.parse(content);
			playlistCount += data.playlists.length;
		}

		logger.info(`\nProcessing playlists (${playlistCount} playlist(s))...`);

		const progress = new ProgressReporter(playlistCount, { verbose: options.verbose });
		progress.start();

		const result = await convertPlaylists(
			resolvedInput,
			files.playlists,
			outputDir,
			options,
			progress,
		);

		progress.finish(`Playlists: ${result.success} converted, ${result.errors} errors`);
		totalSuccess += result.success;
		totalErrors += result.errors;
	}

	// Convert library
	if (options.library && files.library) {
		logger.info('\nProcessing library...');

		const progress = new ProgressReporter(1, { verbose: options.verbose });
		progress.start();

		const result = await convertLibrary(resolvedInput, files.library, outputDir, options, progress);

		progress.finish(`Library: ${result.success} converted, ${result.errors} errors`);
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
	'convert-spotify',
	'Convert Spotify data export to Markdown with YAML front matter',
);

program
	.option('--history', 'Include streaming history', true)
	.option('--no-history', 'Exclude streaming history')
	.option('--playlists', 'Include playlists', true)
	.option('--no-playlists', 'Exclude playlists')
	.option('--library', 'Include library (saved tracks)', true)
	.option('--no-library', 'Exclude library')
	.option('--min-play-time <seconds>', 'Minimum play time in seconds to include', parseInt, 30)
	.option('--dedupe', 'Deduplicate same-day plays of the same track', true)
	.option('--preview', 'Analyze and show stats without converting', false)
	.argument('<path>', 'Spotify data export directory (containing StreamingHistory*.json)')
	.action(async (path: string, opts: SpotifyOptions) => {
		await convertSpotify(path, opts);
	});

program.parse();

export { convertSpotify };
