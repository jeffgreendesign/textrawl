import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { registerSearchTool } from './tools/search.js';
import { registerDocumentTools } from './tools/document.js';
import { registerNoteTool } from './tools/note.js';
import { logger } from './utils/logger.js';

/**
 * Create and configure the Textrawl MCP server
 */
export function createMcpServer(): McpServer {
  const server = new McpServer({
    name: 'textrawl',
    version: '0.1.0',
  });

  logger.debug('Registering MCP tools');

  // Register all tools
  registerSearchTool(server);
  registerDocumentTools(server);
  registerNoteTool(server);

  logger.info('MCP server created', { name: 'textrawl', version: '0.1.0' });

  return server;
}
