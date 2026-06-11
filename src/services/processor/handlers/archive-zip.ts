/**
 * Safe ZIP extraction (plan §9, T5.3).
 *
 * {@link validateZip} reads the archive's central directory via
 * `unzipper.Open.buffer` and enforces every §9 safety rule **before** any entry
 * is decompressed: archive-level limits (entry count, compressed/expanded size,
 * compression ratio, per-entry size) and per-entry path safety (traversal,
 * absolute/drive paths, backslashes, symlinks, over-long names) and nested
 * archives all throw a stable `ZIP_*` error — these fail the whole upload before
 * a single document is created. OS junk is silently skipped; entries with an
 * unsupported extension are reported as `skipped`; supported entries come back
 * as {@link ZipCandidate}s whose bytes are decompressed lazily, one at a time,
 * so memory stays bounded to a single entry (≤ `ZIP_MAX_ENTRY_BYTES`).
 */
import { Open } from 'unzipper';
import { config } from '../../../utils/config.js';
import {
	ZipBombError,
	ZipEntryTooLargeError,
	ZipNestedArchiveError,
	ZipPathTraversalError,
	ZipTooManyEntriesError,
} from '../../../utils/errors.js';
import { resolveByExtension } from '../registry.js';

/** A supported, path-safe entry whose bytes are decompressed on demand. */
export interface ZipCandidate {
	entryPath: string;
	/** Resolved handler key (registry `FileHandler.key`), e.g. `'pdf'`. */
	normalizedType: string;
	/** Uncompressed size in bytes (from the central directory). */
	sizeBytes: number;
	/** Decompress this entry's bytes. */
	read(): Promise<Buffer>;
}

/** A non-junk entry that resolved to no supported handler. */
export interface ZipSkippedEntry {
	entryPath: string;
	sizeBytes: number | null;
	errorCode: 'UNSUPPORTED_ENTRY';
	reason: string;
}

export interface ZipValidationResult {
	candidates: ZipCandidate[];
	skipped: ZipSkippedEntry[];
}

// Unix mode bits (from externalFileAttributes >>> 16).
const S_IFMT = 0o170000;
const S_IFREG = 0o100000;

// Extensions treated as nested archives (rejected in MVP).
const NESTED_ARCHIVE_EXTENSIONS = new Set(['zip', 'tar', 'gz', 'tgz', 'bz2', '7z', 'rar', 'xz']);

/** macOS/Windows junk that should be silently ignored, not reported. */
function isOsJunk(path: string): boolean {
	if (path.startsWith('__MACOSX/')) return true;
	const base = path.split('/').pop() ?? path;
	return base === '.DS_Store' || base === 'Thumbs.db';
}

/** Lower-case extension (no dot) of a path's final segment, or '' if none. */
function extensionOf(path: string): string {
	const base = path.split('/').pop() ?? path;
	const dot = base.lastIndexOf('.');
	if (dot <= 0 || dot === base.length - 1) return '';
	return base.slice(dot + 1).toLowerCase();
}

/** Reject `../`, absolute paths, Windows drive prefixes, and backslash separators. */
function isUnsafePath(path: string): boolean {
	if (path.includes('\\')) return true; // backslash separator / drive path
	if (path.startsWith('/')) return true; // absolute
	if (/^[a-zA-Z]:/.test(path)) return true; // windows drive (C:...)
	return path.split('/').some((seg) => seg === '..');
}

/** True when the entry's Unix mode marks it as something other than a regular file (e.g. a symlink). */
function isNonRegular(externalFileAttributes: number): boolean {
	const mode = (externalFileAttributes >>> 16) & S_IFMT;
	if (mode === 0) return false; // no Unix attrs recorded → treat as regular
	return mode !== S_IFREG;
}

function compressedLimit(): number {
	return config.ZIP_MAX_COMPRESSED_BYTES ?? config.MAX_UPLOAD_SIZE_MB * 1024 * 1024;
}

/**
 * Validate an in-memory ZIP and collect its supported entries. Throws a `ZIP_*`
 * error for any archive-level violation (the caller fails the whole upload with
 * no documents); otherwise returns candidates + skipped entries.
 */
export async function validateZip(buffer: Buffer): Promise<ZipValidationResult> {
	const directory = await Open.buffer(buffer);
	const files = directory.files.filter((f) => f.type === 'File');

	// --- Archive-level aggregate limits (before any decompression) ---
	if (files.length > config.ZIP_MAX_ENTRIES) {
		throw new ZipTooManyEntriesError(
			`Archive has ${files.length} entries (max ${config.ZIP_MAX_ENTRIES})`,
		);
	}

	let totalCompressed = 0;
	let totalExpanded = 0;
	for (const f of files) {
		totalCompressed += f.compressedSize;
		totalExpanded += f.uncompressedSize;
	}
	if (totalCompressed > compressedLimit()) {
		throw new ZipBombError(
			`Compressed archive size ${totalCompressed} exceeds the limit of ${compressedLimit()} bytes`,
		);
	}
	if (totalExpanded > config.ZIP_MAX_EXPANDED_BYTES) {
		throw new ZipBombError(
			`Expanded size ${totalExpanded} exceeds the limit of ${config.ZIP_MAX_EXPANDED_BYTES} bytes`,
		);
	}
	const ratio = totalExpanded / Math.max(totalCompressed, 1);
	if (ratio > config.ZIP_MAX_COMPRESSION_RATIO) {
		throw new ZipBombError(
			`Compression ratio ${ratio.toFixed(0)} exceeds the limit of ${config.ZIP_MAX_COMPRESSION_RATIO}`,
		);
	}

	// --- Per-entry validation + collection ---
	const candidates: ZipCandidate[] = [];
	const skipped: ZipSkippedEntry[] = [];

	for (const f of files) {
		const path = f.path;

		// Path safety is enforced before the OS-junk filter so a hostile entry
		// hiding behind a junk basename (e.g. `../../Thumbs.db`) still fails the
		// archive rather than being silently skipped.
		if (isUnsafePath(path)) {
			throw new ZipPathTraversalError(`Unsafe entry path: ${path}`);
		}
		if (path.length > config.ZIP_MAX_FILENAME_LEN) {
			throw new ZipPathTraversalError(
				`Entry path length ${path.length} exceeds the limit of ${config.ZIP_MAX_FILENAME_LEN}`,
			);
		}
		if (isNonRegular(f.externalFileAttributes)) {
			throw new ZipPathTraversalError(`Entry is not a regular file (symlink/device): ${path}`);
		}

		if (isOsJunk(path)) continue;

		if (NESTED_ARCHIVE_EXTENSIONS.has(extensionOf(path))) {
			throw new ZipNestedArchiveError(`Nested archive not supported: ${path}`);
		}
		if (f.uncompressedSize > config.ZIP_MAX_ENTRY_BYTES) {
			throw new ZipEntryTooLargeError(
				`Entry ${path} is ${f.uncompressedSize} bytes (max ${config.ZIP_MAX_ENTRY_BYTES})`,
			);
		}

		const handler = resolveByExtension(path);
		if (!handler) {
			skipped.push({
				entryPath: path,
				sizeBytes: f.uncompressedSize,
				errorCode: 'UNSUPPORTED_ENTRY',
				reason: 'No handler for this file type',
			});
			continue;
		}

		candidates.push({
			entryPath: path,
			normalizedType: handler.key,
			sizeBytes: f.uncompressedSize,
			read: () => f.buffer(),
		});
	}

	return { candidates, skipped };
}
