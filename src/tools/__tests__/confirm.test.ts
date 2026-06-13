import { beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('../../utils/logger.js', () => ({
	logger: { debug: vi.fn(), info: vi.fn(), warn: vi.fn(), error: vi.fn() },
}));

import { confirmDestructive } from '../lib/confirm.js';

function fakeServer(opts: {
	capabilities?: Record<string, unknown>;
	elicit?: (params: unknown) => Promise<unknown>;
}) {
	return {
		server: {
			getClientCapabilities: vi.fn(() => opts.capabilities),
			elicitInput: vi.fn(opts.elicit ?? (async () => ({ action: 'decline' }))),
		},
	} as never;
}

describe('confirmDestructive', () => {
	beforeEach(() => vi.clearAllMocks());

	it('falls back to confirm=true when the client lacks elicitation', async () => {
		const server = fakeServer({ capabilities: {} });
		const r = await confirmDestructive(server, { summary: 'delete X.', confirmParam: true });
		expect(r).toEqual({ confirmed: true, via: 'param' });
	});

	it('does not confirm when the client lacks elicitation and confirm=false', async () => {
		const server = fakeServer({ capabilities: {} });
		const r = await confirmDestructive(server, { summary: 'delete X.', confirmParam: false });
		expect(r).toEqual({ confirmed: false, via: 'unsupported' });
	});

	it('confirms via elicitation when the user accepts', async () => {
		const server = fakeServer({
			capabilities: { elicitation: {} },
			elicit: async () => ({ action: 'accept', content: { confirm: true } }),
		});
		const r = await confirmDestructive(server, { summary: 'delete X.', confirmParam: false });
		expect(r).toEqual({ confirmed: true, via: 'elicitation' });
	});

	it('does not confirm when the user declines elicitation (even if confirm=true)', async () => {
		const server = fakeServer({
			capabilities: { elicitation: {} },
			elicit: async () => ({ action: 'decline' }),
		});
		const r = await confirmDestructive(server, { summary: 'delete X.', confirmParam: true });
		expect(r).toEqual({ confirmed: false, via: 'declined' });
	});

	it('reports cancellation distinctly', async () => {
		const server = fakeServer({
			capabilities: { elicitation: {} },
			elicit: async () => ({ action: 'cancel' }),
		});
		const r = await confirmDestructive(server, { summary: 'delete X.', confirmParam: false });
		expect(r).toEqual({ confirmed: false, via: 'cancelled' });
	});

	it('falls back to the confirm parameter when elicitation throws', async () => {
		const server = fakeServer({
			capabilities: { elicitation: {} },
			elicit: async () => {
				throw new Error('transport closed');
			},
		});
		const r = await confirmDestructive(server, { summary: 'delete X.', confirmParam: true });
		expect(r).toEqual({ confirmed: true, via: 'param' });
	});

	it('does not confirm when elicitation throws and confirmParam=false (still param path)', async () => {
		const server = fakeServer({
			capabilities: { elicitation: {} },
			elicit: async () => {
				throw new Error('transport closed');
			},
		});
		const r = await confirmDestructive(server, { summary: 'delete X.', confirmParam: false });
		// Elicitation was attempted, so the decision source is the param path, not 'unsupported'.
		expect(r).toEqual({ confirmed: false, via: 'param' });
	});
});
