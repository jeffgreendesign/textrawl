import type { FileHandler } from '../types.js';

/**
 * JSON — the raw UTF-8 text, as-is. No magic signature.
 *
 * We deliberately do NOT `JSON.stringify(JSON.parse(text), null, 2)`: re-indenting
 * inflates dense exports 2–5× (a minified or already-pretty 5MB Spotify export
 * balloons transient heap and the chunk/embedding/row count downstream) and
 * destroys the original byte offsets the chunker records. Passing the bytes
 * through keeps memory ≈ 1× input and offsets faithful.
 */
export const jsonHandler: FileHandler = {
	key: 'json',
	extensions: ['json'],
	mimeTypes: ['application/json'],
	async extract(buffer: Buffer): Promise<string> {
		return buffer.toString('utf-8');
	},
};
