import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { registerDocumentTools } from './tools/document.js';
import { registerMemoryTools } from './tools/memory.js';
import { registerNoteTool } from './tools/note.js';
import { registerSearchTool } from './tools/search.js';
import { registerStatsTools } from './tools/stats.js';
import { config } from './utils/config.js';
import { logger } from './utils/logger.js';

/**
 * Create and configure the Textrawl MCP server
 */
export function createMcpServer(): McpServer {
	const server = new McpServer({
		name: 'textrawl',
		version: '0.2.0',
	});

	logger.debug('Registering MCP tools');

	// Register core tools (always available)
	registerSearchTool(server);
	registerDocumentTools(server);
	registerNoteTool(server);
	registerStatsTools(server);

	// Register memory tools (feature flagged)
	if (config.ENABLE_MEMORY) {
		registerMemoryTools(server);
		logger.info('Memory tools enabled');
	} else {
		logger.info('Memory tools disabled (ENABLE_MEMORY=false)');
	}

	logger.info('MCP server created', {
		name: 'textrawl',
		version: '0.2.0',
		memoryEnabled: config.ENABLE_MEMORY,
	});

	return server;
}
