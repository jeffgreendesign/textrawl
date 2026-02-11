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
