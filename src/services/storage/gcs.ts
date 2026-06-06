import type { Readable } from 'node:stream';
import { Storage, type Storage as StorageClient } from '@google-cloud/storage';
import { logger } from '../../utils/logger.js';
import type {
	ObjectMetadata,
	ResumableSession,
	StartResumableOptions,
	StorageService,
} from './types.js';

/** Construction options for {@link GcsStorageService}. */
export interface GcsStorageOptions {
	/** Target bucket (e.g. `textrawl-uploads`). */
	bucket: string;
	/** GCP project id; optional — auto-detected from ADC when omitted. */
	projectId?: string;
	/** Resumable-session lifetime surfaced as `expiresAt` (defaults to 120). */
	sessionTtlMinutes?: number;
}

/** Type guard for the `code` carried on `@google-cloud/storage` ApiErrors. */
function statusCode(error: unknown): number | undefined {
	if (error && typeof error === 'object' && 'code' in error) {
		const code = (error as { code: unknown }).code;
		return typeof code === 'number' ? code : undefined;
	}
	return undefined;
}

/**
 * Real GCS-backed {@link StorageService} (plan §3/§4, T3.1).
 *
 * Bytes live in the bucket and never transit Postgres/Cloud Run memory: `/init`
 * opens a **server-initiated resumable session** and the browser PUTs directly
 * to the returned URI; `/complete` verifies the landed object via metadata-only
 * `headObject`; `DELETE` cleans up via `abortSession`. The Cloud Run runtime
 * service account authenticates through ADC — no service-account keys.
 */
export class GcsStorageService implements StorageService {
	private readonly client: StorageClient;
	private readonly bucketName: string;
	private readonly sessionTtlMinutes: number;

	constructor(opts: GcsStorageOptions) {
		this.client = new Storage(opts.projectId ? { projectId: opts.projectId } : {});
		this.bucketName = opts.bucket;
		this.sessionTtlMinutes = opts.sessionTtlMinutes ?? 120;
	}

	private file(objectKey: string) {
		return this.client.bucket(this.bucketName).file(objectKey);
	}

	async startResumableSession(
		objectKey: string,
		opts: StartResumableOptions,
	): Promise<ResumableSession> {
		const [resumableUri] = await this.file(objectKey).createResumableUpload({
			metadata: opts.contentType ? { contentType: opts.contentType } : {},
			// Binds the browser origin so cross-origin PUTs to the session are
			// accepted; bucket CORS still gates which origins are allowed.
			...(opts.origin ? { origin: opts.origin } : {}),
		});

		logger.debug('GcsStorage: started resumable session', { bucket: this.bucketName, objectKey });
		return {
			resumableUri,
			expiresAt: new Date(Date.now() + this.sessionTtlMinutes * 60 * 1000).toISOString(),
		};
	}

	async headObject(objectKey: string): Promise<ObjectMetadata | null> {
		try {
			const [md] = await this.file(objectKey).getMetadata();
			return {
				size: typeof md.size === 'number' ? md.size : parseInt(String(md.size ?? 0), 10),
				generation: String(md.generation ?? ''),
				crc32c: String(md.crc32c ?? ''),
				etag: String(md.etag ?? ''),
			};
		} catch (error) {
			if (statusCode(error) === 404) {
				return null;
			}
			throw error;
		}
	}

	async abortSession(objectKey: string): Promise<void> {
		// We hold the object key, not the resumable session URI, so cleanup is a
		// best-effort delete of any finalized bytes; abandoned (never-finalized)
		// sessions leave no object and are swept by the bucket lifecycle rule.
		try {
			await this.file(objectKey).delete({ ignoreNotFound: true });
		} catch (error) {
			if (statusCode(error) === 404) {
				return;
			}
			throw error;
		}
		logger.debug('GcsStorage: aborted/cleaned object', { bucket: this.bucketName, objectKey });
	}

	createReadStream(objectKey: string): Readable {
		logger.debug('GcsStorage: opening read stream', { bucket: this.bucketName, objectKey });
		return this.file(objectKey).createReadStream();
	}
}
