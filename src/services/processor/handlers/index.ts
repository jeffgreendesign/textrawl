import type { FileHandler } from '../types.js';
import { csvHandler } from './csv.js';
import { docxHandler } from './docx.js';
import { htmlHandler } from './html.js';
import { jsonHandler } from './json.js';
import { pdfHandler } from './pdf.js';
import { textHandler } from './text.js';
import { xlsxHandler } from './xlsx.js';

/**
 * Built-in Tier-1 handlers, registered in order by the registry on load. New
 * handlers (archive-zip, Tier-1.5 formats) append here.
 */
export const builtinHandlers: readonly FileHandler[] = [
	textHandler,
	pdfHandler,
	docxHandler,
	csvHandler,
	xlsxHandler,
	jsonHandler,
	htmlHandler,
];
