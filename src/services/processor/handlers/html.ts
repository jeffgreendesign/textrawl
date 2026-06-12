import { convert } from 'html-to-text';
import type { FileHandler } from '../types.js';

// `html-to-text` builds a full DOM tree (~1.5–2× input). Bound the input before
// parsing so a pathologically large document can't spike heap beyond a known
// multiple. Upload size limits already cap this in practice; defensive backstop.
const MAX_HTML_INPUT_CHARS = 20_000_000;

/**
 * Strip tags without recursion. `html-to-text` walks the DOM recursively, so a
 * deeply-nested document (`<div><div>…30k deep…`) overflows the call stack and
 * crashes the worker. This non-recursive fallback yields plain text safely. The
 * character class is anchored and linear — no ReDoS.
 */
function stripTagsLinear(html: string): string {
	return html
		.replace(/<(script|style)\b[^>]*>[\s\S]*?<\/\1>/gi, ' ')
		.replace(/<[^>]+>/g, ' ')
		.replace(/\s+/g, ' ')
		.trim();
}

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
		const raw = buffer.toString('utf-8');
		const html = raw.length > MAX_HTML_INPUT_CHARS ? raw.slice(0, MAX_HTML_INPUT_CHARS) : raw;
		try {
			return convert(html, {
				wordwrap: false,
				limits: {
					// Cap recursion/processing so deeply-nested or huge documents can't
					// run away inside the library itself.
					maxDepth: 2000,
					maxChildNodes: 100_000,
				},
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
		} catch {
			// Deeply-nested markup can overflow html-to-text's recursive walk (a
			// RangeError). Fall back to a linear tag-strip so the entry still
			// ingests instead of crashing the worker.
			return stripTagsLinear(html);
		}
	},
};
