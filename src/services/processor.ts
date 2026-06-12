/**
 * Text-extraction façade (plan §8).
 *
 * Stable public surface for callers (`api/upload.ts`, `api/upload-sessions.ts`,
 * `services/upload-processor.ts`). All resolution and extraction now lives in the
 * file-handler registry (`processor/registry.ts` + `processor/handlers/`); these
 * functions delegate so the registry can grow without touching call sites.
 */
import { extractByMime, isSupportedMime, validateMimeContent } from './processor/registry.js';

/**
 * Validate file content matches the expected MIME type via magic numbers.
 * Text-bearing types (no magic signature) are accepted; unsupported MIME types
 * return false.
 */
export async function validateFileType(buffer: Buffer, expectedMime: string): Promise<boolean> {
	return validateMimeContent(buffer, expectedMime);
}

/**
 * Extract plain text from a buffer for the given MIME type.
 *
 * @throws {ValidationError} If the MIME type has no registered handler.
 */
export async function extractText(buffer: Buffer, mimetype: string): Promise<string> {
	return extractByMime(buffer, mimetype);
}

export function isSupportedType(mimetype: string): boolean {
	return isSupportedMime(mimetype);
}
