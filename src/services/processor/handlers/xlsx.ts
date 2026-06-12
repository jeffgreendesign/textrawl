import * as XLSX from 'xlsx';
import type { FileHandler } from '../types.js';

const XLSX_MIME = 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet';

// Cap on total cells materialized into CSV across all sheets. `sheet_to_csv`
// allocates a string per cell, so a huge sheet could spike heap. We render only
// up to this many cells, capping each sheet's row range to the remaining budget.
const MAX_XLSX_CELLS = 2_000_000;

// Cap on rows PARSED per sheet. `XLSX.read` materializes the whole workbook in
// memory before any of our budget logic runs — an adversarial 20MB xlsx can
// expand to multiple GB of cell objects on parse alone. `sheetRows` bounds the
// dominant (row) dimension at read time so the parse itself stays bounded.
const MAX_XLSX_ROWS = 100_000;

/**
 * Excel `.xlsx` workbooks — each sheet rendered to CSV text under a `# <sheet>`
 * heading so multi-sheet workbooks stay legible after chunking. Materialization
 * is bounded by {@link MAX_XLSX_CELLS} so a huge workbook cannot OOM the worker.
 */
export const xlsxHandler: FileHandler = {
	key: 'xlsx',
	extensions: ['xlsx'],
	mimeTypes: [XLSX_MIME],
	magicMimes: [XLSX_MIME],
	async extract(buffer: Buffer): Promise<string> {
		// `sheetRows` bounds rows parsed per sheet at read time (see MAX_XLSX_ROWS).
		const workbook = XLSX.read(buffer, { type: 'buffer', sheetRows: MAX_XLSX_ROWS });
		const parts: string[] = [];
		let budget = MAX_XLSX_CELLS;
		let truncated = false;

		for (const name of workbook.SheetNames) {
			if (budget <= 0) {
				truncated = true;
				break;
			}
			const sheet = workbook.Sheets[name];
			const ref = sheet?.['!ref'];
			if (!ref) {
				parts.push(`# ${name}\n`);
				continue;
			}

			const range = XLSX.utils.decode_range(ref);
			const cols = range.e.c - range.s.c + 1;
			const rows = range.e.r - range.s.r + 1;
			const cells = cols * rows;
			// `sheetRows` truncates parse to MAX_XLSX_ROWS; flag it so callers know
			// the spreadsheet was clipped.
			if (rows >= MAX_XLSX_ROWS) {
				truncated = true;
			}

			let csv: string;
			if (cells > budget) {
				// Render only as many full rows as the remaining budget allows by
				// narrowing the sheet's declared range (`sheet_to_csv` honors `!ref`),
				// so cells beyond the budget are never materialized.
				const allowedRows = Math.floor(budget / Math.max(cols, 1));
				if (allowedRows <= 0) {
					// Remaining budget can't cover even one full row — stop without
					// rendering it (a forced row would overshoot MAX_XLSX_CELLS).
					truncated = true;
					budget = 0;
					break;
				}
				const capped = {
					s: range.s,
					e: { c: range.e.c, r: range.s.r + allowedRows - 1 },
				};
				const cappedSheet = { ...sheet, '!ref': XLSX.utils.encode_range(capped) };
				csv = XLSX.utils.sheet_to_csv(cappedSheet);
				budget = 0;
				truncated = true;
			} else {
				csv = XLSX.utils.sheet_to_csv(sheet);
				budget -= cells;
			}
			parts.push(`# ${name}\n${csv}`);
		}

		let out = parts.join('\n\n').trim();
		if (truncated) {
			out += `\n\n[Spreadsheet truncated: exceeded ${MAX_XLSX_CELLS}-cell extraction budget]`;
		}
		return out;
	},
};
