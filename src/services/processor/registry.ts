/**
 * File-handler registry (plan §8, T5.1).
 *
 * Resolves a {@link FileHandler} for a declared MIME (`resolveByMime`), a
 * filename/extension (`resolveByExtension`), or an extension *and* a content
 * magic-sniff (`resolveForEntry`, used per ZIP entry). The legacy `processor.ts`
 * magic check (`validateFileType`) folds in here as {@link validateMimeContent}.
 * Built-in handlers register on module load.
 */
import { fileTypeFromBuffer } from 'file-type';
import { ValidationError } from '../../utils/errors.js';
import { builtinHandlers } from './handlers/index.js';
import type { FileHandler } from './types.js';

const byMime = new Map<string, FileHandler>();
const byExtension = new Map<string, FileHandler>();

/** Register a handler under each of its MIME types and extensions (last write wins). */
export function register(handler: FileHandler): void {
	for (const mime of handler.mimeTypes) {
		byMime.set(mime.toLowerCase(), handler);
	}
	for (const ext of handler.extensions) {
		byExtension.set(ext.toLowerCase(), handler);
	}
}

for (const handler of builtinHandlers) {
	register(handler);
}

/** Lower-case extension (no dot) of a filename or path segment, or '' if none. */
function extensionOf(name: string): string {
	const base = name.split(/[/\\]/).pop() ?? name;
	const dot = base.lastIndexOf('.');
	if (dot <= 0 || dot === base.length - 1) {
		return '';
	}
	return base.slice(dot + 1).toLowerCase();
}

export function resolveByMime(mime: string): FileHandler | undefined {
	return byMime.get(mime.toLowerCase());
}

export function resolveByExtension(name: string): FileHandler | undefined {
	const ext = extensionOf(name);
	return ext ? byExtension.get(ext) : undefined;
}

export function isSupportedMime(mime: string): boolean {
	return byMime.has(mime.toLowerCase());
}

export function supportedExtensions(): string[] {
	return [...byExtension.keys()];
}

/**
 * Does `buffer`'s content match `handler`? Binary handlers (those declaring
 * `magicMimes`) must sniff to a known magic MIME; text-bearing handlers pass
 * when no conflicting binary signature is detected. Mirrors the legacy
 * `validateFileType` rule, generalised across the registry.
 */
async function contentMatchesHandler(
	handler: FileHandler,
	buffer: Buffer,
	declaredMime?: string,
): Promise<boolean> {
	const detected = await fileTypeFromBuffer(buffer);
	if (!detected) {
		// No binary magic. Accept text-bearing handlers (no `magicMimes`), or any
		// declared `text/*` type — text files legitimately have no signature.
		return !handler.magicMimes?.length || (declaredMime?.startsWith('text/') ?? false);
	}
	const expected = handler.magicMimes ?? handler.mimeTypes;
	return expected.includes(detected.mime);
}

/**
 * Validate that `buffer` content is consistent with the declared `mime` (magic
 * sniff). Returns false for an unsupported MIME. This is the registry-backed
 * replacement for the old `processor.validateFileType`.
 */
export async function validateMimeContent(buffer: Buffer, mime: string): Promise<boolean> {
	const handler = resolveByMime(mime);
	if (!handler) {
		return false;
	}
	return contentMatchesHandler(handler, buffer, mime);
}

/**
 * Extract text for a declared `mime`.
 *
 * @throws {ValidationError} If no handler claims the MIME type.
 */
export async function extractByMime(buffer: Buffer, mime: string): Promise<string> {
	const handler = resolveByMime(mime);
	if (!handler) {
		const supported = supportedExtensions()
			.map((e) => e.toUpperCase())
			.join(', ');
		throw new ValidationError(`Unsupported file type: ${mime}. Supported: ${supported}`);
	}
	return handler.extract(buffer);
}

/**
 * Resolve a ZIP entry by extension **and** content magic-sniff. Returns the
 * handler only when the extension is supported and the bytes are consistent with
 * it (so an `.exe` renamed to `.pdf` is rejected). Returns undefined otherwise.
 */
export async function resolveForEntry(
	name: string,
	buffer: Buffer,
): Promise<FileHandler | undefined> {
	const handler = resolveByExtension(name);
	if (!handler) {
		return undefined;
	}
	return (await contentMatchesHandler(handler, buffer)) ? handler : undefined;
}
