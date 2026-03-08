import { createRequire } from 'node:module';
import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { registerConversationTools } from './tools/conversation.js';
import { registerDocumentTools } from './tools/document.js';
import { registerInsightTools } from './tools/insights.js';
import { registerMemoryTools } from './tools/memory.js';
import { registerNoteTool } from './tools/note.js';
import { registerPgAnalyzeTools } from './tools/pg-analyze.js';
import { registerSearchTool } from './tools/search.js';
import { registerStatsTools } from './tools/stats.js';
import { getKnowledgeStatsHTML, getSearchResultsHTML } from './ui/index.js';
import { config } from './utils/config.js';
import { logger } from './utils/logger.js';

const require = createRequire(import.meta.url);
const { version: PKG_VERSION } = require('../package.json');

/**
 * Register UI resources for MCP Apps
 *
 * These resources provide interactive HTML UIs for tool results.
 */
function registerUIResources(server: McpServer): void {
	// Search results UI
	server.registerResource(
		'search-results-ui',
		'ui://textrawl/search-results',
		{
			description: 'Interactive search results viewer',
			mimeType: 'text/html;profile=mcp-app',
		},
		async () => ({
			contents: [
				{
					uri: 'ui://textrawl/search-results',
					mimeType: 'text/html;profile=mcp-app',
					text: getSearchResultsHTML(),
				},
			],
		}),
	);

	// Knowledge stats UI
	server.registerResource(
		'knowledge-stats-ui',
		'ui://textrawl/knowledge-stats',
		{
			description: 'Knowledge base statistics dashboard',
			mimeType: 'text/html;profile=mcp-app',
		},
		async () => ({
			contents: [
				{
					uri: 'ui://textrawl/knowledge-stats',
					mimeType: 'text/html;profile=mcp-app',
					text: getKnowledgeStatsHTML(),
				},
			],
		}),
	);

	logger.debug('Registered UI resources for MCP Apps');
}

/**
 * Create and configure the Textrawl MCP server
 */
export function createMcpServer(): McpServer {
	const server = new McpServer({
		name: 'textrawl',
		version: PKG_VERSION,
	});

	logger.debug('Registering MCP tools');

	// Register UI resources for MCP Apps
	registerUIResources(server);

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

	// Register conversation tools (feature flagged)
	if (config.ENABLE_CONVERSATIONS) {
		registerConversationTools(server);
		logger.info('Conversation tools enabled');
	} else {
		logger.info('Conversation tools disabled (ENABLE_CONVERSATIONS=false)');
	}

	// Register insight tools (feature flagged)
	if (config.ENABLE_INSIGHTS) {
		registerInsightTools(server);
		logger.info('Insight tools enabled');
	} else {
		logger.info('Insight tools disabled (ENABLE_INSIGHTS=false)');
	}

	// Register Postgres analysis tools (gated on DATABASE_URL)
	if (config.DATABASE_URL) {
		registerPgAnalyzeTools(server);
		logger.info('Postgres analysis tools enabled');
	} else {
		logger.info('Postgres analysis tools disabled (DATABASE_URL not set)');
	}

	logger.info('MCP server created', {
		name: 'textrawl',
		version: PKG_VERSION,
		memoryEnabled: config.ENABLE_MEMORY,
		conversationsEnabled: config.ENABLE_CONVERSATIONS,
		insightsEnabled: config.ENABLE_INSIGHTS,
		pgAnalyzeEnabled: !!config.DATABASE_URL,
	});

	return server;
}
