import { randomUUID } from 'node:crypto';
import { Router, type Router as RouterType } from 'express';
import { z } from 'zod';
import { isDatabaseConfigured } from '../db/pg-client.js';
import {
	type UploadState,
	createUpload,
	getUpload,
	getUploadStatus,
	transitionUploadState,
} from '../db/uploads.js';
import { isSupportedType } from '../services/processor.js';
import { getStorageService } from '../services/storage/index.js';
import { getTaskQueue } from '../services/tasks/index.js';
import { config } from '../utils/config.js';
import {
	FileTooLargeError,
	ForbiddenOwnerError,
	InvalidUploadStateError,
	NotFoundError,
	UnsupportedFileTypeError,
	UploadExpiredError,
	ValidationError,
} from '../utils/errors.js';
import { logger } from '../utils/logger.js';
import { deriveOwnerTokenHash, ownsUpload } from './lib/owner.js';
import { bearerAuth } from './middleware/auth.js';
import { uploadLimiter } from './middleware/rateLimit.js';

export const uploadSessionsRouter: RouterType = Router();

// Default bucket name when GCS is not yet configured (in-memory storage fake).
const DEFAULT_BUCKET = 'textrawl-uploads';

// Archive types this resumable workflow accepts in addition to the single-file
// document types `processor.isSupportedType` knows about. ZIP extraction itself
// arrives in T5; `/init` accepts the type so the large path is reachable.
const ARCHIVE_MIME_TYPES = new Set(['application/zip', 'application/x-zip-compressed']);

// States that mean processing was already requested/finished — a second
// `/complete` is a no-op (idempotent) rather than a new enqueue.
const COMPLETE_IDEMPOTENT_STATES: readonly UploadState[] = [
	'queued',
	'processing',
	'completed',
	'partial',
];
const COMPLETE_TERMINAL_FAILURE_STATES: readonly UploadState[] = ['cancelled', 'failed', 'expired'];

const InitSchema = z.object({
	filename: z.string().min(1).max(500),
	contentType: z.string().max(255).optional(),
	size: z.number().int().positive(),
	checksumAlgo: z.string().max(32).optional(),
	checksum: z.string().max(256).nullish(),
});

const CompleteSchema = z.object({
	uploadId: z.string().min(1),
	checksum: z.string().max(256).nullish(),
	checksumAlgo: z.string().max(32).optional(),
});

/** Allowed upload types: undefined → verified later; archives + document types. */
function isAllowedUploadType(contentType: string | undefined): boolean {
	if (!contentType) return true;
	return ARCHIVE_MIME_TYPES.has(contentType) || isSupportedType(contentType);
}

/** `uploads/YYYY/MM/<uuid>/<sanitized-filename>` — server-generated, never trusted from client. */
function buildObjectKey(filename: string): string {
	const now = new Date();
	const year = now.getUTCFullYear();
	const month = String(now.getUTCMonth() + 1).padStart(2, '0');
	const safeName = filename.replace(/[^\w.-]/g, '_').slice(0, 200) || 'upload';
	return `uploads/${year}/${month}/${randomUUID()}/${safeName}`;
}

function thresholdBytes(): number {
	const mb = config.UPLOAD_THRESHOLD_MB ?? config.MAX_SINGLE_FILE_SIZE_MB;
	return mb * 1024 * 1024;
}

uploadSessionsRouter.post('/upload/init', bearerAuth, uploadLimiter, async (req, res, next) => {
	try {
		if (!isDatabaseConfigured()) {
			res.status(503).json({ error: 'Database not configured' });
			return;
		}

		const parsed = InitSchema.safeParse(req.body);
		if (!parsed.success) {
			throw new ValidationError(parsed.error.issues[0].message);
		}
		const { filename, contentType, size, checksumAlgo, checksum } = parsed.data;

		const maxBytes = config.MAX_UPLOAD_SIZE_MB * 1024 * 1024;
		if (size > maxBytes) {
			throw new FileTooLargeError(
				`File size ${size} exceeds the maximum upload size of ${config.MAX_UPLOAD_SIZE_MB} MB`,
			);
		}

		if (!isAllowedUploadType(contentType)) {
			throw new UnsupportedFileTypeError(`Unsupported file type: ${contentType}`);
		}

		const bucket = config.GCS_UPLOAD_BUCKET ?? DEFAULT_BUCKET;
		const objectKey = buildObjectKey(filename);
		const expiresAt = new Date(
			Date.now() + config.UPLOAD_SESSION_TTL_MIN * 60 * 1000,
		).toISOString();

		const { resumableUri } = await getStorageService().startResumableSession(objectKey, {
			contentType,
			size,
		});

		const upload = await createUpload({
			ownerTokenHash: deriveOwnerTokenHash(req),
			filename,
			declaredMimetype: contentType ?? null,
			sizeBytes: size,
			bucket,
			objectKey,
			checksumAlgo: checksumAlgo ?? null,
			checksumExpected: checksum ?? null,
			expiresAt,
		});

		res.json({
			uploadId: upload.id,
			objectKey: upload.object_key,
			bucket: upload.bucket,
			resumableUri,
			expiresAt: upload.expires_at,
			state: upload.state,
			useDirectUpload: size <= thresholdBytes(),
		});
	} catch (error) {
		next(error);
	}
});

uploadSessionsRouter.post('/upload/complete', bearerAuth, uploadLimiter, async (req, res, next) => {
	try {
		if (!isDatabaseConfigured()) {
			res.status(503).json({ error: 'Database not configured' });
			return;
		}

		const parsed = CompleteSchema.safeParse(req.body);
		if (!parsed.success) {
			throw new ValidationError(parsed.error.issues[0].message);
		}
		const { uploadId } = parsed.data;

		const upload = await getUpload(uploadId);
		if (!upload) {
			throw new NotFoundError('Upload not found');
		}

		if (!ownsUpload(upload.owner_token_hash, deriveOwnerTokenHash(req))) {
			// `/complete` names a concrete upload the caller initiated, so a mismatch
			// is an authorization failure (403), not a not-found.
			throw new ForbiddenOwnerError();
		}

		const statusUrl = `/api/upload/${uploadId}/status`;

		// Idempotent: processing already requested/finished → return current state,
		// never enqueue a duplicate.
		if (COMPLETE_IDEMPOTENT_STATES.includes(upload.state)) {
			const settled = upload.state === 'completed' || upload.state === 'partial';
			res.status(settled ? 200 : 202).json({ uploadId, state: upload.state, statusUrl });
			return;
		}

		// Terminal failure → cannot complete.
		if (COMPLETE_TERMINAL_FAILURE_STATES.includes(upload.state)) {
			throw new InvalidUploadStateError(
				`Cannot complete upload in terminal state: ${upload.state}`,
			);
		}

		// Expiry: TTL elapsed before complete.
		if (upload.expires_at && Date.now() > Date.parse(upload.expires_at)) {
			await transitionUploadState(uploadId, 'expired', {
				errorCode: 'UPLOAD_EXPIRED',
				errorMessage: 'Upload session expired before completion',
			}).catch(() => undefined);
			throw new UploadExpiredError();
		}

		// Verify the object landed (metadata-only). With the in-memory fake this
		// reflects the declared size; real GCS object/size/crc32c verification and
		// the OBJECT_NOT_FOUND / SIZE_MISMATCH codes arrive in T3.2.
		const meta = await getStorageService().headObject(upload.object_key);
		if (meta && meta.size !== upload.size_bytes) {
			throw new ValidationError(
				`Uploaded object size ${meta.size} does not match declared size ${upload.size_bytes}`,
			);
		}

		// Object-verify passed → uploaded (pre-enqueue).
		if (upload.state !== 'uploaded') {
			await transitionUploadState(uploadId, 'uploaded');
		}

		// Enqueue (idempotent, deduped by upload id) BEFORE flipping to `queued`.
		// If the enqueue throws, the row stays in `uploaded` — a retry of /complete
		// re-enqueues and transitions cleanly, rather than being short-circuited by
		// the idempotent `queued` guard with no task ever created.
		await getTaskQueue().enqueueProcessing(uploadId);
		await transitionUploadState(uploadId, 'queued');

		res.status(202).json({ uploadId, state: 'queued', statusUrl });
	} catch (error) {
		next(error);
	}
});

uploadSessionsRouter.get<{ uploadId: string }>(
	'/upload/:uploadId/status',
	bearerAuth,
	async (req, res, next) => {
		try {
			if (!isDatabaseConfigured()) {
				res.status(503).json({ error: 'Database not configured' });
				return;
			}

			const status = await getUploadStatus(req.params.uploadId);
			// Non-owner (or missing) → 404 so we never leak the existence of another
			// caller's upload id.
			if (!status || !ownsUpload(status.upload.owner_token_hash, deriveOwnerTokenHash(req))) {
				throw new NotFoundError('Upload not found');
			}

			const { upload, entries } = status;
			res.json({
				uploadId: upload.id,
				state: upload.state,
				filename: upload.filename,
				size: upload.size_bytes,
				progress: {
					entriesTotal: upload.entries_total,
					entriesProcessed: upload.entries_processed,
					entriesFailed: upload.entries_failed,
				},
				documentIds: upload.document_ids,
				entries: entries.map((e) => ({
					name: e.entry_path,
					state: e.state,
					documentId: e.document_id,
					code: e.error_code,
				})),
				error: upload.error_code
					? { code: upload.error_code, message: upload.error_message }
					: null,
				createdAt: upload.created_at,
				updatedAt: upload.updated_at,
				completedAt: upload.completed_at,
			});
		} catch (error) {
			next(error);
		}
	},
);

uploadSessionsRouter.delete<{ uploadId: string }>(
	'/upload/:uploadId',
	bearerAuth,
	async (req, res, next) => {
		try {
			if (!isDatabaseConfigured()) {
				res.status(503).json({ error: 'Database not configured' });
				return;
			}

			const upload = await getUpload(req.params.uploadId);
			// Non-owner (or missing) → 404 so we never leak existence.
			if (!upload || !ownsUpload(upload.owner_token_hash, deriveOwnerTokenHash(req))) {
				throw new NotFoundError('Upload not found');
			}

			// Idempotent: already cancelled → success.
			if (upload.state === 'cancelled') {
				res.json({ uploadId: upload.id, state: 'cancelled' });
				return;
			}

			// transitionUploadState enforces the legal graph: cancelling a
			// processing/completed/terminal upload throws InvalidUploadStateError (409).
			await transitionUploadState(upload.id, 'cancelled');
			await getStorageService().abortSession(upload.object_key);

			logger.info('Cancelled upload session', { id: upload.id });
			res.json({ uploadId: upload.id, state: 'cancelled' });
		} catch (error) {
			next(error);
		}
	},
);
