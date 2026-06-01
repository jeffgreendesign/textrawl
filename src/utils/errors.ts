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
