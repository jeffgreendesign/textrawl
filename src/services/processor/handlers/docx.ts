import mammoth from 'mammoth';
import type { FileHandler } from '../types.js';

const DOCX_MIME = 'application/vnd.openxmlformats-officedocument.wordprocessingml.document';

/** Word `.docx` documents — raw text extracted via `mammoth`. */
export const docxHandler: FileHandler = {
	key: 'docx',
	extensions: ['docx'],
	mimeTypes: [DOCX_MIME],
	magicMimes: [DOCX_MIME],
	async extract(buffer: Buffer): Promise<string> {
		const result = await mammoth.extractRawText({ buffer });
		return result.value;
	},
};
