/**
 * Custom error classes for Textrawl
 */

export class TextrawlError extends Error {
	public readonly statusCode: number;
	public readonly code: string;

	constructor(message: string, statusCode = 500, code = 'INTERNAL_ERROR') {
		super(message);
		this.name = 'TextrawlError';
		this.statusCode = statusCode;
		this.code = code;
		Error.captureStackTrace(this, this.constructor);
	}
}

export class NotFoundError extends TextrawlError {
	constructor(message = 'Resource not found') {
		super(message, 404, 'NOT_FOUND');
		this.name = 'NotFoundError';
	}
}

export class ValidationError extends TextrawlError {
	constructor(message = 'Validation failed') {
		super(message, 400, 'VALIDATION_ERROR');
		this.name = 'ValidationError';
	}
}

export class UnsupportedFileTypeError extends TextrawlError {
	constructor(message = 'Unsupported file type') {
		super(message, 400, 'UNSUPPORTED_TYPE');
		this.name = 'UnsupportedFileTypeError';
	}
}

export class AuthenticationError extends TextrawlError {
	constructor(message = 'Authentication required') {
		super(message, 401, 'AUTHENTICATION_ERROR');
		this.name = 'AuthenticationError';
	}
}

export class AuthorizationError extends TextrawlError {
	constructor(message = 'Access denied') {
		super(message, 403, 'AUTHORIZATION_ERROR');
		this.name = 'AuthorizationError';
	}
}

export class FileTooLargeError extends TextrawlError {
	constructor(message = 'File exceeds the maximum upload size') {
		super(message, 413, 'FILE_TOO_LARGE');
		this.name = 'FileTooLargeError';
	}
}

/**
 * An upload-session operation was attempted from a state that does not allow it
 * — an illegal state-machine transition or a concurrent (compare-and-swap)
 * conflict. Distinct from {@link ValidationError} (bad input, 400) so callers and
 * the error middleware surface a 409 with a stable `INVALID_STATE` code.
 */
export class InvalidUploadStateError extends TextrawlError {
	constructor(message = 'Invalid upload state transition') {
		super(message, 409, 'INVALID_STATE');
		this.name = 'InvalidUploadStateError';
	}
}

/** The caller's owner-token hash does not match the upload's recorded owner. */
export class ForbiddenOwnerError extends TextrawlError {
	constructor(message = 'You do not own this upload') {
		super(message, 403, 'FORBIDDEN_OWNER');
		this.name = 'ForbiddenOwnerError';
	}
}

/** The upload session's TTL elapsed before it was completed. */
export class UploadExpiredError extends TextrawlError {
	constructor(message = 'Upload session has expired') {
		super(message, 410, 'UPLOAD_EXPIRED');
		this.name = 'UploadExpiredError';
	}
}

/**
 * `/complete` was called but no object exists at the upload's storage key — the
 * client has not finished (or never started) the resumable PUT. A 409 conflict
 * with the stored reality, retryable once the bytes actually land.
 */
export class ObjectNotFoundError extends TextrawlError {
	constructor(message = 'Uploaded object not found in storage') {
		super(message, 409, 'OBJECT_NOT_FOUND');
		this.name = 'ObjectNotFoundError';
	}
}

/** The stored object's size does not match the size declared at `/init`. */
export class SizeMismatchError extends TextrawlError {
	constructor(message = 'Uploaded object size does not match the declared size') {
		super(message, 409, 'SIZE_MISMATCH');
		this.name = 'SizeMismatchError';
	}
}

/**
 * The SHA-256 computed by streaming the stored object during processing does not
 * match the `checksum_expected` the client supplied. A 422 (the bytes are
 * intact but fail integrity verification); raised before any document is created.
 */
export class ChecksumMismatchError extends TextrawlError {
	constructor(message = 'Uploaded object checksum does not match the expected value') {
		super(message, 422, 'CHECKSUM_MISMATCH');
		this.name = 'ChecksumMismatchError';
	}
}

/**
 * A ZIP entry resolves to no supported handler (unknown extension, or its
 * content does not match its extension). Per-entry and non-fatal — the entry is
 * recorded `skipped` and the archive continues. 400.
 */
export class UnsupportedEntryError extends TextrawlError {
	constructor(message = 'Unsupported archive entry') {
		super(message, 400, 'UNSUPPORTED_ENTRY');
		this.name = 'UnsupportedEntryError';
	}
}

/**
 * A ZIP entry has an unsafe path: `../` traversal, an absolute path or Windows
 * drive prefix, a backslash separator, a symlink/non-regular entry, or a name
 * exceeding `ZIP_MAX_FILENAME_LEN`. Archive-level — fails the whole upload
 * before any document is created. 400.
 */
export class ZipPathTraversalError extends TextrawlError {
	constructor(message = 'Archive contains an unsafe entry path') {
		super(message, 400, 'ZIP_PATH_TRAVERSAL');
		this.name = 'ZipPathTraversalError';
	}
}

/**
 * The archive trips a zip-bomb guard: total expanded size, compressed size, or
 * the expanded/compressed ratio exceeds its configured limit. Archive-level. 413.
 */
export class ZipBombError extends TextrawlError {
	constructor(message = 'Archive exceeds safe expansion limits') {
		super(message, 413, 'ZIP_BOMB');
		this.name = 'ZipBombError';
	}
}

/** The archive holds more entries than `ZIP_MAX_ENTRIES`. Archive-level. 400. */
export class ZipTooManyEntriesError extends TextrawlError {
	constructor(message = 'Archive contains too many entries') {
		super(message, 400, 'ZIP_TOO_MANY_ENTRIES');
		this.name = 'ZipTooManyEntriesError';
	}
}

/** A single entry's uncompressed size exceeds `ZIP_MAX_ENTRY_BYTES`. Archive-level. 413. */
export class ZipEntryTooLargeError extends TextrawlError {
	constructor(message = 'Archive entry exceeds the maximum entry size') {
		super(message, 413, 'ZIP_ENTRY_TOO_LARGE');
		this.name = 'ZipEntryTooLargeError';
	}
}

/** The archive nests another archive (`.zip`/`.tar`/`.gz`/`.7z`…), unsupported in MVP. Archive-level. 400. */
export class ZipNestedArchiveError extends TextrawlError {
	constructor(message = 'Nested archives are not supported') {
		super(message, 400, 'ZIP_NESTED_ARCHIVE');
		this.name = 'ZipNestedArchiveError';
	}
}

/** The archive contains no entries that resolve to a supported handler. Archive-level. 422. */
export class ZipNoSupportedEntriesError extends TextrawlError {
	constructor(message = 'Archive contains no supported files') {
		super(message, 422, 'ZIP_NO_SUPPORTED_ENTRIES');
		this.name = 'ZipNoSupportedEntriesError';
	}
}

/**
 * A single document produced more chunks than `MAX_CHUNKS_HARD_CAP` allows.
 * Raised by the chunker before any embedding/DB work so a pathological or
 * oversized input cannot create unbounded chunks, embeddings, or rows. Per-entry
 * in the ZIP path (the entry is recorded `failed` and the archive continues);
 * fails the whole upload in the single-file path. 413.
 */
export class ChunkLimitError extends TextrawlError {
	public readonly chunkCount: number;
	public readonly limit: number;

	constructor(chunkCount: number, limit: number) {
		super(
			`Document produced more than ${limit} chunks (cap: MAX_CHUNKS_HARD_CAP). Split the document or raise the limit.`,
			413,
			'CHUNK_LIMIT_EXCEEDED',
		);
		this.name = 'ChunkLimitError';
		this.chunkCount = chunkCount;
		this.limit = limit;
	}
}

export class DatabaseError extends TextrawlError {
	constructor(message = 'Database operation failed') {
		super(message, 500, 'DATABASE_ERROR');
		this.name = 'DatabaseError';
	}
}

export class ExternalServiceError extends TextrawlError {
	constructor(message = 'External service unavailable') {
		super(message, 502, 'EXTERNAL_SERVICE_ERROR');
		this.name = 'ExternalServiceError';
	}
}

export class ServiceUnavailableError extends TextrawlError {
	constructor(message = 'Service temporarily unavailable') {
		super(message, 503, 'SERVICE_UNAVAILABLE');
		this.name = 'ServiceUnavailableError';
	}
}

/**
 * A non-OK HTTP response from an external provider (e.g. Ollama's raw `fetch`
 * path, which has no SDK to surface a status). The upstream HTTP status is
 * stored as `statusCode` so retry classification (`withRetry`) can decide
 * whether to back off (429/5xx) or fail fast (4xx).
 */
export class ProviderHttpError extends TextrawlError {
	constructor(message: string, upstreamStatus: number) {
		super(message, upstreamStatus, 'PROVIDER_HTTP_ERROR');
		this.name = 'ProviderHttpError';
	}
}
