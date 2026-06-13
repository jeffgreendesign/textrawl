/**
 * Shared validation helper for the consolidated workflow tools.
 *
 * Per the MCP 2025-11-25 guidance (SEP-1303), input-validation failures are
 * returned as tool-execution errors (`isError: true`) — not protocol errors — so
 * the model receives actionable feedback it can self-correct from. The structured
 * envelope lists exactly which fields were missing.
 */
export function validationError(message: string, missingFields: string[] = []) {
	return {
		content: [
			{
				type: 'text' as const,
				text: JSON.stringify({
					ok: false,
					error: {
						code: 'validation_error',
						message,
						missing_fields: missingFields,
					},
				}),
			},
		],
		isError: true as const,
	};
}
