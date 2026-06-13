import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { logger } from '../../utils/logger.js';

export interface ConfirmResult {
	confirmed: boolean;
	/** How the decision was reached. */
	via: 'elicitation' | 'param' | 'declined' | 'cancelled' | 'unsupported';
}

/**
 * Confirm a destructive operation.
 *
 * Spec-aligned (MCP 2025-11-25): when the client advertises the `elicitation`
 * capability, request an explicit human confirmation via `elicitation/create`
 * (the accept/decline/cancel form flow). When the client does not support
 * elicitation, fall back to the model-supplied `confirm` boolean. Pairs with the
 * tool's `destructiveHint` annotation. Never requests secrets.
 */
export async function confirmDestructive(
	server: McpServer,
	opts: { summary: string; confirmParam: boolean },
): Promise<ConfirmResult> {
	const caps = server.server.getClientCapabilities();
	const canElicit = Boolean(caps?.elicitation);

	if (canElicit) {
		try {
			const res = await server.server.elicitInput({
				message: `Confirm: ${opts.summary} This cannot be undone.`,
				requestedSchema: {
					type: 'object',
					properties: {
						confirm: {
							type: 'boolean',
							title: 'Confirm deletion',
							description: 'Set to true to permanently delete. This cannot be undone.',
						},
					},
					required: ['confirm'],
				},
			});

			if (res.action === 'accept' && res.content?.confirm === true) {
				return { confirmed: true, via: 'elicitation' };
			}
			if (res.action === 'cancel') {
				return { confirmed: false, via: 'cancelled' };
			}
			return { confirmed: false, via: 'declined' };
		} catch (err) {
			// Client claimed support but failed — fall back to the confirm param.
			logger.warn('Elicitation failed; falling back to confirm parameter', {
				error: err instanceof Error ? err.message : String(err),
			});
		}
	}

	return {
		confirmed: opts.confirmParam === true,
		via: canElicit || opts.confirmParam ? 'param' : 'unsupported',
	};
}
