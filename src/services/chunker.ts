import { config } from '../utils/config.js';
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
 * Uses regex to find sentence boundaries while tracking offsets
 */
function splitIntoSentencesWithSpans(text: string): SentenceSpan[] {
	if (text.trim().length === 0) {
		return [];
	}

	const spans: SentenceSpan[] = [];

	// Match sentence-ending punctuation followed by whitespace and capital letter
	// or paragraph breaks. Using {1,3} limits to avoid ReDoS with repeated quantifiers.
	const sentenceEndRegex = /[.!?]{1,3}\s+(?=[A-Z])|\n{2,}/g;

	let lastEnd = 0;
	let match: RegExpExecArray | null;

	while ((match = sentenceEndRegex.exec(text)) !== null) {
		const sentenceEnd = match.index + match[0].trimEnd().length;
		const sentenceText = text.slice(lastEnd, sentenceEnd).trim();

		if (sentenceText.length > 0) {
			// Find actual start (skip leading whitespace)
			let actualStart = lastEnd;
			while (actualStart < text.length && /\s/.test(text[actualStart])) {
				actualStart++;
			}

			spans.push({
				text: sentenceText,
				startOffset: actualStart,
				endOffset: sentenceEnd,
			});
		}

		lastEnd = match.index + match[0].length;
	}

	// Don't forget the last sentence
	if (lastEnd < text.length) {
		const remainingText = text.slice(lastEnd).trim();
		if (remainingText.length > 0) {
			let actualStart = lastEnd;
			while (actualStart < text.length && /\s/.test(text[actualStart])) {
				actualStart++;
			}

			spans.push({
				text: remainingText,
				startOffset: actualStart,
				endOffset: text.length,
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
		throw new Error('Vectors must have the same length');
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

	// Split into sentences with position tracking
	const sentenceSpans = splitIntoSentencesWithSpans(text);

	if (sentenceSpans.length === 0) {
		return [];
	}

	// If only one sentence or text is small, return as single chunk
	if (sentenceSpans.length === 1 || text.length <= maxChars) {
		const span = sentenceSpans[0];
		return [
			{
				content: span.text,
				index: 0,
				startOffset: span.startOffset,
				endOffset: span.endOffset,
				tokenCount: Math.ceil(span.text.length / CHARS_PER_TOKEN),
			},
		];
	}

	logger.debug('Generating sentence embeddings for semantic chunking', {
		sentenceCount: sentenceSpans.length,
	});

	// Generate embeddings for all sentences
	const sentenceTexts = sentenceSpans.map((s) => s.text);
	const embeddings = await generateEmbeddings(sentenceTexts);

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
				text: accumulator.text + ' ' + group.text,
				startOffset: accumulator.startOffset,
				endOffset: group.endOffset,
			};
		} else if (accumulator.text.length < minChars && accumulator.text.length + group.text.length + 1 <= maxChars * 1.5) {
			// Current accumulator is too small, try to merge even if slightly over max
			accumulator = {
				spans: [...accumulator.spans, ...group.spans],
				text: accumulator.text + ' ' + group.text,
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
				separator: '. ',
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
