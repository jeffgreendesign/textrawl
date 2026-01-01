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
  const {
    maxChunkSize = 512,
    overlap = 50,
    separator = '\n\n',
  } = options;

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
    if (
      currentChunk.length > 0 &&
      currentChunk.length + paragraphWithSep.length > maxChars
    ) {
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
    avgChunkTokens: Math.round(
      chunks.reduce((sum, c) => sum + c.tokenCount, 0) / chunks.length
    ),
  });

  return chunks;
}
