/**
 * Object-storage port for the large-upload workflow (plan §3/§4).
 *
 * This interface is deliberately shaped to match the planned GCS resumable
 * implementation (T3.1) so the in-memory fake used in T2.3 can be swapped for
 * real GCS without touching the upload-session router. Only the methods the
 * `/init` → `/complete` → `DELETE` lifecycle needs are declared here; streaming
 * reads for the processing worker arrive with the GCS impl in T3.x.
 */

/** Options for starting a resumable upload session. */
export interface StartResumableOptions {
	contentType?: string | null;
	/** Declared object size in bytes (used by fakes to simulate a completed PUT). */
	size: number;
	/**
	 * Browser `Origin` of the request. GCS binds it into the resumable session so
	 * the subsequent cross-origin PUTs from that origin are accepted. Optional:
	 * the in-memory fake ignores it, and server-to-server callers may omit it.
	 */
	origin?: string | null;
}

/** Result of opening a resumable session. */
export interface ResumableSession {
	/** URI the browser PUTs bytes to (GCS resumable session URI in production). */
	resumableUri: string;
	/** ISO 8601 expiry for the session. */
	expiresAt: string;
}

/** Cheap, metadata-only view of a stored object (no full read). */
export interface ObjectMetadata {
	size: number;
	generation: string;
	crc32c: string;
	etag: string;
}

export interface StorageService {
	/**
	 * Open a server-initiated resumable upload session for `objectKey`.
	 */
	startResumableSession(objectKey: string, opts: StartResumableOptions): Promise<ResumableSession>;

	/**
	 * Fetch cheap object metadata (size/generation/crc32c/etag), or null when the
	 * object does not exist. Used at `/complete` to verify the upload landed.
	 */
	headObject(objectKey: string): Promise<ObjectMetadata | null>;

	/**
	 * Abort an in-progress resumable session and/or schedule object cleanup.
	 * Idempotent: aborting an unknown/already-aborted key is a no-op.
	 */
	abortSession(objectKey: string): Promise<void>;
}
