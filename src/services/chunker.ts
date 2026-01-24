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
 * Split text into sentences using regex
 * Handles common abbreviations and edge cases
 */
function splitIntoSentences(text: string): string[] {
	// Normalize whitespace first
	const normalized = text.replace(/\r\n/g, '\n').replace(/\s+/g, ' ').trim();

	if (normalized.length === 0) {
		return [];
	}

	// Split on sentence boundaries: . ! ? followed by space and uppercase letter
	// Also handles newlines as sentence boundaries
	// Preserves the punctuation with the preceding sentence
	const sentenceRegex = /(?<=[.!?])\s+(?=[A-Z])|(?<=\n)\s*/g;
	const sentences = normalized.split(sentenceRegex).filter((s) => s.trim().length > 0);

	return sentences.map((s) => s.trim());
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
 * 1. Split text into sentences
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

	// Split into sentences
	const sentences = splitIntoSentences(text);

	if (sentences.length === 0) {
		return [];
	}

	// If only one sentence or text is small, return as single chunk
	if (sentences.length === 1 || text.length <= maxChars) {
		const content = sentences.join(' ').trim();
		return [
			{
				content,
				index: 0,
				startOffset: 0,
				endOffset: content.length,
				tokenCount: Math.ceil(content.length / CHARS_PER_TOKEN),
			},
		];
	}

	logger.debug('Generating sentence embeddings for semantic chunking', {
		sentenceCount: sentences.length,
	});

	// Generate embeddings for all sentences
	const embeddings = await generateEmbeddings(sentences);

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

	// Group sentences into initial chunks based on split points
	const sentenceGroups: string[][] = [];
	let lastSplit = 0;
	for (const splitIdx of splitIndices) {
		if (splitIdx > lastSplit) {
			sentenceGroups.push(sentences.slice(lastSplit, splitIdx));
			lastSplit = splitIdx;
		}
	}
	// Don't forget the last group
	if (lastSplit < sentences.length) {
		sentenceGroups.push(sentences.slice(lastSplit));
	}

	// Convert groups to text and handle size constraints
	const rawChunks = sentenceGroups.map((group) => group.join(' '));

	// Merge small chunks with neighbors
	const mergedChunks: string[] = [];
	let accumulator = '';

	for (const chunk of rawChunks) {
		if (accumulator.length === 0) {
			accumulator = chunk;
		} else if (accumulator.length + chunk.length + 1 <= maxChars) {
			// Can merge
			accumulator = accumulator + ' ' + chunk;
		} else if (accumulator.length < minChars && accumulator.length + chunk.length + 1 <= maxChars * 1.5) {
			// Current accumulator is too small, try to merge even if slightly over max
			accumulator = accumulator + ' ' + chunk;
		} else {
			// Can't merge, save accumulator and start new
			mergedChunks.push(accumulator);
			accumulator = chunk;
		}
	}
	if (accumulator.length > 0) {
		mergedChunks.push(accumulator);
	}

	// Split oversized chunks using fixed chunking as fallback
	const finalChunks: Chunk[] = [];
	let currentOffset = 0;

	for (const mergedChunk of mergedChunks) {
		if (mergedChunk.length > maxChars) {
			// Split oversized chunk using fixed chunking as fallback
			const subChunks = chunkText(mergedChunk, {
				maxChunkSize,
				overlap: 50,
				separator: '. ',
			});
			for (const sub of subChunks) {
				finalChunks.push({
					content: sub.content,
					index: finalChunks.length,
					startOffset: currentOffset + sub.startOffset,
					endOffset: currentOffset + sub.endOffset,
					tokenCount: sub.tokenCount,
				});
			}
		} else {
			finalChunks.push({
				content: mergedChunk.trim(),
				index: finalChunks.length,
				startOffset: currentOffset,
				endOffset: currentOffset + mergedChunk.length,
				tokenCount: Math.ceil(mergedChunk.length / CHARS_PER_TOKEN),
			});
		}
		currentOffset += mergedChunk.length + 1; // +1 for space between chunks
	}

	logger.info('Semantic chunking completed', {
		originalLength: text.length,
		sentenceCount: sentences.length,
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
