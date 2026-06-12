import { createChunks } from '../db/chunks.js';
import type { Chunk } from './chunker.js';

/**
 * Number of chunks embedded and inserted per window. Keeps peak memory bounded:
 * without windowing the whole document's embeddings (N × dimensions floats) plus
 * the mapped DB records are all resident at once. A window of 128 caps that to a
 * small, constant slice regardless of document size.
 */
const EMBED_WINDOW = 128;

/**
 * Embed a document's chunks and persist them, streaming in windows so the full
 * per-document embedding array is never held in memory at once. Chunk order and
 * `chunkIndex` are preserved across windows.
 */
export async function embedAndStoreChunks(
	documentId: string,
	chunks: Chunk[],
	generateEmbeddings: (texts: string[]) => Promise<number[][]>,
): Promise<void> {
	for (let i = 0; i < chunks.length; i += EMBED_WINDOW) {
		const window = chunks.slice(i, i + EMBED_WINDOW);
		const embeddings = await generateEmbeddings(window.map((c) => c.content));
		await createChunks(
			window.map((chunk, j) => ({
				documentId,
				content: chunk.content,
				chunkIndex: chunk.index,
				startOffset: chunk.startOffset,
				endOffset: chunk.endOffset,
				embedding: embeddings[j],
			})),
		);
	}
}
