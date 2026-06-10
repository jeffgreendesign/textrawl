import type { FileHandler } from '../types.js';

/** Plain text and Markdown — decoded as UTF-8 verbatim. No magic signature. */
export const textHandler: FileHandler = {
	key: 'text',
	extensions: ['txt', 'md'],
	mimeTypes: ['text/plain', 'text/markdown'],
	async extract(buffer: Buffer): Promise<string> {
		return buffer.toString('utf-8');
	},
};
