import { convert } from 'html-to-text';
import type { FileHandler } from '../types.js';

/**
 * HTML documents — readable text extracted via `html-to-text`. Markup is
 * stripped and `<script>`/`<style>` contents are dropped (not rendered as text).
 * No magic signature (HTML is text-bearing).
 */
export const htmlHandler: FileHandler = {
	key: 'html',
	extensions: ['html', 'htm'],
	mimeTypes: ['text/html'],
	async extract(buffer: Buffer): Promise<string> {
		return convert(buffer.toString('utf-8'), {
			wordwrap: false,
			selectors: [
				// Drop non-content elements entirely rather than rendering their text.
				{ selector: 'script', format: 'skip' },
				{ selector: 'style', format: 'skip' },
				{ selector: 'head', format: 'skip' },
				// Preserve original heading case (default upper-cases h1/h2) — better
				// fidelity for search/embeddings downstream.
				{ selector: 'h1', options: { uppercase: false } },
				{ selector: 'h2', options: { uppercase: false } },
				{ selector: 'h3', options: { uppercase: false } },
				{ selector: 'h4', options: { uppercase: false } },
				{ selector: 'h5', options: { uppercase: false } },
				{ selector: 'h6', options: { uppercase: false } },
			],
		}).trim();
	},
};
