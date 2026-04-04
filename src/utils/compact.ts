import { config } from './config.js';
import { TextrawlError } from './errors.js';
import { logger } from './logger.js';

// --- Error classification ---

export type ErrorCode =
	| 'RUNTIME_ERROR'
	| 'CONFIG_ERROR'
	| 'SCHEMA_ERROR'
	| 'VALIDATION_ERROR'
	| 'DATABASE_ERROR'
	| 'NOT_FOUND'
	| 'EXTERNAL_SERVICE_ERROR';

const TEXTRAWL_CODE_MAP: Record<string, ErrorCode> = {
	DATABASE_ERROR: 'DATABASE_ERROR',
	VALIDATION_ERROR: 'VALIDATION_ERROR',
	NOT_FOUND: 'NOT_FOUND',
	EXTERNAL_SERVICE_ERROR: 'EXTERNAL_SERVICE_ERROR',
	SERVICE_UNAVAILABLE: 'EXTERNAL_SERVICE_ERROR',
	AUTHENTICATION_ERROR: 'VALIDATION_ERROR',
	AUTHORIZATION_ERROR: 'VALIDATION_ERROR',
};

export function classifyError(error: unknown): ErrorCode {
	if (error instanceof TextrawlError) {
		return TEXTRAWL_CODE_MAP[error.code] ?? 'RUNTIME_ERROR';
	}
	if (error instanceof Error) {
		const msg = error.message.toLowerCase();
		if (msg.includes('not configured') || msg.includes('not set')) return 'CONFIG_ERROR';
		if (msg.includes('does not exist') || msg.includes('schema')) return 'SCHEMA_ERROR';
	}
	return 'RUNTIME_ERROR';
}

// --- Serialization ---

/**
 * Recursively serialize non-JSON-safe values:
 * - Date -> ISO 8601 string (or null for invalid dates)
 * - BigInt -> number
 * - Buffer -> base64 string
 * - undefined -> null
 */
export function serializeResponse<T>(obj: T): T {
	if (obj === undefined) return null as T;
	if (obj instanceof Date) {
		const ts = obj.getTime();
		return (Number.isNaN(ts) ? null : obj.toISOString()) as T;
	}
	if (typeof obj === 'bigint') return Number(obj) as T;
	if (typeof Buffer !== 'undefined' && Buffer.isBuffer(obj)) return obj.toString('base64') as T;
	if (Array.isArray(obj)) return obj.map(serializeResponse) as T;
	if (obj !== null && typeof obj === 'object') {
		const result: Record<string, unknown> = {};
		for (const [key, value] of Object.entries(obj as Record<string, unknown>)) {
			result[key] = serializeResponse(value);
		}
		return result as T;
	}
	return obj;
}

/** @deprecated Use serializeResponse */
export const serializeDates = serializeResponse;

// --- Formatting helpers ---

export const isCompact = () => config.COMPACT_RESPONSES;

export function toJSON(obj: unknown): string {
	return isCompact() ? JSON.stringify(obj) : JSON.stringify(obj, null, 2);
}

export function formatId(uuid: string): string {
	return isCompact() ? uuid.slice(0, 8) : uuid;
}

// --- Tool responses ---

/**
 * Return an MCP tool error response with isError: true.
 * Per MCP spec, isError signals to the client that the response is an error
 * and the LLM should NOT blindly retry the same call.
 *
 * Supports two signatures:
 * - `toolError(message)` — legacy simple error
 * - `toolError(toolName, error, context?)` — structured error with classification
 */
export function toolError(message: string): {
	content: Array<{ type: 'text'; text: string }>;
	isError: true;
};
export function toolError(
	toolName: string,
	error: unknown,
	context?: { scope?: string; hint?: string },
): { content: Array<{ type: 'text'; text: string }>; isError: true };
export function toolError(
	messageOrTool: string,
	error?: unknown,
	context?: { scope?: string; hint?: string },
) {
	// Legacy single-arg form
	if (error === undefined) {
		return {
			content: [{ type: 'text' as const, text: toJSON({ error: messageOrTool }) }],
			isError: true as const,
		};
	}

	// Structured form
	const message = error instanceof Error ? error.message : String(error);
	const code = classifyError(error);

	logger.error(`${messageOrTool}: ${message}`, {
		tool: messageOrTool,
		scope: context?.scope,
		code,
		stack: error instanceof Error ? error.stack : undefined,
	});

	const payload: Record<string, unknown> = {
		error: true,
		tool: messageOrTool,
		message,
		code,
	};
	if (context?.scope) payload.scope = context.scope;
	if (context?.hint) payload.hint = context.hint;

	return {
		content: [{ type: 'text' as const, text: toJSON(payload) }],
		isError: true as const,
	};
}

/**
 * Return a configuration error (permanent failure — do not retry).
 */
export function configError(what: string, fix: string) {
	return {
		content: [
			{
				type: 'text' as const,
				text: toJSON({
					error: `${what} not configured`,
					code: 'CONFIG_ERROR' as ErrorCode,
					message: `${fix}. This is a server configuration issue — do not retry.`,
				}),
			},
		],
		isError: true,
	};
}

/**
 * Build a standard MCP tool response with compact/verbose branching.
 *
 * All values are passed through `serializeResponse()` to ensure Date, BigInt,
 * and Buffer values are converted to JSON-safe types.
 *
 * For read-only tools with outputSchema, pass `structuredContent` (always verbose,
 * canonical keys) so that clients receive both the text content and the typed object.
 */
export function toolResponse(opts: {
	compact: unknown;
	verbose: unknown;
	structuredContent?: Record<string, unknown>;
}) {
	const compact = serializeResponse(opts.compact);
	const verbose = serializeResponse(opts.verbose);
	const text = isCompact() ? JSON.stringify(compact) : JSON.stringify(verbose, null, 2);
	const result: {
		content: Array<{ type: 'text'; text: string }>;
		structuredContent?: Record<string, unknown>;
	} = {
		content: [{ type: 'text' as const, text }],
	};
	if (opts.structuredContent) {
		result.structuredContent = serializeResponse(opts.structuredContent);
	}
	return result;
}
