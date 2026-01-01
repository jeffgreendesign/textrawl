/**
 * Text normalization utilities
 *
 * Cleans and normalizes text for better search and embedding
 */

import sanitizeHtml from 'sanitize-html';

/**
 * Normalization options
 */
export interface NormalizeOptions {
  /** Skip all normalization (raw mode) */
  raw?: boolean;
  /** Keep email signatures */
  keepSignatures?: boolean;
  /** Keep quoted reply chains */
  keepQuotes?: boolean;
  /** Maximum consecutive newlines */
  maxNewlines?: number;
}

/**
 * Common email signature patterns
 */
const SIGNATURE_PATTERNS = [
  /^-- $/m, // Standard sig delimiter
  /^--$/m, // Alternate sig delimiter
  /^_{3,}$/m, // Underscore divider
  /^-{3,}$/m, // Dash divider
  /Sent from my iPhone/i,
  /Sent from my iPad/i,
  /Sent from my Android/i,
  /Sent from Mail for Windows/i,
  /Get Outlook for iOS/i,
  /Get Outlook for Android/i,
  /Sent from Yahoo Mail/i,
  /Sent from Gmail/i,
  /^Cheers,$/m,
  /^Best,$/m,
  /^Thanks,$/m,
  /^Regards,$/m,
  /^Best regards,$/m,
  /^Kind regards,$/m,
];

/**
 * Quoted reply patterns
 */
const QUOTE_PATTERNS = [
  /^>+\s*.*/gm, // Standard quote markers
  /^On .+ wrote:$/m, // Gmail quote header
  /^-+\s*Original Message\s*-+$/m, // Outlook quote header
  /^From:.*\nSent:.*\nTo:.*\nSubject:.*/m, // Outlook forward header
];

/**
 * Normalize text content
 */
export function normalizeText(text: string, options: NormalizeOptions = {}): string {
  if (options.raw) {
    return text;
  }

  let result = text;

  // Unicode NFKC normalization (consistent characters)
  result = result.normalize('NFKC');

  // Normalize line endings
  result = result.replace(/\r\n/g, '\n').replace(/\r/g, '\n');

  // Remove email signatures unless keeping them
  if (!options.keepSignatures) {
    result = removeSignatures(result);
  }

  // Remove quoted reply chains unless keeping them
  if (!options.keepQuotes) {
    result = removeQuotedReplies(result);
  }

  // Normalize whitespace
  const maxNewlines = options.maxNewlines ?? 2;
  result = normalizeWhitespace(result, maxNewlines);

  return result.trim();
}

/**
 * Remove email signatures from text
 */
export function removeSignatures(text: string): string {
  let result = text;

  // Find the earliest signature marker
  let earliestIndex = result.length;

  for (const pattern of SIGNATURE_PATTERNS) {
    const match = result.match(pattern);
    if (match && match.index !== undefined && match.index < earliestIndex) {
      // Only consider it a signature if it's in the last portion of the email
      // (to avoid false positives from quoted content)
      if (match.index > result.length * 0.5) {
        earliestIndex = match.index;
      }
    }
  }

  // Remove everything after the signature marker
  if (earliestIndex < result.length) {
    result = result.slice(0, earliestIndex);
  }

  return result;
}

/**
 * Remove quoted reply chains
 */
export function removeQuotedReplies(text: string): string {
  let result = text;

  // Remove standard quote lines (> ...)
  const lines = result.split('\n');
  const filteredLines: string[] = [];
  let inQuoteBlock = false;
  let quoteBlockStart = -1;

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    const isQuoteLine = /^>+\s*/.test(line);

    if (isQuoteLine) {
      if (!inQuoteBlock) {
        inQuoteBlock = true;
        quoteBlockStart = i;
      }
    } else {
      if (inQuoteBlock) {
        // End of quote block
        const quoteLength = i - quoteBlockStart;
        if (quoteLength > 3) {
          // Replace long quote blocks with placeholder
          filteredLines.push('[Previous conversation trimmed]');
        } else {
          // Keep short quotes (might be intentional)
          for (let j = quoteBlockStart; j < i; j++) {
            filteredLines.push(lines[j]);
          }
        }
        inQuoteBlock = false;
      }
      filteredLines.push(line);
    }
  }

  // Handle quote block at end of text
  if (inQuoteBlock) {
    const quoteLength = lines.length - quoteBlockStart;
    if (quoteLength > 3) {
      filteredLines.push('[Previous conversation trimmed]');
    }
  }

  result = filteredLines.join('\n');

  // Remove "On X wrote:" headers
  result = result.replace(/^On .+? wrote:\s*$/gm, '');

  // Remove "Original Message" headers
  result = result.replace(/^-+\s*Original Message\s*-+\s*$/gm, '');

  return result;
}

/**
 * Normalize whitespace
 */
export function normalizeWhitespace(text: string, maxNewlines: number = 2): string {
  let result = text;

  // Replace tabs with spaces
  result = result.replace(/\t/g, '  ');

  // Remove trailing whitespace from lines
  result = result.replace(/[ \t]+$/gm, '');

  // Collapse multiple spaces to single space (except at line start for indentation)
  result = result.replace(/([^\n]) {2,}/g, '$1 ');

  // Collapse multiple newlines to maximum allowed
  const newlinePattern = new RegExp(`\n{${maxNewlines + 1},}`, 'g');
  result = result.replace(newlinePattern, '\n'.repeat(maxNewlines));

  return result;
}

/**
 * Strip HTML and convert to plain text
 */
export function stripHtml(html: string): string {
  // Remove script and style elements entirely
  let result = html.replace(/<script[^>]*>[\s\S]*?<\/script>/gi, '');
  result = result.replace(/<style[^>]*>[\s\S]*?<\/style>/gi, '');

  // Use sanitize-html to strip all tags
  result = sanitizeHtml(result, {
    allowedTags: [],
    allowedAttributes: {},
  });

  // Decode HTML entities
  result = decodeHtmlEntities(result);

  return result;
}

/**
 * Decode common HTML entities
 */
export function decodeHtmlEntities(text: string): string {
  const entities: Record<string, string> = {
    '&amp;': '&',
    '&lt;': '<',
    '&gt;': '>',
    '&quot;': '"',
    '&#39;': "'",
    '&apos;': "'",
    '&nbsp;': ' ',
    '&mdash;': '—',
    '&ndash;': '–',
    '&hellip;': '…',
    '&copy;': '©',
    '&reg;': '®',
    '&trade;': '™',
  };

  let result = text;
  for (const [entity, char] of Object.entries(entities)) {
    result = result.replace(new RegExp(entity, 'g'), char);
  }

  // Decode numeric entities
  result = result.replace(/&#(\d+);/g, (_, code) =>
    String.fromCharCode(parseInt(code, 10))
  );
  result = result.replace(/&#x([0-9a-f]+);/gi, (_, code) =>
    String.fromCharCode(parseInt(code, 16))
  );

  return result;
}

/**
 * Generate a slug from text (for filenames)
 */
export function slugify(text: string, maxLength: number = 50): string {
  return text
    .toLowerCase()
    .normalize('NFKD')
    .replace(/[\u0300-\u036f]/g, '') // Remove diacritics
    .replace(/[^a-z0-9]+/g, '-') // Replace non-alphanumeric with hyphens
    .replace(/^-+|-+$/g, '') // Remove leading/trailing hyphens
    .slice(0, maxLength)
    .replace(/-+$/, ''); // Remove trailing hyphens after truncation
}

/**
 * Calculate approximate token count (for chunking estimation)
 */
export function estimateTokens(text: string): number {
  // Rough approximation: 1 token ≈ 4 characters for English
  return Math.ceil(text.length / 4);
}
