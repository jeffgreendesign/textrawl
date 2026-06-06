import { logger } from '../utils/logger.js';

/**
 * Process a queued single-file upload into a document (plan §3/§4).
 *
 * **Stub (T4.2).** The internal Cloud Tasks endpoint calls this after the OIDC
 * gate and the `queued → processing` transition; the real streaming pipeline
 * (GCS read → SHA-256 verify → extract → chunk → embed → create document →
 * record results → terminal state) lands in T4.3. For now it is a no-op so the
 * endpoint and its auth can be verified in isolation.
 *
 * Idempotent on `uploadId`: a Cloud Tasks retry must not create duplicate
 * documents (enforced once the real pipeline lands).
 */
export async function processUpload(uploadId: string): Promise<void> {
	logger.info('processUpload: stub invoked (pipeline lands in T4.3)', { uploadId });
}
