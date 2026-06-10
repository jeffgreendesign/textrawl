import type { FileHandler } from '../types.js';

/** CSV — already plain text; decoded as UTF-8 verbatim (lossless). No magic signature. */
export const csvHandler: FileHandler = {
	key: 'csv',
	extensions: ['csv'],
	mimeTypes: ['text/csv'],
	async extract(buffer: Buffer): Promise<string> {
		return buffer.toString('utf-8');
	},
};
