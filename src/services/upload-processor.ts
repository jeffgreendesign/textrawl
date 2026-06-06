import { createHash } from 'node:crypto';
import type { Readable } from 'node:stream';
import { createChunks } from '../db/chunks.js';
import { createDocument } from '../db/documents.js';
import { isDatabaseConfigured } from '../db/pg-client.js';
import {
	type UploadState,
	getUpload,
	recordUploadProcessingResult,
	transitionUploadState,
} from '../db/uploads.js';
import {
	ChecksumMismatchError,
	SizeMismatchError,
	TextrawlError,
	UnsupportedFileTypeError,
	ValidationError,
} from '../utils/errors.js';
import { logger } from '../utils/logger.js';
import { smartChunk } from './chunker.js';
import { generateEmbeddings, isEmbeddingsConfigured } from './embeddings.js';
import { onDocumentIngested } from './pipeline.js';
import { extractText, isSupportedType, validateFileType } from './processor.js';
import { getStorageService } from './storage/index.js';

// A processing run that lands here is already finished — never re-run it.
const TERMINAL_STATES: readonly UploadState[] = [
	'completed',
	'partial',
	'failed',
	'expired',
	'cancelled',
];

/** Stable failure code carried into the `failed` transition. */
function failureCode(error: unknown): string {
	return error instanceof TextrawlError ? error.code : 'PROCESSING_FAILED';
}

/** Normalize a stored checksum (`sha256:abc…` or bare hex) to lowercase hex. */
function normalizeChecksum(value: string): string {
	return value
		.replace(/^sha256:/i, '')
		.trim()
		.toLowerCase();
}

/**
 * Read the object as a stream while computing its SHA-256, buffering the bytes
 * (MVP — true streaming extraction is Phase 5). Bounded by `maxBytes` (the size
 * already verified against the GCS object at `/complete`) so a changed/oversized
 * object cannot exhaust memory.
 */
async function readAndHash(
	stream: Readable,
	maxBytes: number,
): Promise<{ buffer: Buffer; digest: string }> {
	const hash = createHash('sha256');
	const parts: Buffer[] = [];
	let total = 0;

	for await (const chunk of stream) {
		const buf = chunk as Buffer;
		total += buf.length;
		if (total > maxBytes) {
			stream.destroy();
			throw new SizeMismatchError(`Stored object exceeds the verified size of ${maxBytes} bytes`);
		}
		hash.update(buf);
		parts.push(buf);
	}

	return { buffer: Buffer.concat(parts), digest: hash.digest('hex') };
}

/**
 * Process a queued single-file upload into a document (plan §3/§4, T4.3).
 *
 * Stream from GCS → SHA-256 (verified **before** extraction) → extract → chunk →
 * embed → create document + chunks → fire the ingestion pipeline → record
 * results → terminal state. Single-file only (ZIP is Phase 5).
 *
 * Idempotent on `uploadId`: a Cloud Tasks retry that finds the upload in a
 * terminal state is a no-op, so no duplicate document is created.
 *
 * **MVP limitation:** the object is fully buffered in memory (bounded by the
 * upload's verified size); true streaming extraction + ZIP arrive in Phase 5.
 */
export async function processUpload(uploadId: string): Promise<void> {
	const upload = await getUpload(uploadId);
	if (!upload) {
		logger.warn('processUpload: upload not found', { uploadId });
		return;
	}
	if (TERMINAL_STATES.includes(upload.state)) {
		logger.info('processUpload: upload already terminal — skipping', {
			uploadId,
			state: upload.state,
		});
		return;
	}

	try {
		if (!isDatabaseConfigured()) {
			throw new ValidationError('Database not configured');
		}
		if (!isEmbeddingsConfigured()) {
			throw new ValidationError('Embeddings provider not configured');
		}

		const mimetype = upload.declared_mimetype;
		if (!mimetype || !isSupportedType(mimetype)) {
			throw new UnsupportedFileTypeError(`Unsupported file type: ${mimetype ?? 'unknown'}`);
		}

		// Stream the object and compute its digest before extraction.
		const { buffer, digest } = await readAndHash(
			getStorageService().createReadStream(upload.object_key),
			upload.size_bytes,
		);

		// Verify content matches the claimed MIME type (magic-number sniff), mirroring
		// the direct-upload path.
		if (!(await validateFileType(buffer, mimetype))) {
			throw new ValidationError(`File content does not match claimed type: ${mimetype}`);
		}

		// Canonical integrity check — only when the client supplied an expectation.
		if (upload.checksum_expected && digest !== normalizeChecksum(upload.checksum_expected)) {
			throw new ChecksumMismatchError(
				'Computed SHA-256 does not match the client-supplied checksum',
			);
		}

		const content = await extractText(buffer, mimetype);
		const title = upload.title ?? upload.filename;

		const document = await createDocument({
			title,
			sourceType: 'file',
			rawContent: content,
			metadata: {
				uploadId,
				originalName: upload.filename,
				mimetype,
				size: upload.size_bytes,
			},
		});

		const chunks = await smartChunk(content, generateEmbeddings);
		const embeddings = await generateEmbeddings(chunks.map((c) => c.content));
		await createChunks(
			chunks.map((chunk, i) => ({
				documentId: document.id,
				content: chunk.content,
				chunkIndex: chunk.index,
				startOffset: chunk.startOffset,
				endOffset: chunk.endOffset,
				embedding: embeddings[i],
			})),
		);

		await onDocumentIngested(document.id, document.title, content, chunks.length);

		await recordUploadProcessingResult(uploadId, {
			documentIds: [document.id],
			checksumComputed: digest,
			checksumVerifiedAt: new Date().toISOString(),
			entriesTotal: 1,
			entriesProcessed: 1,
			entriesFailed: 0,
		});

		await transitionUploadState(uploadId, 'completed');
		logger.info('processUpload: completed', { uploadId, documentId: document.id });
	} catch (error) {
		const code = failureCode(error);
		const message = error instanceof Error ? error.message : String(error);
		logger.error('processUpload: failed', { uploadId, code, message });
		// Record terminal failure; swallow so Cloud Tasks does not retry a job that
		// has already been marked failed (a retry would no-op on the terminal guard).
		await transitionUploadState(uploadId, 'failed', {
			errorCode: code,
			errorMessage: message,
		}).catch((err) => {
			logger.error('processUpload: failed to mark upload failed', {
				uploadId,
				error: err instanceof Error ? err.message : String(err),
			});
		});
	}
}
