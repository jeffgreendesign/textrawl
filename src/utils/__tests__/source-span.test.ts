import { describe, expect, it } from 'vitest';
import { ValidationError } from '../errors.js';
import {
	isQuoteSupported,
	requireSourceSpan,
	resolveSourceSpan,
	type SpanResolution,
} from '../source-span.js';

/** Assert a resolution matched and return its span (narrows the discriminated union). */
function expectMatched(resolution: SpanResolution) {
	expect(resolution.matched).toBe(true);
	if (!resolution.matched) {
		throw new Error('expected a matched resolution');
	}
	return resolution.span;
}

describe('resolveSourceSpan', () => {
	describe('exact (default) matching', () => {
		it('resolves an exact single occurrence with correct offsets and round-trips', () => {
			const source = 'The quick brown fox jumps.';
			const span = expectMatched(resolveSourceSpan(source, 'quick brown fox'));

			expect(span.matchKind).toBe('exact');
			expect(span.startOffset).toBe(4);
			expect(span.endOffset).toBe(19);
			expect(span.quote).toBe('quick brown fox');
			expect(source.slice(span.startOffset, span.endOffset)).toBe(span.quote);
		});

		it('trims a submitted quote and matches the verbatim core', () => {
			const source = 'alpha beta gamma';
			const span = expectMatched(resolveSourceSpan(source, '  beta '));

			expect(span.matchKind).toBe('exact');
			expect(span.quote).toBe('beta');
			expect(span.startOffset).toBe(6);
			expect(span.endOffset).toBe(10);
			expect(source.slice(span.startOffset, span.endOffset)).toBe('beta');
		});

		it('returns the first occurrence when the quote appears multiple times', () => {
			const source = 'cat dog cat dog cat';
			const span = expectMatched(resolveSourceSpan(source, 'cat'));

			expect(span.startOffset).toBe(0);
			expect(span.endOffset).toBe(3);
			expect(source.slice(span.startOffset, span.endOffset)).toBe('cat');
		});

		it('does not perform whitespace-normalized matching by default', () => {
			const source = 'alpha\nbeta   gamma';
			const resolution = resolveSourceSpan(source, 'alpha beta gamma');

			expect(resolution.matched).toBe(false);
			if (!resolution.matched) {
				expect(resolution.reason).toBe('not_found');
			}
		});
	});

	describe('normalized matching (opt-in)', () => {
		it('matches across inter-token whitespace differences and maps offsets back to the source', () => {
			const source = 'alpha\nbeta   gamma';
			const span = expectMatched(
				resolveSourceSpan(source, 'alpha beta gamma', { normalizeWhitespace: true }),
			);

			expect(span.matchKind).toBe('normalized');
			// Span covers the original (un-normalized) text, excluding no interior content.
			expect(span.startOffset).toBe(0);
			expect(span.endOffset).toBe(source.length);
			expect(span.quote).toBe('alpha\nbeta   gamma');
			// Round-trip guarantee holds for normalized matches too.
			expect(source.slice(span.startOffset, span.endOffset)).toBe(span.quote);
		});

		it('excludes surrounding whitespace from the resolved span', () => {
			const source = 'intro:\n\n  alpha\tbeta  \n\nrest';
			const span = expectMatched(
				resolveSourceSpan(source, 'alpha beta', { normalizeWhitespace: true }),
			);

			expect(span.matchKind).toBe('normalized');
			expect(span.quote).toBe('alpha\tbeta');
			expect(span.quote.startsWith('alpha')).toBe(true);
			expect(span.quote.endsWith('beta')).toBe(true);
			expect(source.slice(span.startOffset, span.endOffset)).toBe(span.quote);
		});

		it('still returns not_found when the tokens genuinely differ', () => {
			const source = 'alpha beta gamma';
			const resolution = resolveSourceSpan(source, 'alpha delta gamma', {
				normalizeWhitespace: true,
			});

			expect(resolution.matched).toBe(false);
			if (!resolution.matched) {
				expect(resolution.reason).toBe('not_found');
			}
		});
	});

	describe('rejections', () => {
		it('returns not_found for an absent quote', () => {
			const resolution = resolveSourceSpan('hello world', 'goodbye');
			expect(resolution).toEqual({ matched: false, reason: 'not_found' });
		});

		it('returns empty_quote for an empty quote', () => {
			const resolution = resolveSourceSpan('hello world', '');
			expect(resolution).toEqual({ matched: false, reason: 'empty_quote' });
		});

		it('returns empty_quote for a whitespace-only quote', () => {
			const resolution = resolveSourceSpan('hello world', '   \n\t ');
			expect(resolution).toEqual({ matched: false, reason: 'empty_quote' });
		});

		it('returns empty_source for an empty source', () => {
			const resolution = resolveSourceSpan('', 'anything');
			expect(resolution).toEqual({ matched: false, reason: 'empty_source' });
		});

		it('returns not_found when the quote is longer than the source', () => {
			const resolution = resolveSourceSpan('short', 'a much longer quote than the source');
			expect(resolution).toEqual({ matched: false, reason: 'not_found' });
		});
	});

	describe('case sensitivity', () => {
		it('does not match on differing case', () => {
			const resolution = resolveSourceSpan('Hello World', 'hello world');
			expect(resolution.matched).toBe(false);
		});

		it('matches on identical case', () => {
			const span = expectMatched(resolveSourceSpan('Hello World', 'Hello World'));
			expect(span.quote).toBe('Hello World');
		});

		it('remains case-sensitive even with normalizeWhitespace', () => {
			const resolution = resolveSourceSpan('Hello   World', 'hello world', {
				normalizeWhitespace: true,
			});
			expect(resolution.matched).toBe(false);
		});
	});

	describe('unicode', () => {
		it('resolves offsets correctly after multi-byte characters (emoji + accents)', () => {
			const source = 'cost is 5€ for café 🚀 launch today';
			const span = expectMatched(resolveSourceSpan(source, 'launch today'));

			// Round-trip is the real guarantee under UTF-16 indexing.
			expect(source.slice(span.startOffset, span.endOffset)).toBe('launch today');
			expect(span.quote).toBe('launch today');
		});

		it('round-trips an emoji-containing quote', () => {
			const source = 'before 🚀 after';
			const span = expectMatched(resolveSourceSpan(source, '🚀 after'));
			expect(source.slice(span.startOffset, span.endOffset)).toBe('🚀 after');
		});
	});
});

describe('isQuoteSupported', () => {
	it('returns true when the quote resolves', () => {
		expect(isQuoteSupported('alpha beta', 'beta')).toBe(true);
	});

	it('returns false when the quote is absent', () => {
		expect(isQuoteSupported('alpha beta', 'gamma')).toBe(false);
	});

	it('returns false for empty quote and empty source', () => {
		expect(isQuoteSupported('alpha beta', '')).toBe(false);
		expect(isQuoteSupported('', 'alpha')).toBe(false);
	});

	it('honors the normalizeWhitespace option', () => {
		expect(isQuoteSupported('alpha\nbeta', 'alpha beta')).toBe(false);
		expect(isQuoteSupported('alpha\nbeta', 'alpha beta', { normalizeWhitespace: true })).toBe(true);
	});
});

describe('requireSourceSpan', () => {
	it('returns the same span as resolveSourceSpan on success', () => {
		const source = 'The quick brown fox';
		const span = requireSourceSpan(source, 'quick brown');
		const resolved = expectMatched(resolveSourceSpan(source, 'quick brown'));
		expect(span).toEqual(resolved);
	});

	it('throws ValidationError when the quote is not supported', () => {
		expect(() => requireSourceSpan('hello world', 'goodbye')).toThrow(ValidationError);
	});

	it('throws ValidationError with the resolution reason in the message', () => {
		expect(() => requireSourceSpan('hello world', '   ')).toThrow(/empty_quote/);
		expect(() => requireSourceSpan('', 'x')).toThrow(/empty_source/);
		expect(() => requireSourceSpan('hello', 'nope')).toThrow(/not_found/);
	});
});
