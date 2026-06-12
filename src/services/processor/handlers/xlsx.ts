import * as XLSX from 'xlsx';
import type { FileHandler } from '../types.js';

const XLSX_MIME = 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet';

/**
 * Excel `.xlsx` workbooks — each sheet rendered to CSV text under a `# <sheet>`
 * heading so multi-sheet workbooks stay legible after chunking.
 */
export const xlsxHandler: FileHandler = {
	key: 'xlsx',
	extensions: ['xlsx'],
	mimeTypes: [XLSX_MIME],
	magicMimes: [XLSX_MIME],
	async extract(buffer: Buffer): Promise<string> {
		const workbook = XLSX.read(buffer, { type: 'buffer' });
		const parts = workbook.SheetNames.map((name) => {
			const csv = XLSX.utils.sheet_to_csv(workbook.Sheets[name]);
			return `# ${name}\n${csv}`;
		});
		return parts.join('\n\n').trim();
	},
};
