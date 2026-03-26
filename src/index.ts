import { StreamableHTTPServerTransport } from '@modelcontextprotocol/sdk/server/streamableHttp.js';
import cors from 'cors';
import express from 'express';
import helmet from 'helmet';
import { a2aRoutes } from './api/a2a.js';
import { bearerAuth } from './api/middleware/auth.js';
import { errorHandler } from './api/middleware/error.js';
import { apiLimiter, healthLimiter } from './api/middleware/rateLimit.js';
import { apiRoutes } from './api/routes.js';
import { statusRouter } from './api/status.js';
import { checkDatabaseConnection, isSupabaseConfigured } from './db/client.js';
import { createMcpServer } from './server.js';
import { isOpenAIConfigured } from './services/embeddings.js';
import { config } from './utils/config.js';
import { logger } from './utils/logger.js';

const app = express();

// Trust proxy for accurate IP detection in cloud environments (Cloud Run, K8s, etc.)
// Use 1 hop in production (behind single load balancer), disable in development
app.set('trust proxy', config.NODE_ENV === 'production' ? 1 : false);

// Security middleware — skip helmet for dashboard (sets its own nonce-based CSP)
app.use((req, res, next) => {
	if (req.path === '/status/dashboard') {
		next();
	} else {
		helmet()(req, res, next);
	}
});

// CORS configuration with proper validation
const getAllowedOrigins = (): string[] | false => {
	const origins = process.env.ALLOWED_ORIGINS;
	// Return false (no CORS) if not configured or empty
	if (!origins || origins.trim() === '') {
		return false;
	}
	// Split and trim each origin, filter empty strings
	return origins
		.split(',')
		.map((o) => o.trim())
		.filter(Boolean);
};

app.use(
	cors({
		origin: getAllowedOrigins(),
		methods: ['GET', 'POST'],
	}),
);

// Middleware
app.use(express.json({ limit: '1mb' }));
app.use('/api', apiLimiter);

// OAuth routes (no auth middleware - these ARE the auth flow)
if (config.GOOGLE_CLIENT_ID) {
	const { oauthRoutes } = await import('./api/oauth/routes.js');
	app.use(oauthRoutes);
	logger.info('OAuth routes enabled');
}

// Health check endpoints (rate-limited to prevent DoS)
app.get('/health', healthLimiter, (_req, res) => {
	res.json({
		status: 'ok',
		service: 'textrawl',
		timestamp: new Date().toISOString(),
	});
});

app.get('/health/ready', healthLimiter, async (_req, res) => {
	const dbConfigured = isSupabaseConfigured();

	let dbConnected = false;
	if (dbConfigured) {
		dbConnected = await checkDatabaseConnection();
	}

	const allReady = !dbConfigured || dbConnected;

	// Return minimal status without exposing configuration details
	res.status(allReady ? 200 : 503).json({
		status: allReady ? 'ready' : 'not_ready',
	});
});

app.get('/health/live', healthLimiter, (_req, res) => {
	res.json({ status: 'live' });
});

// A2A Agent-to-Agent protocol routes (rate-limited since not under /api)
app.use(apiLimiter, a2aRoutes);

// Service monitoring dashboard (rate-limited, no auth)
app.use(healthLimiter, statusRouter);

// MCP endpoint - Streamable HTTP transport (stateless mode for Cloud Run)
// Protected with rate limiting and authentication
app.all('/mcp', apiLimiter, bearerAuth, async (req, res) => {
	logger.debug('MCP request received', { method: req.method });

	try {
		// Create a new transport for each request (stateless mode)
		const transport = new StreamableHTTPServerTransport({
			sessionIdGenerator: undefined, // Stateless mode - no session persistence
		});

		// Create MCP server and connect to transport
		const server = createMcpServer();
		await server.connect(transport);

		// Handle the request
		await transport.handleRequest(req, res, req.body);
	} catch (error) {
		logger.error('MCP request failed', {
			error: error instanceof Error ? error.message : String(error),
		});

		// Return JSON-RPC error response
		if (!res.headersSent) {
			res.status(500).json({
				jsonrpc: '2.0',
				error: {
					code: -32603,
					message: 'Internal server error',
				},
				id: null,
			});
		}
	}
});

// API routes (file upload)
app.use('/api', apiRoutes);

// Error handling
app.use(errorHandler);

// Start server
const port = config.PORT;

const server = app.listen(port, async () => {
	logger.info('Textrawl server started', {
		port,
		env: config.NODE_ENV,
		mcpEndpoint: '/mcp',
	});

	// Set up WebSocket for real-time events
	try {
		const { setupWebSocket } = await import('./api/websocket.js');
		setupWebSocket(server);
	} catch (error) {
		logger.error('WebSocket setup failed', {
			error: error instanceof Error ? error.message : String(error),
		});
	}
});
