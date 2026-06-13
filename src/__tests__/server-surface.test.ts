import { afterEach, describe, expect, it, vi } from 'vitest';

/**
 * Verifies that MCP_TOOLSET / EXPOSE_ADMIN_TOOLS advertise the expected tool
 * surface. Each case resets the module graph so the cached config singleton
 * re-reads the stubbed environment.
 */
async function toolsFor(env: Record<string, string>): Promise<string[]> {
	vi.resetModules();
	vi.stubEnv('NODE_ENV', 'test');
	// Clear gating vars unless overridden.
	const base: Record<string, string> = {
		MCP_TOOLSET: 'normal',
		EXPOSE_ADMIN_TOOLS: 'false',
		ENABLE_MEMORY: 'true',
		ENABLE_CONVERSATIONS: 'true',
		ENABLE_INSIGHTS: 'true',
		DATABASE_URL: '',
	};
	for (const [k, v] of Object.entries({ ...base, ...env })) vi.stubEnv(k, v);

	const { createMcpServer } = await import('../server.js');
	const server = createMcpServer();
	const registered = (server as unknown as { _registeredTools: Record<string, unknown> })
		._registeredTools;
	return Object.keys(registered).sort();
}

describe('MCP tool surfaces', () => {
	afterEach(() => vi.unstubAllEnvs());

	it('normal surface exposes only the 7 workflow tools', async () => {
		const tools = await toolsFor({ MCP_TOOLSET: 'normal' });
		expect(tools).toEqual(
			['ask', 'capture', 'daily_briefing', 'get_document', 'remember', 'search', 'timeline'].sort(),
		);
	});

	it('normal + EXPOSE_ADMIN_TOOLS adds read-only diagnostics, not destructive tools', async () => {
		const tools = await toolsFor({
			MCP_TOOLSET: 'normal',
			EXPOSE_ADMIN_TOOLS: 'true',
			DATABASE_URL: 'postgres://x',
		});
		expect(tools).toContain('health_check');
		expect(tools).toContain('get_stats');
		expect(tools).toContain('pg_analyze');
		// Destructive tools stay out of the normal surface.
		expect(tools).not.toContain('forget_entity');
		expect(tools).not.toContain('delete_conversation');
	});

	it('full surface includes workflow + granular + admin tools', async () => {
		const tools = await toolsFor({ MCP_TOOLSET: 'full', DATABASE_URL: 'postgres://x' });
		// Workflow tools
		expect(tools).toContain('capture');
		expect(tools).toContain('remember');
		// Original granular tools
		expect(tools).toContain('add_note');
		expect(tools).toContain('save_url');
		expect(tools).toContain('remember_fact');
		expect(tools).toContain('list_documents');
		expect(tools).toContain('forget_entity');
		// get_document registered exactly once (no duplicate-registration crash)
		expect(tools.filter((t) => t === 'get_document')).toHaveLength(1);
	});

	it('legacy surface is the original set without workflow tools', async () => {
		const tools = await toolsFor({ MCP_TOOLSET: 'legacy', DATABASE_URL: 'postgres://x' });
		expect(tools).toContain('add_note');
		expect(tools).toContain('save_url');
		expect(tools).toContain('get_document');
		// No new workflow tools
		expect(tools).not.toContain('capture');
		expect(tools).not.toContain('remember');
	});

	it('normal surface drops the remember tool when memory is disabled', async () => {
		const tools = await toolsFor({ MCP_TOOLSET: 'normal', ENABLE_MEMORY: 'false' });
		expect(tools).not.toContain('remember');
		expect(tools).toContain('capture');
	});
});
