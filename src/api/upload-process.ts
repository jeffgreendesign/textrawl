import { Router, type Router as RouterType } from 'express';
import { isDatabaseConfigured } from '../db/pg-client.js';
import { getUpload, transitionUploadState, type UploadState } from '../db/uploads.js';
import { processUpload } from '../services/upload-processor.js';
import { InvalidUploadStateError, NotFoundError } from '../utils/errors.js';
import { logger } from '../utils/logger.js';
import { cloudTasksOidc } from './middleware/oidc.js';

export const uploadProcessRouter: RouterType = Router();

// Terminal states: a Cloud Tasks retry that lands here is a no-op (the work is
// already finished, one way or another) — never re-run the pipeline.
const TERMINAL_STATES: readonly UploadState[] = [
	'completed',
	'partial',
	'failed',
	'cancelled',
	'expired',
];

/**
 * Internal processing endpoint (plan §4, T4.2). Cloud Tasks → Cloud Run only,
 * gated by {@link cloudTasksOidc} (strict OIDC, never `bearerAuth`). Idempotent
 * on `uploadId`: terminal states no-op, `queued` transitions to `processing`
 * (CAS) before the pipeline runs, and a retry mid-`processing` re-runs the
 * idempotent pipeline without re-transitioning.
 */
uploadProcessRouter.post<{ uploadId: string }>(
	'/upload/process/:uploadId',
	cloudTasksOidc,
	async (req, res, next) => {
		try {
			if (!isDatabaseConfigured()) {
				res.status(503).json({ error: 'Database not configured' });
				return;
			}

			const { uploadId } = req.params;
			const upload = await getUpload(uploadId);
			if (!upload) {
				throw new NotFoundError('Upload not found');
			}

			// Idempotent: already finished → no-op success (do not re-process).
			if (TERMINAL_STATES.includes(upload.state)) {
				logger.info('Process endpoint: no-op on terminal upload', {
					uploadId,
					state: upload.state,
				});
				res.status(200).json({ uploadId, state: upload.state });
				return;
			}

			if (upload.state === 'queued') {
				// CAS guard in transitionUploadState rejects a concurrent double-start.
				await transitionUploadState(uploadId, 'processing');
			} else if (upload.state !== 'processing') {
				// initialized / uploading / uploaded should never be enqueued — a task
				// only exists after `/complete` reaches `queued`.
				throw new InvalidUploadStateError(`Cannot process upload in state: ${upload.state}`);
			}

			// processUpload is idempotent on uploadId, so re-running it on a retry
			// (state already `processing`) does not create duplicate documents.
			await processUpload(uploadId);

			res.status(200).json({ uploadId, state: 'processing' });
		} catch (error) {
			next(error);
		}
	},
);
