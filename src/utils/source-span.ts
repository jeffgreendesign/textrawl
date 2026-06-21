/**
 * Source-span resolver — the provenance invariant for source-backed claim packets.
 *
 * A claim is only trustworthy if its supporting quote can be located verbatim in the
 * source it cites. This module verifies a quote against a source string and resolves the
 * exact character span it occupies, so a future extraction path can reject any claim whose
 * quote is not actually present *before* it is ever stored.
 *
 * IMPORTANT: resolve a claim's quote against the anchoring **`chunks.content`**, not
 * `documents.raw_content`. The chunker normalizes (`\r\n` → `\n`) and trims text before
 * computing chunk offsets (see `src/services/chunker.ts`), so `raw_content` offsets do not
 * round-trip against the stored chunk text. `chunks.content` is the byte-stable anchor.
 *
 * Offsets are UTF-16 code-unit indices (standard JavaScript `String` indexing), consistent
 * with how the chunker computes `startOffset`/`endOffset`. For every successful resolution
 * `sourceText.slice(span.startOffset, span.endOffset) === span.quote`.
 *
 * Pure module: no DB, no network, no LLM, no provider SDK. Imports only `ValidationError`.
 */

import { ValidationError } from './errors.js';

/** A verified span: offsets are UTF-16 indices into the source text it was resolved against. */
export interface SourceSpan {
	/** Inclusive start index into `sourceText`. */
	startOffset: number;
	/** Exclusive end index into `sourceText`. */
	endOffset: number;
	/** The exact slice `sourceText.slice(startOffset, endOffset)`. */
	quote: string;
	/** 'exact' when the quote matched verbatim; 'normalized' when matched after whitespace folding. */
	matchKind: 'exact' | 'normalized';
}

export interface ResolveSpanOptions {
	/**
	 * Allow matching when only inter-token whitespace differs between the quote and the
	 * source (e.g. a `\n` in the source where the quote has a space, or collapsed runs of
	 * whitespace). Defaults to `false` — exact matching is the strict default so a stored
	 * quote is a verbatim slice of its source. When `true`, the returned offsets still map
	 * back to the original `sourceText` and the round-trip guarantee still holds.
	 */
	normalizeWhitespace?: boolean;
}

export type SpanResolution =
	| { matched: true; span: SourceSpan }
	| { matched: false; reason: 'empty_quote' | 'empty_source' | 'not_found' };

/**
 * Per-normalized-character mapping back to the original source string. `chars` is the
 * whitespace-folded source; for normalized index `i`, the original span it represents is
 * `[start[i], end[i])`.
 */
interface NormalizedSource {
	chars: string;
	start: number[];
	end: number[];
}

const WHITESPACE = /\s/;

/**
 * Fold runs of whitespace in `text` to a single space, recording for each produced
 * character the original `[start, end)` span it came from. A whitespace run collapses to
 * one space whose span covers the whole run; a non-whitespace char maps to its own index.
 */
function foldWhitespace(text: string): NormalizedSource {
	const chars: string[] = [];
	const start: number[] = [];
	const end: number[] = [];

	let i = 0;
	while (i < text.length) {
		const ch = text[i];
		if (WHITESPACE.test(ch)) {
			const runStart = i;
			while (i < text.length && WHITESPACE.test(text[i])) {
				i++;
			}
			chars.push(' ');
			start.push(runStart);
			end.push(i);
		} else {
			chars.push(ch);
			start.push(i);
			end.push(i + 1);
			i++;
		}
	}

	return { chars: chars.join(''), start, end };
}

/** Collapse runs of whitespace to a single space and trim — the comparison form for a quote. */
function foldQuote(quote: string): string {
	return quote.replace(/\s+/g, ' ').trim();
}

/**
 * Resolve a quote to its exact span within `sourceText`. Pure and never throws.
 *
 * Resolution order:
 *  1. Exact: the trimmed quote is searched for verbatim (case-sensitive). The returned span
 *     covers the trimmed quote, so leading/trailing whitespace a caller included is ignored.
 *  2. Normalized (only when `options.normalizeWhitespace`): if exact fails, match with
 *     inter-token whitespace folded, mapping the result back to true offsets in `sourceText`.
 *
 * Multiple occurrences resolve to the first. Returns `matched:false` with a reason for an
 * empty/whitespace-only quote, an empty source, or a quote that cannot be found.
 */
export function resolveSourceSpan(
	sourceText: string,
	quote: string,
	options: ResolveSpanOptions = {},
): SpanResolution {
	if (sourceText.length === 0) {
		return { matched: false, reason: 'empty_source' };
	}

	const trimmedQuote = quote.trim();
	if (trimmedQuote.length === 0) {
		return { matched: false, reason: 'empty_quote' };
	}

	// 1. Exact (strict, default) path — case-sensitive verbatim match of the trimmed quote.
	const exactIndex = sourceText.indexOf(trimmedQuote);
	if (exactIndex !== -1) {
		const startOffset = exactIndex;
		const endOffset = exactIndex + trimmedQuote.length;
		return {
			matched: true,
			span: {
				startOffset,
				endOffset,
				quote: sourceText.slice(startOffset, endOffset),
				matchKind: 'exact',
			},
		};
	}

	// 2. Normalized path — opt-in. Tolerates inter-token whitespace differences while still
	//    returning offsets into the original source (round-trip preserved).
	if (options.normalizeWhitespace) {
		const foldedQuote = foldQuote(quote);
		if (foldedQuote.length === 0) {
			return { matched: false, reason: 'empty_quote' };
		}

		const source = foldWhitespace(sourceText);
		const normIndex = source.chars.indexOf(foldedQuote);
		if (normIndex !== -1) {
			// foldedQuote is trimmed, so its first/last chars are non-whitespace and map to
			// single original characters — the span excludes surrounding whitespace.
			const startOffset = source.start[normIndex];
			const endOffset = source.end[normIndex + foldedQuote.length - 1];
			return {
				matched: true,
				span: {
					startOffset,
					endOffset,
					quote: sourceText.slice(startOffset, endOffset),
					matchKind: 'normalized',
				},
			};
		}
	}

	return { matched: false, reason: 'not_found' };
}

/**
 * Boolean gate for callers that only need a yes/no support check. Returns `true` only when
 * the quote resolves to a span in `sourceText`.
 */
export function isQuoteSupported(
	sourceText: string,
	quote: string,
	options: ResolveSpanOptions = {},
): boolean {
	return resolveSourceSpan(sourceText, quote, options).matched;
}

/**
 * Enforcement gate: return the resolved {@link SourceSpan} or throw {@link ValidationError}.
 *
 * This is the "reject unsupported claims before storage" invariant expressed as a reusable
 * guard. It performs no storage — a future extraction path calls this and only persists a
 * claim when a span is returned.
 */
export function requireSourceSpan(
	sourceText: string,
	quote: string,
	options: ResolveSpanOptions = {},
): SourceSpan {
	const resolution = resolveSourceSpan(sourceText, quote, options);
	if (!resolution.matched) {
		throw new ValidationError(`Quote is not supported by the source (${resolution.reason}).`);
	}
	return resolution.span;
}
