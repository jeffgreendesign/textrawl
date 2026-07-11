import { extractText } from 'unpdf';
import type { FileHandler } from '../types.js';

/** PDF documents — text extracted via `unpdf` (maintained, pdfjs-based). */
export const pdfHandler: FileHandler = {
	key: 'pdf',
	extensions: ['pdf'],
	mimeTypes: ['application/pdf'],
	magicMimes: ['application/pdf'],
	async extract(buffer: Buffer): Promise<string> {
		// mergePages: true returns the whole document as one string.
		const { text } = await extractText(new Uint8Array(buffer), { mergePages: true });
		return text;
	},
};
