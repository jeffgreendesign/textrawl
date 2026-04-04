import crypto from 'node:crypto';
import { Router, type Router as RouterType } from 'express';
import { checkDatabaseConnection, isDatabaseConfigured } from '../db/pg-client.js';
import { isEmbeddingsConfigured } from '../services/embeddings.js';
import { config } from '../utils/config.js';
import { checkTable, serverStartTime, timed } from '../utils/health-helpers.js';
import { logger } from '../utils/logger.js';

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

type ServiceStatus = 'operational' | 'degraded' | 'down' | 'disabled' | 'unchecked';

interface ServiceCheck {
	name: string;
	status: ServiceStatus;
	message?: string;
	latencyMs?: number;
}

interface ToolStatus {
	name: string;
	group: string;
	status: ServiceStatus;
	message?: string;
}

interface StatusResponse {
	overall: ServiceStatus;
	version: string;
	uptime: number;
	timestamp: string;
	services: ServiceCheck[];
	features: Record<string, boolean>;
	tools: ToolStatus[];
	embedding: {
		provider: string;
		model: string;
		configured: boolean;
	};
}

// ---------------------------------------------------------------------------
// Tool definitions (static list of all MCP tools)
// ---------------------------------------------------------------------------

interface ToolDef {
	name: string;
	group: string;
	featureFlag?: 'ENABLE_MEMORY' | 'ENABLE_CONVERSATIONS' | 'ENABLE_INSIGHTS';
	requiredTable?: string;
	requiresExtraction?: boolean;
}

const TOOL_DEFINITIONS: ToolDef[] = [
	// Core tools (always available)
	{ name: 'search', group: 'Document' },
	{ name: 'get_document', group: 'Document' },
	{ name: 'list_documents', group: 'Document' },
	{ name: 'update_document', group: 'Document' },
	{ name: 'add_note', group: 'Document' },
	{ name: 'get_stats', group: 'Stats' },
	{ name: 'health_check', group: 'Stats' },

	// Memory tools
	{
		name: 'remember_fact',
		group: 'Memory',
		featureFlag: 'ENABLE_MEMORY',
		requiredTable: 'memory_entities',
	},
	{
		name: 'build_knowledge',
		group: 'Memory',
		featureFlag: 'ENABLE_MEMORY',
		requiredTable: 'memory_entities',
	},
	{
		name: 'query_memory',
		group: 'Memory',
		featureFlag: 'ENABLE_MEMORY',
		requiredTable: 'memory_entities',
	},
	{
		name: 'relate_entities',
		group: 'Memory',
		featureFlag: 'ENABLE_MEMORY',
		requiredTable: 'memory_relations',
	},
	{
		name: 'forget_entity',
		group: 'Memory',
		featureFlag: 'ENABLE_MEMORY',
		requiredTable: 'memory_entities',
	},
	{
		name: 'extract_memories',
		group: 'Memory',
		featureFlag: 'ENABLE_MEMORY',
		requiredTable: 'memory_entities',
		requiresExtraction: true,
	},

	// Conversation tools
	{
		name: 'save_conversation_context',
		group: 'Conversation',
		featureFlag: 'ENABLE_CONVERSATIONS',
		requiredTable: 'conversation_sessions',
	},
	{
		name: 'query_conversations',
		group: 'Conversation',
		featureFlag: 'ENABLE_CONVERSATIONS',
		requiredTable: 'conversation_sessions',
	},
	{
		name: 'delete_conversation',
		group: 'Conversation',
		featureFlag: 'ENABLE_CONVERSATIONS',
		requiredTable: 'conversation_sessions',
	},

	// Insight tools
	{
		name: 'get_insights',
		group: 'Insight',
		featureFlag: 'ENABLE_INSIGHTS',
		requiredTable: 'proactive_insights',
	},
	{
		name: 'discover_connections',
		group: 'Insight',
		featureFlag: 'ENABLE_INSIGHTS',
		requiredTable: 'proactive_insights',
	},
	{
		name: 'dismiss_insight',
		group: 'Insight',
		featureFlag: 'ENABLE_INSIGHTS',
		requiredTable: 'proactive_insights',
	},
];

// ---------------------------------------------------------------------------
// Status route
// ---------------------------------------------------------------------------

export const statusRouter: RouterType = Router();

statusRouter.get('/status', async (_req, res) => {
	logger.debug('Status check requested');

	try {
		// --- Service checks ---
		const services: ServiceCheck[] = [];

		// 1. Database
		const dbConfigured = isDatabaseConfigured();
		if (dbConfigured) {
			const [dbConnected, dbLatency] = await timed(checkDatabaseConnection);
			services.push({
				name: 'Database',
				status: dbConnected ? 'operational' : 'down',
				message: dbConnected ? 'Connected' : 'Connection failed',
				latencyMs: dbLatency,
			});
		} else {
			services.push({
				name: 'Database',
				status: 'down',
				message: 'Not configured',
			});
		}

		// 2. Embeddings
		const embeddingsConfigured = isEmbeddingsConfigured();
		if (config.EMBEDDING_PROVIDER === 'ollama') {
			// Try to reach Ollama
			if (embeddingsConfigured) {
				try {
					const [response, latency] = await timed(async () =>
						fetch(`${config.OLLAMA_BASE_URL}/api/tags`, {
							signal: AbortSignal.timeout(5000),
						}),
					);
					services.push({
						name: 'Embeddings',
						status: response.ok ? 'operational' : 'degraded',
						message: response.ok
							? `Ollama (${config.OLLAMA_MODEL})`
							: `Ollama returned ${response.status}`,
						latencyMs: latency,
					});
				} catch {
					services.push({
						name: 'Embeddings',
						status: 'down',
						message: 'Cannot reach Ollama at configured URL',
					});
				}
			}
		} else if (config.EMBEDDING_PROVIDER === 'google') {
			services.push({
				name: 'Embeddings',
				status: embeddingsConfigured ? 'operational' : 'down',
				message: embeddingsConfigured
					? `Google AI (${config.GOOGLE_EMBEDDING_MODEL})`
					: 'Google AI API key not set',
			});
		} else {
			services.push({
				name: 'Embeddings',
				status: embeddingsConfigured ? 'operational' : 'down',
				message: embeddingsConfigured ? 'OpenAI configured' : 'OpenAI API key not set',
			});
		}

		// 3. Feature-specific table checks (run in parallel)
		const tableChecks = new Map<string, boolean>();
		const tablesToCheck = new Set<string>();
		for (const tool of TOOL_DEFINITIONS) {
			if (tool.requiredTable) tablesToCheck.add(tool.requiredTable);
		}

		if (dbConfigured && tablesToCheck.size > 0) {
			const entries = [...tablesToCheck];
			const results = await Promise.all(entries.map((t) => checkTable(t)));
			for (let i = 0; i < entries.length; i++) {
				tableChecks.set(entries[i], results[i]);
			}
		}

		// Memory schema
		if (config.ENABLE_MEMORY) {
			const memoryOk = tableChecks.get('memory_entities') ?? false;
			services.push({
				name: 'Memory Schema',
				status: memoryOk ? 'operational' : 'down',
				message: memoryOk ? 'Tables accessible' : 'Schema not initialized',
			});
		} else {
			services.push({
				name: 'Memory Schema',
				status: 'disabled',
				message: 'ENABLE_MEMORY=false',
			});
		}

		// Conversation schema
		if (config.ENABLE_CONVERSATIONS) {
			const convOk = tableChecks.get('conversation_sessions') ?? false;
			services.push({
				name: 'Conversation Schema',
				status: convOk ? 'operational' : 'down',
				message: convOk ? 'Tables accessible' : 'Schema not initialized',
			});
		} else {
			services.push({
				name: 'Conversation Schema',
				status: 'disabled',
				message: 'ENABLE_CONVERSATIONS=false',
			});
		}

		// Insights schema
		if (config.ENABLE_INSIGHTS) {
			const insightsOk = tableChecks.get('proactive_insights') ?? false;
			services.push({
				name: 'Insights Schema',
				status: insightsOk ? 'operational' : 'down',
				message: insightsOk ? 'Tables accessible' : 'Schema not initialized',
			});
		} else {
			services.push({
				name: 'Insights Schema',
				status: 'disabled',
				message: 'ENABLE_INSIGHTS=false',
			});
		}

		// --- Tool statuses ---
		const embeddingsService = services.find((s) => s.name === 'Embeddings');
		const embeddingsHealthy = embeddingsService?.status === 'operational';

		const tools: ToolStatus[] = TOOL_DEFINITIONS.map((def) => {
			// Check feature flag
			if (def.featureFlag && !config[def.featureFlag]) {
				return {
					name: def.name,
					group: def.group,
					status: 'disabled' as ServiceStatus,
					message: `${def.featureFlag}=false`,
				};
			}

			// Check extraction requirement
			if (def.requiresExtraction && !config.ENABLE_MEMORY_EXTRACTION) {
				return {
					name: def.name,
					group: def.group,
					status: 'disabled' as ServiceStatus,
					message: 'ENABLE_MEMORY_EXTRACTION=false',
				};
			}

			// Check database
			if (!dbConfigured) {
				return {
					name: def.name,
					group: def.group,
					status: 'down' as ServiceStatus,
					message: 'Database not configured',
				};
			}

			// Check required table
			if (def.requiredTable) {
				const tableOk = tableChecks.get(def.requiredTable) ?? false;
				if (!tableOk) {
					return {
						name: def.name,
						group: def.group,
						status: 'down' as ServiceStatus,
						message: `Table "${def.requiredTable}" not found`,
					};
				}
			}

			// Check embeddings for search-dependent tools
			if (def.name === 'search' || def.name === 'add_note') {
				if (!embeddingsConfigured) {
					return {
						name: def.name,
						group: def.group,
						status: 'degraded' as ServiceStatus,
						message: 'Embeddings not configured (full-text only)',
					};
				}
				if (!embeddingsHealthy) {
					return {
						name: def.name,
						group: def.group,
						status: 'degraded' as ServiceStatus,
						message: `Embeddings ${embeddingsService?.status ?? 'unavailable'} (full-text only)`,
					};
				}
			}

			return {
				name: def.name,
				group: def.group,
				status: 'operational' as ServiceStatus,
			};
		});

		// --- Overall status ---
		const dbDown = services.some((s) => s.name === 'Database' && s.status === 'down');
		const hasDegradedService = services.some((s) => s.status === 'degraded');
		const hasDownCoreTools = tools.some(
			(t) => t.status === 'down' && !t.group.match(/Memory|Conversation|Insight/),
		);

		let overall: ServiceStatus = 'operational';
		if (dbDown) {
			overall = 'down';
		} else if (hasDegradedService || hasDownCoreTools) {
			overall = 'degraded';
		}

		// --- Features ---
		const features: Record<string, boolean> = {
			memory: config.ENABLE_MEMORY,
			conversations: config.ENABLE_CONVERSATIONS,
			insights: config.ENABLE_INSIGHTS,
			memoryExtraction: config.ENABLE_MEMORY_EXTRACTION,
			compactResponses: config.COMPACT_RESPONSES,
			oauth: !!config.GOOGLE_CLIENT_ID,
		};

		// --- Embedding info ---
		const embeddingModelMap: Record<string, string> = {
			ollama: config.OLLAMA_MODEL,
			google: config.GOOGLE_EMBEDDING_MODEL,
			openai: 'text-embedding-3-small',
		};
		const embedding = {
			provider: config.EMBEDDING_PROVIDER,
			model: embeddingModelMap[config.EMBEDDING_PROVIDER] ?? 'unknown',
			configured: embeddingsConfigured,
		};

		const response: StatusResponse = {
			overall,
			version: '0.2.0',
			uptime: Math.round((Date.now() - serverStartTime) / 1000),
			timestamp: new Date().toISOString(),
			services,
			features,
			tools,
			embedding,
		};

		res.json(response);
	} catch (error) {
		logger.error('Status check failed', {
			error: error instanceof Error ? error.message : String(error),
		});
		res.status(500).json({
			overall: 'down',
			error: 'Status check failed',
			timestamp: new Date().toISOString(),
		});
	}
});

// ---------------------------------------------------------------------------
// Dashboard HTML
// ---------------------------------------------------------------------------

statusRouter.get('/status/dashboard', (_req, res) => {
	const nonce = crypto.randomBytes(16).toString('base64');
	res.setHeader('Content-Type', 'text/html; charset=utf-8');
	res.setHeader(
		'Content-Security-Policy',
		`default-src 'none'; script-src 'nonce-${nonce}'; style-src 'unsafe-inline'; connect-src 'self'; base-uri 'none'; form-action 'none'`,
	);
	res.send(getDashboardHTML(nonce));
});

function getDashboardHTML(nonce: string): string {
	return `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>Textrawl Service Monitor</title>
<style>
:root {
	--bg: #0f1117;
	--surface: #1a1d27;
	--surface-2: #242836;
	--border: #2e3345;
	--text: #e4e6ed;
	--text-dim: #8b8fa3;
	--green: #22c55e;
	--green-bg: rgba(34, 197, 94, 0.1);
	--yellow: #eab308;
	--yellow-bg: rgba(234, 179, 8, 0.1);
	--red: #ef4444;
	--red-bg: rgba(239, 68, 68, 0.1);
	--blue: #3b82f6;
	--blue-bg: rgba(59, 130, 246, 0.1);
	--gray: #6b7280;
	--gray-bg: rgba(107, 114, 128, 0.1);
	--radius: 8px;
	--font: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif;
	--mono: 'SF Mono', 'Fira Code', 'Fira Mono', monospace;
}

* { box-sizing: border-box; margin: 0; padding: 0; }

body {
	font-family: var(--font);
	background: var(--bg);
	color: var(--text);
	min-height: 100vh;
	padding: 24px;
}

.container { max-width: 960px; margin: 0 auto; }

header {
	display: flex;
	align-items: center;
	justify-content: space-between;
	margin-bottom: 32px;
	flex-wrap: wrap;
	gap: 12px;
}

h1 {
	font-size: 20px;
	font-weight: 600;
	letter-spacing: -0.02em;
}

.header-right {
	display: flex;
	align-items: center;
	gap: 12px;
}

.refresh-info {
	font-size: 12px;
	color: var(--text-dim);
	font-family: var(--mono);
}

.btn {
	background: var(--surface-2);
	border: 1px solid var(--border);
	color: var(--text);
	padding: 6px 14px;
	border-radius: var(--radius);
	font-size: 13px;
	cursor: pointer;
	font-family: var(--font);
	transition: background 0.15s;
}
.btn:hover { background: var(--border); }

/* Overall status banner */
.status-banner {
	padding: 20px 24px;
	border-radius: var(--radius);
	margin-bottom: 24px;
	display: flex;
	align-items: center;
	gap: 12px;
	border: 1px solid var(--border);
}
.status-banner.operational { background: var(--green-bg); border-color: var(--green); }
.status-banner.degraded { background: var(--yellow-bg); border-color: var(--yellow); }
.status-banner.down { background: var(--red-bg); border-color: var(--red); }
.status-banner.loading { background: var(--surface); }

.status-dot {
	width: 12px;
	height: 12px;
	border-radius: 50%;
	flex-shrink: 0;
}
.status-dot.operational { background: var(--green); box-shadow: 0 0 8px var(--green); }
.status-dot.degraded { background: var(--yellow); box-shadow: 0 0 8px var(--yellow); }
.status-dot.down { background: var(--red); box-shadow: 0 0 8px var(--red); }
.status-dot.disabled { background: var(--gray); }
.status-dot.unchecked { background: var(--gray); opacity: 0.5; }
.status-dot.loading { background: var(--text-dim); animation: pulse 1.5s infinite; }

@keyframes pulse {
	0%, 100% { opacity: 0.4; }
	50% { opacity: 1; }
}

.status-banner .label {
	font-size: 16px;
	font-weight: 600;
}

.status-banner .meta {
	font-size: 13px;
	color: var(--text-dim);
	margin-left: auto;
	font-family: var(--mono);
}

/* Sections */
.section {
	background: var(--surface);
	border: 1px solid var(--border);
	border-radius: var(--radius);
	margin-bottom: 16px;
	overflow: hidden;
}

.section-header {
	padding: 14px 20px;
	font-size: 13px;
	font-weight: 600;
	text-transform: uppercase;
	letter-spacing: 0.05em;
	color: var(--text-dim);
	border-bottom: 1px solid var(--border);
}

.row {
	display: flex;
	align-items: center;
	padding: 12px 20px;
	border-bottom: 1px solid var(--border);
	gap: 12px;
}
.row:last-child { border-bottom: none; }

.row .name {
	font-size: 14px;
	font-weight: 500;
	min-width: 180px;
	font-family: var(--mono);
}

.row .message {
	font-size: 13px;
	color: var(--text-dim);
	flex: 1;
}

.row .latency {
	font-size: 12px;
	color: var(--text-dim);
	font-family: var(--mono);
	min-width: 60px;
	text-align: right;
}

/* Feature badges */
.features {
	display: flex;
	flex-wrap: wrap;
	gap: 8px;
	padding: 16px 20px;
}

.badge {
	font-size: 12px;
	padding: 4px 10px;
	border-radius: 20px;
	font-family: var(--mono);
	font-weight: 500;
}
.badge.on { background: var(--green-bg); color: var(--green); border: 1px solid rgba(34, 197, 94, 0.3); }
.badge.off { background: var(--gray-bg); color: var(--gray); border: 1px solid rgba(107, 114, 128, 0.3); }

/* Tool grid */
.tool-grid {
	display: grid;
	grid-template-columns: repeat(auto-fill, minmax(200px, 1fr));
	gap: 1px;
	background: var(--border);
}

.tool-card {
	background: var(--surface);
	padding: 12px 16px;
	display: flex;
	align-items: center;
	gap: 10px;
}

.tool-card .name {
	font-size: 13px;
	font-family: var(--mono);
	font-weight: 500;
}

.tool-card .group-tag {
	font-size: 10px;
	color: var(--text-dim);
	margin-left: auto;
	text-transform: uppercase;
	letter-spacing: 0.05em;
}

/* Embedding info */
.embed-row {
	display: flex;
	align-items: center;
	padding: 14px 20px;
	gap: 16px;
	flex-wrap: wrap;
}

.embed-row .label {
	font-size: 12px;
	color: var(--text-dim);
	text-transform: uppercase;
	letter-spacing: 0.05em;
}

.embed-row .value {
	font-size: 14px;
	font-family: var(--mono);
}

/* Tooltip */
.tool-card[title] { cursor: help; }

/* Error state */
.error-banner {
	background: var(--red-bg);
	border: 1px solid var(--red);
	border-radius: var(--radius);
	padding: 16px 20px;
	margin-bottom: 24px;
	font-size: 14px;
}

/* Responsive */
@media (max-width: 640px) {
	body { padding: 12px; }
	.row .name { min-width: 120px; }
	.tool-grid { grid-template-columns: 1fr; }
	header { flex-direction: column; align-items: flex-start; }
}
</style>
</head>
<body>
<div class="container">
	<header>
		<h1>Textrawl Service Monitor</h1>
		<div class="header-right">
			<span class="refresh-info" id="lastCheck">Checking...</span>
			<button class="btn" id="refreshBtn">Refresh</button>
			<select class="btn" id="autoRefresh">
				<option value="0">Auto: Off</option>
				<option value="30">Auto: 30s</option>
				<option value="60" selected>Auto: 60s</option>
				<option value="300">Auto: 5m</option>
			</select>
		</div>
	</header>

	<div id="content">
		<div class="status-banner loading">
			<div class="status-dot loading"></div>
			<span class="label">Checking services...</span>
		</div>
	</div>
</div>

<script nonce="${nonce}">
let refreshTimer = null;
let lastData = null;

function formatUptime(seconds) {
	const d = Math.floor(seconds / 86400);
	const h = Math.floor((seconds % 86400) / 3600);
	const m = Math.floor((seconds % 3600) / 60);
	if (d > 0) return d + 'd ' + h + 'h ' + m + 'm';
	if (h > 0) return h + 'h ' + m + 'm';
	return m + 'm ' + (seconds % 60) + 's';
}

function statusLabel(s) {
	const map = {
		operational: 'Operational',
		degraded: 'Degraded',
		down: 'Down',
		disabled: 'Disabled',
		unchecked: 'Unchecked',
	};
	return map[s] || s;
}

function render(data) {
	lastData = data;
	const c = document.getElementById('content');

	let html = '';

	// Overall banner
	html += '<div class="status-banner ' + data.overall + '">';
	html += '<div class="status-dot ' + data.overall + '"></div>';
	html += '<span class="label">' + (data.overall === 'operational' ? 'All Systems Operational' : data.overall === 'degraded' ? 'Partial Service Degradation' : 'Service Disruption') + '</span>';
	html += '<span class="meta">v' + esc(data.version) + ' &middot; up ' + formatUptime(data.uptime) + '</span>';
	html += '</div>';

	// Services
	html += '<div class="section">';
	html += '<div class="section-header">Services</div>';
	for (const svc of data.services) {
		html += '<div class="row">';
		html += '<div class="status-dot ' + svc.status + '"></div>';
		html += '<span class="name">' + esc(svc.name) + '</span>';
		html += '<span class="message">' + esc(svc.message || statusLabel(svc.status)) + '</span>';
		if (svc.latencyMs !== undefined) {
			html += '<span class="latency">' + svc.latencyMs + 'ms</span>';
		}
		html += '</div>';
	}
	html += '</div>';

	// Embedding
	html += '<div class="section">';
	html += '<div class="section-header">Embedding Provider</div>';
	html += '<div class="embed-row">';
	html += '<div class="status-dot ' + (data.embedding.configured ? 'operational' : 'down') + '"></div>';
	html += '<div><span class="label">Provider</span> <span class="value">' + esc(data.embedding.provider) + '</span></div>';
	html += '<div><span class="label">Model</span> <span class="value">' + esc(data.embedding.model) + '</span></div>';
	html += '</div></div>';

	// Features
	html += '<div class="section">';
	html += '<div class="section-header">Feature Flags</div>';
	html += '<div class="features">';
	for (const [key, val] of Object.entries(data.features)) {
		html += '<span class="badge ' + (val ? 'on' : 'off') + '">' + esc(key) + ': ' + (val ? 'on' : 'off') + '</span>';
	}
	html += '</div></div>';

	// Tools
	const groups = {};
	for (const tool of data.tools) {
		if (!groups[tool.group]) groups[tool.group] = [];
		groups[tool.group].push(tool);
	}

	html += '<div class="section">';
	html += '<div class="section-header">MCP Tools (' + data.tools.length + ')</div>';
	html += '<div class="tool-grid">';
	for (const tool of data.tools) {
		const title = tool.message ? esc(tool.message) : statusLabel(tool.status);
		html += '<div class="tool-card" title="' + title + '">';
		html += '<div class="status-dot ' + tool.status + '"></div>';
		html += '<span class="name">' + esc(tool.name) + '</span>';
		html += '<span class="group-tag">' + esc(tool.group) + '</span>';
		html += '</div>';
	}
	html += '</div></div>';

	c.innerHTML = html;
}

function renderError(msg) {
	document.getElementById('content').innerHTML =
		'<div class="error-banner">Failed to fetch status: ' + esc(msg) + '</div>' +
		(lastData ? '' : '<div class="status-banner down"><div class="status-dot down"></div><span class="label">Cannot reach server</span></div>');
}

function esc(s) {
	if (!s) return '';
	const d = document.createElement('div');
	d.textContent = s;
	return d.innerHTML;
}

async function refresh() {
	const info = document.getElementById('lastCheck');
	info.textContent = 'Checking...';
	try {
		const r = await fetch('../status', { signal: AbortSignal.timeout(15000) });
		if (!r.ok) throw new Error('HTTP ' + r.status);
		const data = await r.json();
		render(data);
		info.textContent = 'Checked ' + new Date().toLocaleTimeString();
	} catch (e) {
		renderError(e.message);
		info.textContent = 'Error at ' + new Date().toLocaleTimeString();
	}
}

function setAutoRefresh(seconds) {
	if (refreshTimer) { clearInterval(refreshTimer); refreshTimer = null; }
	const s = parseInt(seconds, 10);
	if (s > 0) { refreshTimer = setInterval(refresh, s * 1000); }
}

// Bind event listeners
document.getElementById('refreshBtn').addEventListener('click', refresh);
document.getElementById('autoRefresh').addEventListener('change', function() {
	setAutoRefresh(this.value);
});

// Initial load
refresh();
setAutoRefresh(document.getElementById('autoRefresh').value);
</script>
</body>
</html>`;
}
