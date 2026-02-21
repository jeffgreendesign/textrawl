import { config } from './config.js';

export const isCompact = () => config.COMPACT_RESPONSES;

export function toJSON(obj: unknown): string {
	return isCompact() ? JSON.stringify(obj) : JSON.stringify(obj, null, 2);
}

export function formatId(uuid: string): string {
	return isCompact() ? uuid.slice(0, 8) : uuid;
}

/**
 * Return an MCP tool error response with isError: true.
 * Per MCP spec, isError signals to the client that the response is an error
 * and the LLM should NOT blindly retry the same call.
 */
export function toolError(message: string) {
	return {
		content: [{ type: 'text' as const, text: toJSON({ error: message }) }],
		isError: true,
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
 * For read-only tools with outputSchema, pass `structuredContent` (always verbose,
 * canonical keys) so that clients receive both the text content and the typed object.
 *
 * @example
 * // Simple write tool
 * return toolResponse({
 *   compact: { ok: true, id: formatId(entity.id) },
 *   verbose: { success: true, entityId: entity.id, message: 'Created' },
 * });
 *
 * @example
 * // Read-only tool with outputSchema
 * const structured = { query, totalResults: results.length, results };
 * return toolResponse({
 *   compact: { n: results.length, r: results.map(r => ({ ... })) },
 *   verbose: structured,
 *   structuredContent: structured,
 * });
 */
export function toolResponse(opts: {
	compact: unknown;
	verbose: unknown;
	structuredContent?: Record<string, unknown>;
}) {
	const text = isCompact() ? JSON.stringify(opts.compact) : JSON.stringify(opts.verbose, null, 2);
	const result: {
		content: Array<{ type: 'text'; text: string }>;
		structuredContent?: Record<string, unknown>;
	} = {
		content: [{ type: 'text' as const, text }],
	};
	if (opts.structuredContent) {
		result.structuredContent = opts.structuredContent;
	}
	return result;
}
