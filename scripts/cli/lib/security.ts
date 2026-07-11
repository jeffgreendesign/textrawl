/**
 * Security utilities for CLI scripts
 *
 * Provides path validation to prevent path traversal attacks
 */

import { existsSync, realpathSync, statSync } from 'node:fs';
import { homedir, tmpdir } from 'node:os';
import { isAbsolute, normalize, relative, resolve } from 'node:path';

/**
 * Options for path validation
 */
export interface PathValidationOptions {
	/** Allow creating the directory if it doesn't exist (default: true for output dirs) */
	allowCreate?: boolean;
	/** Require path to be an existing directory (default: false) */
	mustExist?: boolean;
	/** Require path to be a directory, not a file (default: false) */
	mustBeDirectory?: boolean;
	/** Additional allowed base directories beyond home/temp/cwd */
	additionalAllowedBases?: string[];
}

/**
 * Get the list of allowed base directories
 * These are directories where output is permitted
 */
function getAllowedBaseDirs(additionalBases?: string[]): string[] {
	const bases = [resolve(homedir()), resolve(tmpdir()), resolve(process.cwd())];

	if (additionalBases) {
		for (const base of additionalBases) {
			const resolved = resolve(base);
			if (existsSync(resolved)) {
				try {
					bases.push(realpathSync(resolved));
				} catch {
					bases.push(resolved);
				}
			}
		}
	}

	return bases.map((p) => normalize(p));
}

/**
 * Check if a path is within any of the allowed base directories
 */
function isPathWithinAllowedBases(targetPath: string, allowedBases: string[]): boolean {
	const normalizedTarget = normalize(targetPath);

	for (const base of allowedBases) {
		// Exact match
		if (normalizedTarget === base) {
			return true;
		}

		// Check if target is a subdirectory of base
		const rel = relative(base, normalizedTarget);
		// Path is within base if:
		// - relative path is not empty
		// - relative path doesn't start with ".."
		// - relative path is not absolute (handles Windows drive letters)
		if (rel !== '' && !rel.startsWith('..') && !isAbsolute(rel)) {
			return true;
		}
	}

	return false;
}

/**
 * Validate and sanitize an output directory path
 *
 * This function prevents path traversal attacks by:
 * 1. Resolving the path to an absolute, normalized form
 * 2. Checking for explicit traversal patterns (.., null bytes)
 * 3. Verifying the path is within an allowed base directory
 * 4. Optionally resolving symlinks to prevent symlink-based escapes
 *
 * @param outputDir - The output directory path to validate
 * @param options - Validation options
 * @returns The validated, resolved absolute path
 * @throws Error if path validation fails
 */
export function validateOutputPath(outputDir: string, options: PathValidationOptions = {}): string {
	// Check for null bytes (can truncate paths in some contexts)
	if (outputDir.includes('\0')) {
		throw new Error('Invalid path: contains null bytes');
	}

	// Resolve to absolute path and normalize
	const resolved = normalize(resolve(process.cwd(), outputDir));

	// Note: ".." is allowed if it resolves to a valid allowed location
	// The check below validates the final resolved path

	// Get allowed base directories
	const allowedBases = getAllowedBaseDirs(options.additionalAllowedBases);

	// Check if resolved path is within any allowed directory
	if (!isPathWithinAllowedBases(resolved, allowedBases)) {
		throw new Error(
			`Output directory must be within home (~), temp, or current working directory. Got: ${outputDir}`,
		);
	}

	// If path must exist, verify it
	if (options.mustExist) {
		if (!existsSync(resolved)) {
			throw new Error(`Path does not exist: ${resolved}`);
		}

		// If we need to verify it's a directory, resolve symlinks first
		if (options.mustBeDirectory) {
			try {
				const realPath = realpathSync(resolved);
				const stat = statSync(realPath);
				if (!stat.isDirectory()) {
					throw new Error(`Path is not a directory: ${resolved}`);
				}

				// Re-verify the real path is still within allowed bases
				// This prevents symlink-based escapes
				if (!isPathWithinAllowedBases(realPath, allowedBases)) {
					throw new Error(`Symlink target is outside allowed directories: ${realPath}`);
				}

				return realPath;
			} catch (error) {
				if (error instanceof Error && error.message.includes('allowed directories')) {
					throw error;
				}
				throw new Error(`Cannot access path: ${resolved}`);
			}
		}
	}

	return resolved;
}

/**
 * Validate an input file path
 *
 * Similar to validateOutputPath but for input files:
 * - Must exist
 * - Must be within allowed directories
 * - Resolves symlinks to prevent escapes
 *
 * @param inputPath - The input file path to validate
 * @param options - Validation options
 * @returns The validated, resolved absolute path
 * @throws Error if path validation fails
 */
export function validateInputPath(inputPath: string, options: PathValidationOptions = {}): string {
	// Check for null bytes
	if (inputPath.includes('\0')) {
		throw new Error('Invalid path: contains null bytes');
	}

	// Resolve to absolute path
	const resolved = normalize(resolve(process.cwd(), inputPath));

	// Input must exist
	if (!existsSync(resolved)) {
		throw new Error(`Input path does not exist: ${resolved}`);
	}

	// Resolve symlinks to get canonical path
	let realPath: string;
	try {
		realPath = realpathSync(resolved);
	} catch {
		throw new Error(`Cannot resolve path: ${resolved}`);
	}

	// Get allowed base directories
	const allowedBases = getAllowedBaseDirs(options.additionalAllowedBases);

	// Verify the real path is within allowed bases
	if (!isPathWithinAllowedBases(realPath, allowedBases)) {
		throw new Error(
			`Input path must be within home (~), temp, or current working directory. Got: ${inputPath}`,
		);
	}

	// Check if it should be a directory
	if (options.mustBeDirectory) {
		const stat = statSync(realPath);
		if (!stat.isDirectory()) {
			throw new Error(`Path is not a directory: ${realPath}`);
		}
	}

	return realPath;
}

/**
 * Sanitize a filename to prevent path traversal
 *
 * Removes directory components and dangerous characters from a filename.
 * Use this when constructing output filenames from user input.
 *
 * @param filename - The filename to sanitize
 * @returns Safe filename with no path components
 */
export function sanitizeFilename(filename: string): string {
	// Get only the base filename (removes any path components)
	let safe = filename.split(/[/\\]/).pop() || filename;

	// Remove path traversal attempts and null bytes
	safe = safe.replace(/\.\./g, '').replace(/\0/g, '');

	// Remove Windows reserved characters
	safe = safe.replace(/[<>:"|?*]/g, '_');

	// Remove leading/trailing dots and spaces (Windows issues)
	safe = safe.replace(/^[\s.]+|[\s.]+$/g, '');

	// Ensure we have a valid filename
	if (!safe || safe === '.' || safe === '..') {
		safe = `file-${Date.now()}`;
	}

	return safe;
}
