import { config } from '../utils/config.js';
import { ValidationError } from '../utils/errors.js';
import { logger } from '../utils/logger.js';

/**
 * Chunk options for text splitting
 */
export interface ChunkOptions {
	/** Maximum tokens per chunk (approximate) */
	maxChunkSize?: number;
	/** Overlap tokens between chunks (approximate) */
	overlap?: number;
	/** Paragraph separator pattern */
	separator?: string;
}

/**
 * Options for semantic chunking
 */
export interface SemanticChunkOptions {
	/** Maximum tokens per chunk (approximate) */
	maxChunkSize?: number;
	/** Minimum tokens per chunk (approximate) - smaller chunks get merged */
	minChunkSize?: number;
	/** Similarity threshold (0-1) - lower similarity triggers a split */
	similarityThreshold?: number;
	/** Function to generate embeddings for sentences */
	generateEmbeddings: (texts: string[]) => Promise<number[][]>;
}

/**
 * A single text chunk with metadata
 */
export interface Chunk {
	/** The chunk text content */
	content: string;
	/** Zero-based chunk index */
	index: number;
	/** Character offset in original text */
	startOffset: number;
	/** End character offset in original text */
	endOffset: number;
	/** Approximate token count */
	tokenCount: number;
}

// Rough approximation: 1 token ≈ 4 characters for English
const CHARS_PER_TOKEN = 4;

/**
 * A sentence with its position in the original text
 */
interface SentenceSpan {
	text: string;
	startOffset: number;
	endOffset: number;
}

/**
 * Split text into overlapping chunks suitable for embedding
 *
 * Uses paragraph-aware splitting with overlap to preserve context.
 * Chunks target ~512 tokens with ~50 token overlap.
 */
export function chunkText(text: string, options: ChunkOptions = {}): Chunk[] {
	const { maxChunkSize = 512, overlap = 50, separator = '\n\n' } = options;

	const maxChars = maxChunkSize * CHARS_PER_TOKEN;
	const overlapChars = overlap * CHARS_PER_TOKEN;

	// Normalize whitespace
	const normalizedText = text.replace(/\r\n/g, '\n').trim();

	if (normalizedText.length === 0) {
		return [];
	}

	// If text is small enough, return as single chunk
	if (normalizedText.length <= maxChars) {
		return [
			{
				content: normalizedText,
				index: 0,
				startOffset: 0,
				endOffset: normalizedText.length,
				tokenCount: Math.ceil(normalizedText.length / CHARS_PER_TOKEN),
			},
		];
	}

	const chunks: Chunk[] = [];
	const paragraphs = normalizedText.split(separator);

	let currentChunk = '';
	let chunkStartOffset = 0;
	let currentOffset = 0;

	for (let i = 0; i < paragraphs.length; i++) {
		const paragraph = paragraphs[i];
		const isLastParagraph = i === paragraphs.length - 1;
		const paragraphWithSep = isLastParagraph ? paragraph : paragraph + separator;

		// Check if adding this paragraph would exceed max size
		if (currentChunk.length > 0 && currentChunk.length + paragraphWithSep.length > maxChars) {
			// Save current chunk
			const trimmedContent = currentChunk.trim();
			if (trimmedContent.length > 0) {
				chunks.push({
					content: trimmedContent,
					index: chunks.length,
					startOffset: chunkStartOffset,
					endOffset: currentOffset,
					tokenCount: Math.ceil(trimmedContent.length / CHARS_PER_TOKEN),
				});
			}

			// Start new chunk with overlap from previous
			const overlapStart = Math.max(0, currentChunk.length - overlapChars);
			const overlapText = currentChunk.slice(overlapStart);
			chunkStartOffset = currentOffset - overlapText.length;
			currentChunk = overlapText;
		}

		currentChunk += paragraphWithSep;
		currentOffset += paragraphWithSep.length;
	}

	// Don't forget the last chunk
	const trimmedContent = currentChunk.trim();
	if (trimmedContent.length > 0) {
		chunks.push({
			content: trimmedContent,
			index: chunks.length,
			startOffset: chunkStartOffset,
			endOffset: currentOffset,
			tokenCount: Math.ceil(trimmedContent.length / CHARS_PER_TOKEN),
		});
	}

	logger.info('Chunked text', {
		originalLength: normalizedText.length,
		chunkCount: chunks.length,
		avgChunkTokens: Math.round(chunks.reduce((sum, c) => sum + c.tokenCount, 0) / chunks.length),
	});

	return chunks;
}

/**
 * Split text into sentences with their original positions preserved
 * Uses a linear scan algorithm to avoid regex backtracking vulnerabilities (ReDoS)
 */
function splitIntoSentencesWithSpans(text: string): SentenceSpan[] {
	// Guard against non-string input and limit length to prevent DoS
	if (typeof text !== 'string') {
		return [];
	}
	const maxLength = 10_000_000; // 10MB limit
	const safeText = text.length > maxLength ? text.slice(0, maxLength) : text;

	if (safeText.trim().length === 0) {
		return [];
	}

	const spans: SentenceSpan[] = [];
	const sentenceEnders = new Set(['.', '!', '?']);

	let sentenceStart = 0;
	// Skip leading whitespace
	while (sentenceStart < safeText.length && /\s/.test(safeText[sentenceStart])) {
		sentenceStart++;
	}

	let i = sentenceStart;
	while (i < safeText.length) {
		const char = safeText[i];

		// Check for paragraph break (2+ newlines)
		if (char === '\n' && i + 1 < safeText.length && safeText[i + 1] === '\n') {
			// End current sentence at the newline
			if (i > sentenceStart) {
				const sentenceText = safeText.slice(sentenceStart, i).trim();
				if (sentenceText.length > 0) {
					spans.push({
						text: sentenceText,
						startOffset: sentenceStart,
						endOffset: i,
					});
				}
			}
			// Skip all consecutive newlines
			while (i < safeText.length && safeText[i] === '\n') {
				i++;
			}
			// Skip whitespace after newlines
			while (i < safeText.length && /\s/.test(safeText[i]) && safeText[i] !== '\n') {
				i++;
			}
			sentenceStart = i;
			continue;
		}

		// Check for sentence-ending punctuation followed by space and capital letter
		if (sentenceEnders.has(char)) {
			// Look ahead for whitespace followed by capital letter
			let j = i + 1;
			// Skip whitespace (but limit to avoid long scans)
			const maxWhitespace = Math.min(i + 20, safeText.length);
			while (j < maxWhitespace && /\s/.test(safeText[j])) {
				j++;
			}
			// Check if next non-whitespace char is uppercase
			if (j < safeText.length && j > i + 1 && /[A-Z]/.test(safeText[j])) {
				// Found sentence boundary
				const sentenceText = safeText.slice(sentenceStart, i + 1).trim();
				if (sentenceText.length > 0) {
					spans.push({
						text: sentenceText,
						startOffset: sentenceStart,
						endOffset: i + 1,
					});
				}
				sentenceStart = j;
				i = j;
				continue;
			}
		}

		i++;
	}

	// Don't forget the last sentence
	if (sentenceStart < safeText.length) {
		const remainingText = safeText.slice(sentenceStart).trim();
		if (remainingText.length > 0) {
			spans.push({
				text: remainingText,
				startOffset: sentenceStart,
				endOffset: safeText.length,
			});
		}
	}

	return spans;
}

/**
 * Calculate cosine similarity between two vectors
 */
function cosineSimilarity(a: number[], b: number[]): number {
	if (a.length !== b.length) {
		throw new ValidationError('Vectors must have the same length');
	}

	let dotProduct = 0;
	let normA = 0;
	let normB = 0;

	for (let i = 0; i < a.length; i++) {
		dotProduct += a[i] * b[i];
		normA += a[i] * a[i];
		normB += b[i] * b[i];
	}

	const magnitude = Math.sqrt(normA) * Math.sqrt(normB);
	if (magnitude === 0) return 0;

	return dotProduct / magnitude;
}

/**
 * Semantic chunking: Split text based on embedding similarity between sentences
 *
 * Uses sentence embeddings to detect topic shifts and create semantically
 * coherent chunks. This approach typically improves retrieval accuracy
 * compared to fixed-size chunking.
 *
 * Algorithm:
 * 1. Split text into sentences with position tracking
 * 2. Generate embeddings for each sentence
 * 3. Calculate cosine similarity between consecutive sentences
 * 4. Split at points where similarity drops below threshold
 * 5. Merge chunks that are too small, split chunks that are too large
 */
// Maximum text length for semantic chunking (10MB)
// Larger texts fall back to fixed chunking to prevent DoS and memory issues
const MAX_SEMANTIC_TEXT_LENGTH = 10_000_000;

export async function chunkTextSemantic(
	text: string,
	options: SemanticChunkOptions,
): Promise<Chunk[]> {
	const {
		maxChunkSize = 512,
		minChunkSize = 100,
		similarityThreshold = 0.5,
		generateEmbeddings,
	} = options;

	const maxChars = maxChunkSize * CHARS_PER_TOKEN;
	const minChars = minChunkSize * CHARS_PER_TOKEN;

	// Fall back to fixed chunking for oversized text to avoid silent truncation
	if (text.length > MAX_SEMANTIC_TEXT_LENGTH) {
		logger.info('Text too large for semantic chunking; falling back to fixed chunking', {
			length: text.length,
			maxLength: MAX_SEMANTIC_TEXT_LENGTH,
		});
		return chunkText(text, { maxChunkSize });
	}

	// Split into sentences with position tracking
	const sentenceSpans = splitIntoSentencesWithSpans(text);

	if (sentenceSpans.length === 0) {
		return [];
	}

	// If text is small, return as a single chunk containing all sentences
	if (text.length <= maxChars) {
		const startOffset = sentenceSpans[0].startOffset;
		const endOffset = sentenceSpans[sentenceSpans.length - 1].endOffset;
		const content = sentenceSpans.map((s) => s.text).join(' ');
		return [
			{
				content,
				index: 0,
				startOffset,
				endOffset,
				tokenCount: Math.ceil(content.length / CHARS_PER_TOKEN),
			},
		];
	}

	// If a single sentence exceeds max size, slice original text directly to preserve offsets
	if (sentenceSpans.length === 1) {
		const overlapChars = 50 * CHARS_PER_TOKEN;
		const chunks: Chunk[] = [];
		for (let start = 0; start < text.length; start += maxChars - overlapChars) {
			const end = Math.min(text.length, start + maxChars);
			const content = text.slice(start, end);
			chunks.push({
				content,
				index: chunks.length,
				startOffset: start,
				endOffset: end,
				tokenCount: Math.ceil(content.length / CHARS_PER_TOKEN),
			});
			if (end === text.length) break;
		}
		return chunks;
	}

	logger.debug('Generating sentence embeddings for semantic chunking', {
		sentenceCount: sentenceSpans.length,
	});

	// Generate embeddings for all sentences
	const sentenceTexts = sentenceSpans.map((s) => s.text);
	const embeddings = await generateEmbeddings(sentenceTexts);

	// Validate embedding count and dimension consistency
	if (embeddings.length !== sentenceTexts.length) {
		throw new ValidationError(
			`Embedding count mismatch: expected ${sentenceTexts.length}, got ${embeddings.length}`,
		);
	}
	const dimension = embeddings[0]?.length ?? 0;
	if (dimension === 0 || embeddings.some((e) => e.length !== dimension)) {
		throw new ValidationError('Embedding dimension mismatch in semantic chunking');
	}

	// Calculate similarity between consecutive sentences
	const similarities: number[] = [];
	for (let i = 0; i < embeddings.length - 1; i++) {
		similarities.push(cosineSimilarity(embeddings[i], embeddings[i + 1]));
	}

	// Find split points where similarity drops below threshold
	// Use percentile-based threshold if specified threshold is too aggressive
	const sortedSimilarities = [...similarities].sort((a, b) => a - b);
	const percentileThreshold = sortedSimilarities[Math.floor(sortedSimilarities.length * 0.2)];
	const effectiveThreshold = Math.max(similarityThreshold, percentileThreshold);

	const splitIndices: number[] = [];
	for (let i = 0; i < similarities.length; i++) {
		if (similarities[i] < effectiveThreshold) {
			splitIndices.push(i + 1); // Split after sentence i
		}
	}

	// Group sentence spans into initial chunks based on split points
	const spanGroups: SentenceSpan[][] = [];
	let lastSplit = 0;
	for (const splitIdx of splitIndices) {
		if (splitIdx > lastSplit) {
			spanGroups.push(sentenceSpans.slice(lastSplit, splitIdx));
			lastSplit = splitIdx;
		}
	}
	// Don't forget the last group
	if (lastSplit < sentenceSpans.length) {
		spanGroups.push(sentenceSpans.slice(lastSplit));
	}

	// Merge small span groups with neighbors while tracking offsets
	interface SpanGroup {
		spans: SentenceSpan[];
		text: string;
		startOffset: number;
		endOffset: number;
	}

	const rawGroups: SpanGroup[] = spanGroups.map((spans) => ({
		spans,
		text: spans.map((s) => s.text).join(' '),
		startOffset: spans[0].startOffset,
		endOffset: spans[spans.length - 1].endOffset,
	}));

	// Merge small chunks with neighbors
	const mergedGroups: SpanGroup[] = [];
	let accumulator: SpanGroup | null = null;

	for (const group of rawGroups) {
		if (accumulator === null) {
			accumulator = group;
		} else if (accumulator.text.length + group.text.length + 1 <= maxChars) {
			// Can merge
			accumulator = {
				spans: [...accumulator.spans, ...group.spans],
				text: `${accumulator.text} ${group.text}`,
				startOffset: accumulator.startOffset,
				endOffset: group.endOffset,
			};
		} else if (
			accumulator.text.length < minChars &&
			accumulator.text.length + group.text.length + 1 <= maxChars * 1.5
		) {
			// Current accumulator is too small, try to merge even if slightly over max
			accumulator = {
				spans: [...accumulator.spans, ...group.spans],
				text: `${accumulator.text} ${group.text}`,
				startOffset: accumulator.startOffset,
				endOffset: group.endOffset,
			};
		} else {
			// Can't merge, save accumulator and start new
			mergedGroups.push(accumulator);
			accumulator = group;
		}
	}
	if (accumulator !== null) {
		mergedGroups.push(accumulator);
	}

	// Build final chunks with correct offsets from original text
	const finalChunks: Chunk[] = [];

	for (const group of mergedGroups) {
		if (group.text.length > maxChars) {
			// Split oversized chunk using fixed chunking as fallback
			// For oversized chunks, offsets are approximate (relative to chunk start)
			const subChunks = chunkText(group.text, {
				maxChunkSize,
				overlap: 50,
				separator: '\n\n',
			});
			for (const sub of subChunks) {
				finalChunks.push({
					content: sub.content,
					index: finalChunks.length,
					startOffset: group.startOffset + sub.startOffset,
					endOffset: group.startOffset + sub.endOffset,
					tokenCount: sub.tokenCount,
				});
			}
		} else {
			finalChunks.push({
				content: group.text.trim(),
				index: finalChunks.length,
				startOffset: group.startOffset,
				endOffset: group.endOffset,
				tokenCount: Math.ceil(group.text.length / CHARS_PER_TOKEN),
			});
		}
	}

	logger.info('Semantic chunking completed', {
		originalLength: text.length,
		sentenceCount: sentenceSpans.length,
		chunkCount: finalChunks.length,
		avgChunkTokens: Math.round(
			finalChunks.reduce((sum, c) => sum + c.tokenCount, 0) / finalChunks.length,
		),
		similarityThreshold: effectiveThreshold.toFixed(3),
	});

	return finalChunks;
}

/**
 * Smart chunking: Automatically choose chunking strategy based on config
 *
 * Uses CHUNKING_MODE environment variable:
 * - 'fixed': Fast paragraph-aware splitting (default)
 * - 'semantic': Embedding-based topic boundary detection
 *
 * @param text - Text to chunk
 * @param generateEmbeddings - Embedding function (required for semantic mode)
 * @param options - Optional chunk size options
 */
export async function smartChunk(
	text: string,
	generateEmbeddings: (texts: string[]) => Promise<number[][]>,
	options: ChunkOptions = {},
): Promise<Chunk[]> {
	if (config.CHUNKING_MODE === 'semantic') {
		logger.debug('Using semantic chunking mode');
		return chunkTextSemantic(text, {
			maxChunkSize: options.maxChunkSize ?? 512,
			minChunkSize: 100,
			similarityThreshold: config.SEMANTIC_SIMILARITY_THRESHOLD,
			generateEmbeddings,
		});
	}

	// Default to fixed chunking
	logger.debug('Using fixed chunking mode');
	return chunkText(text, options);
}
