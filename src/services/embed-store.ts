import pLimit from 'p-limit';
import { createChunks } from '../db/chunks.js';
import { config } from '../utils/config.js';
import { ValidationError } from '../utils/errors.js';
import type { Chunk } from './chunker.js';

/**
 * Number of chunks embedded and inserted per window. Keeps peak memory bounded:
 * without windowing the whole document's embeddings (N × dimensions floats) plus
 * the mapped DB records are all resident at once. A window of 128 caps that to a
 * small, constant slice per in-flight window regardless of document size.
 */
const EMBED_WINDOW = 128;

/**
 * Embed a document's chunks and persist them, streaming in windows so the full
 * per-document embedding array is never held in memory at once. Windows run with
 * bounded concurrency (`EMBED_WINDOW_CONCURRENCY`) to overlap embed and insert
 * latency across windows; peak memory stays bounded to roughly that many windows.
 * Each chunk carries its own `chunkIndex`, so DB row identity does not depend on
 * insert order.
 */
export async function embedAndStoreChunks(
	documentId: string,
	chunks: Chunk[],
	generateEmbeddings: (texts: string[]) => Promise<number[][]>,
): Promise<void> {
	const windows: Chunk[][] = [];
	for (let i = 0; i < chunks.length; i += EMBED_WINDOW) {
		windows.push(chunks.slice(i, i + EMBED_WINDOW));
	}

	const limit = pLimit(Math.max(1, config.EMBED_WINDOW_CONCURRENCY));

	await Promise.all(
		windows.map((window) =>
			limit(async () => {
				const embeddings = await generateEmbeddings(window.map((c) => c.content));
				// Guard against a provider returning a short/misaligned batch: without this
				// the tail rows get `embeddings[j] === undefined` and createChunks persists
				// them as NULL embeddings, silently storing unsearchable chunks.
				if (embeddings.length !== window.length) {
					throw new ValidationError(
						`Embedding count mismatch: expected ${window.length}, got ${embeddings.length}`,
					);
				}
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
			}),
		),
	);
}
