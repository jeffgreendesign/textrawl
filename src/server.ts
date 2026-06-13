import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { registerAskTool } from './tools/ask.js';
import { registerBriefingTool } from './tools/briefing.js';
import { registerCaptureTool } from './tools/capture.js';
import { registerConversationTools } from './tools/conversation.js';
import {
	registerDocumentManagementTools,
	registerDocumentTools,
	registerGetDocumentTool,
} from './tools/document.js';
import { registerHealthTool } from './tools/health.js';
import { registerInsightTools } from './tools/insights.js';
import { registerMemoryTools } from './tools/memory.js';
import { registerNoteTool } from './tools/note.js';
import { registerPgAnalyzeTools } from './tools/pg-analyze.js';
import { registerRememberTool } from './tools/remember.js';
import { registerSearchTool } from './tools/search.js';
import { registerStatsTools } from './tools/stats.js';
import { registerTimelineTool } from './tools/timeline.js';
import { registerUrlTool } from './tools/url.js';
import { getKnowledgeStatsHTML, getSearchResultsHTML } from './ui/index.js';
import { config } from './utils/config.js';
import { logger } from './utils/logger.js';

import pkg from '../package.json' with { type: 'json' };
const PKG_VERSION: string = pkg.version;

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

	const toolset = config.MCP_TOOLSET;
	// Effective admin-tools exposure (always on under legacy/full).
	const adminToolsExposed = toolset === 'legacy' || toolset === 'full' || config.EXPOSE_ADMIN_TOOLS;

	if (toolset === 'legacy') {
		// `legacy`: exactly the original tool set — strict backward compatibility.
		registerLegacyTools(server);
	} else {
		// `normal` (default) and `full` both advertise the compact workflow surface.
		registerWorkflowTools(server);

		// Admin/diagnostic tools: always under `full`, opt-in under `normal`.
		if (adminToolsExposed) {
			registerAdminTools(server);
		}

		// `full` additionally advertises the original granular tools for
		// backward compatibility (alongside the workflow surface).
		if (toolset === 'full') {
			registerLegacyGranularTools(server);
		}
	}

	logger.info('MCP server created', {
		name: 'textrawl',
		version: PKG_VERSION,
		toolset,
		exposeAdminTools: adminToolsExposed,
		memoryEnabled: config.ENABLE_MEMORY,
		conversationsEnabled: config.ENABLE_CONVERSATIONS,
		insightsEnabled: config.ENABLE_INSIGHTS,
		pgAnalyzeEnabled: !!config.DATABASE_URL,
	});

	return server;
}

/**
 * Compact workflow surface — the recommended model-facing tools for personal /
 * family assistants. Distinct, well-named, typed tools consolidated by workflow
 * (per Anthropic's tool-design guidance), not a single intent dispatcher.
 */
function registerWorkflowTools(server: McpServer): void {
	registerAskTool(server);
	registerSearchTool(server);
	registerGetDocumentTool(server);
	registerCaptureTool(server);
	registerBriefingTool(server);
	registerTimelineTool(server);

	if (config.ENABLE_MEMORY) {
		registerRememberTool(server);
		logger.info('Memory write tool (remember) enabled');
	} else {
		logger.info('Memory write tool (remember) disabled (ENABLE_MEMORY=false)');
	}
}

/**
 * Diagnostic/maintenance tools kept out of the default normal surface. Read-only
 * diagnostics and Postgres analysis — destructive operations live in the granular
 * tools (`full`/`legacy` only).
 */
function registerAdminTools(server: McpServer): void {
	registerHealthTool(server);
	registerStatsTools(server);

	if (config.ENABLE_INSIGHTS) {
		registerInsightTools(server);
		logger.info('Insight tools enabled');
	}

	if (config.DATABASE_URL) {
		registerPgAnalyzeTools(server);
		logger.info('Postgres analysis tools enabled');
	}
}

/**
 * Original granular tools (pre-consolidation). Advertised under `full` alongside
 * the workflow surface, and as the entire surface under `legacy`.
 */
function registerLegacyGranularTools(server: McpServer): void {
	registerDocumentManagementTools(server); // list_documents, update_document (get_document via workflow)
	registerNoteTool(server);
	registerUrlTool(server);

	if (config.ENABLE_MEMORY) {
		registerMemoryTools(server);
	}
	if (config.ENABLE_CONVERSATIONS) {
		registerConversationTools(server);
	}
}

/**
 * Exactly the pre-consolidation tool set (no workflow tools). Used by
 * `MCP_TOOLSET=legacy` for clients that must keep the original surface.
 */
function registerLegacyTools(server: McpServer): void {
	registerAskTool(server);
	registerSearchTool(server);
	registerDocumentTools(server);
	registerNoteTool(server);
	registerUrlTool(server);
	registerBriefingTool(server);
	registerTimelineTool(server);
	registerStatsTools(server);
	registerHealthTool(server);

	if (config.ENABLE_MEMORY) {
		registerMemoryTools(server);
		logger.info('Memory tools enabled');
	}
	if (config.ENABLE_CONVERSATIONS) {
		registerConversationTools(server);
		logger.info('Conversation tools enabled');
	}
	if (config.ENABLE_INSIGHTS) {
		registerInsightTools(server);
		logger.info('Insight tools enabled');
	}
	if (config.DATABASE_URL) {
		registerPgAnalyzeTools(server);
		logger.info('Postgres analysis tools enabled');
	}
}
