import pdf from 'pdf-parse';
import type { FileHandler } from '../types.js';

/** PDF documents — text extracted via `pdf-parse`. */
export const pdfHandler: FileHandler = {
	key: 'pdf',
	extensions: ['pdf'],
	mimeTypes: ['application/pdf'],
	magicMimes: ['application/pdf'],
	async extract(buffer: Buffer): Promise<string> {
		const data = await pdf(buffer);
		return data.text;
	},
};
