import { createHash } from 'node:crypto';
import type { Readable } from 'node:stream';
import { createChunks } from '../db/chunks.js';
import { createDocument } from '../db/documents.js';
import { isDatabaseConfigured } from '../db/pg-client.js';
import {
	type Upload,
	type UploadState,
	getUpload,
	listUploadEntries,
	recordUploadEntry,
	recordUploadProcessingResult,
	transitionUploadState,
} from '../db/uploads.js';
import {
	ChecksumMismatchError,
	SizeMismatchError,
	TextrawlError,
	UnsupportedFileTypeError,
	ValidationError,
	ZipNoSupportedEntriesError,
} from '../utils/errors.js';
import { logger } from '../utils/logger.js';
import { smartChunk } from './chunker.js';
import { generateEmbeddings, isEmbeddingsConfigured } from './embeddings.js';
import { onDocumentIngested } from './pipeline.js';
import { extractText, isSupportedType, validateFileType } from './processor.js';
import { validateZip } from './processor/handlers/archive-zip.js';
import { resolveForEntry } from './processor/registry.js';
import { getStorageService } from './storage/index.js';

/** ZIP MIME types this processor extracts (mirrors the `/init` accept-list). */
const ZIP_MIME_TYPES = new Set(['application/zip', 'application/x-zip-compressed']);

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
 * Await deferred per-document background work (memory extraction) after the upload
 * has already been marked terminal. Runs inside the Cloud Task request so CPU stays
 * allocated, but off the per-entry critical path — the upload reaches
 * `completed`/`partial` before these LLM calls settle. The promises already swallow
 * their own errors, so this only waits.
 */
async function settleBackgroundWork(work: Promise<unknown>[], uploadId: string): Promise<void> {
	if (work.length === 0) return;
	await Promise.allSettled(work);
	logger.info('processUpload: background ingestion work settled', {
		uploadId,
		tasks: work.length,
	});
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
		const isZip = !!mimetype && ZIP_MIME_TYPES.has(mimetype);

		// Reject unsupported single-file types before streaming the object. ZIP is
		// not an `isSupportedType` (it is not a single-file handler) but is valid
		// here — it routes to the archive branch below.
		if (!isZip && (!mimetype || !isSupportedType(mimetype))) {
			throw new UnsupportedFileTypeError(`Unsupported file type: ${mimetype ?? 'unknown'}`);
		}

		// Stream the object and compute its digest before extraction.
		const { buffer, digest } = await readAndHash(
			getStorageService().createReadStream(upload.object_key),
			upload.size_bytes,
		);

		// Canonical integrity check — only when the client supplied an expectation.
		// Verified before any extraction so a corrupt object creates no document.
		if (upload.checksum_expected && digest !== normalizeChecksum(upload.checksum_expected)) {
			throw new ChecksumMismatchError(
				'Computed SHA-256 does not match the client-supplied checksum',
			);
		}

		if (isZip) {
			await processZipUpload(uploadId, upload, buffer, digest);
			return;
		}

		// Single-file path. `mimetype` is a supported type here (guarded above).
		const singleMime = mimetype as string;

		// Verify content matches the claimed MIME type (magic-number sniff), mirroring
		// the direct-upload path.
		if (!(await validateFileType(buffer, singleMime))) {
			throw new ValidationError(`File content does not match claimed type: ${singleMime}`);
		}

		const content = await extractText(buffer, singleMime);
		const title = upload.title ?? upload.filename;

		const document = await createDocument({
			title,
			sourceType: 'file',
			rawContent: content,
			metadata: {
				uploadId,
				originalName: upload.filename,
				mimetype: singleMime,
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

		// Defer memory extraction off the critical path; await it after the upload is
		// marked completed so the dashboard sees the terminal state promptly.
		const backgroundWork: Promise<unknown>[] = [];
		await onDocumentIngested(document.id, document.title, content, chunks.length, {
			deferMemory: (p) => backgroundWork.push(p),
		});

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
		await settleBackgroundWork(backgroundWork, uploadId);
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

/**
 * Process a queued ZIP into one document per supported entry (plan §9, T5.3).
 *
 * The archive is validated against every §9 safety rule first ({@link validateZip}
 * throws a `ZIP_*` error for any archive-level violation, which the caller turns
 * into a `failed` transition with no documents). Supported entries are then
 * extracted one at a time (memory bounded to a single entry); per-entry failures
 * are recorded and the upload ends `partial`, or `completed` when all succeed.
 *
 * Idempotent on retry: entries already `completed` in a prior attempt are skipped
 * (their bytes are never re-decompressed), and per-entry rows upsert on the
 * `(upload_id, entry_path)` unique index — so a re-run creates no duplicate
 * documents or rows.
 *
 * @throws {ZipNoSupportedEntriesError} If the archive holds no supported entries.
 */
async function processZipUpload(
	uploadId: string,
	upload: Upload,
	buffer: Buffer,
	digest: string,
): Promise<void> {
	// Archive-level validation — throws (→ caller marks `failed`) before any document.
	const { candidates, skipped } = await validateZip(buffer);

	// Record unsupported (non-junk) entries so the status response is honest.
	for (const entry of skipped) {
		await recordUploadEntry({
			uploadId,
			entryPath: entry.entryPath,
			sizeBytes: entry.sizeBytes,
			state: 'skipped',
			errorCode: entry.errorCode,
			errorMessage: entry.reason,
		});
	}

	if (candidates.length === 0) {
		throw new ZipNoSupportedEntriesError('Archive contains no supported files');
	}

	// Idempotent retry: reuse documents from entries a prior attempt already completed.
	const priorCompleted = new Map(
		(await listUploadEntries(uploadId))
			.filter((e) => e.state === 'completed' && e.document_id)
			.map((e) => [e.entry_path, e.document_id as string]),
	);

	const documentIds: string[] = [];
	let processed = 0;
	let failed = 0;
	// Per-document memory extraction is deferred off the per-entry loop so a ZIP of
	// N entries is not serialized on N LLM calls; settled once at the end.
	const backgroundWork: Promise<unknown>[] = [];

	for (const candidate of candidates) {
		const existingDocId = priorCompleted.get(candidate.entryPath);
		if (existingDocId) {
			documentIds.push(existingDocId);
			processed++;
			continue;
		}

		try {
			const entryBuffer = await candidate.read();

			// Content magic-sniff: an entry whose bytes contradict its extension is
			// skipped (not failed) — it is not a corrupt supported file.
			const handler = await resolveForEntry(candidate.entryPath, entryBuffer);
			if (!handler) {
				await recordUploadEntry({
					uploadId,
					entryPath: candidate.entryPath,
					sizeBytes: candidate.sizeBytes,
					state: 'skipped',
					errorCode: 'UNSUPPORTED_ENTRY',
					errorMessage: 'Entry content does not match its extension',
				});
				continue;
			}

			const content = await handler.extract(entryBuffer);
			const document = await createDocument({
				title: candidate.entryPath,
				sourceType: 'file',
				rawContent: content,
				metadata: {
					uploadId,
					originalName: upload.filename,
					entryPath: candidate.entryPath,
					normalizedType: handler.key,
					size: candidate.sizeBytes,
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

			await onDocumentIngested(document.id, document.title, content, chunks.length, {
				deferMemory: (p) => backgroundWork.push(p),
			});

			await recordUploadEntry({
				uploadId,
				entryPath: candidate.entryPath,
				normalizedType: handler.key,
				sizeBytes: candidate.sizeBytes,
				state: 'completed',
				documentId: document.id,
			});
			documentIds.push(document.id);
			processed++;
		} catch (error) {
			const code = failureCode(error);
			const message = error instanceof Error ? error.message : String(error);
			logger.error('processZipUpload: entry failed', {
				uploadId,
				entryPath: candidate.entryPath,
				code,
				message,
			});
			await recordUploadEntry({
				uploadId,
				entryPath: candidate.entryPath,
				normalizedType: candidate.normalizedType,
				sizeBytes: candidate.sizeBytes,
				state: 'failed',
				errorCode: code,
				errorMessage: message,
			});
			failed++;
		}
	}

	await recordUploadProcessingResult(uploadId, {
		documentIds,
		checksumComputed: digest,
		checksumVerifiedAt: new Date().toISOString(),
		entriesTotal: candidates.length + skipped.length,
		entriesProcessed: processed,
		entriesFailed: failed,
	});

	if (documentIds.length === 0) {
		// Every supported entry failed extraction (or was content-skipped) — no
		// documents were created, so this is a failed upload, not a partial one.
		await transitionUploadState(uploadId, 'failed', {
			errorCode: 'PROCESSING_FAILED',
			errorMessage: 'No archive entries could be processed',
		});
		logger.info('processZipUpload: failed (no documents)', { uploadId, failed });
		return;
	}

	const finalState: UploadState = failed > 0 ? 'partial' : 'completed';
	await transitionUploadState(uploadId, finalState);
	logger.info('processZipUpload: done', {
		uploadId,
		state: finalState,
		processed,
		failed,
		documents: documentIds.length,
	});
	await settleBackgroundWork(backgroundWork, uploadId);
}
