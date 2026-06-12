import type { FileHandler } from '../types.js';

/**
 * JSON — pretty-printed when it parses (stable, readable structure for chunking),
 * else the raw UTF-8 text. No magic signature.
 */
export const jsonHandler: FileHandler = {
	key: 'json',
	extensions: ['json'],
	mimeTypes: ['application/json'],
	async extract(buffer: Buffer): Promise<string> {
		const text = buffer.toString('utf-8');
		try {
			return JSON.stringify(JSON.parse(text), null, 2);
		} catch {
			// Not valid JSON — keep the bytes as text rather than failing the file.
			return text;
		}
	},
};
