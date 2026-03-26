import type { Server } from 'node:http';
import { type WebSocket, WebSocketServer } from 'ws';
import { events, type TextrawlEvents } from '../services/events.js';
import { config } from '../utils/config.js';
import { logger } from '../utils/logger.js';

/**
 * Set up WebSocket server for real-time event streaming.
 * Clients connect and receive events as they happen.
 *
 * Authentication: pass the bearer token as a query parameter.
 * Example: ws://localhost:3000/ws?token=YOUR_TOKEN
 */
export function setupWebSocket(server: Server): void {
	const wss = new WebSocketServer({ noServer: true });

	server.on('upgrade', (request, socket, head) => {
		const url = new URL(request.url ?? '', `http://${request.headers.host}`);

		if (url.pathname !== '/ws') {
			socket.destroy();
			return;
		}

		// Authenticate via query param token
		const token = url.searchParams.get('token');
		if (config.API_BEARER_TOKEN && token !== config.API_BEARER_TOKEN) {
			socket.write('HTTP/1.1 401 Unauthorized\r\n\r\n');
			socket.destroy();
			return;
		}

		wss.handleUpgrade(request, socket, head, (ws) => {
			wss.emit('connection', ws, request);
		});
	});

	wss.on('connection', (ws: WebSocket) => {
		logger.info('WebSocket client connected', {
			clients: wss.clients.size,
		});

		ws.on('close', () => {
			logger.debug('WebSocket client disconnected', {
				clients: wss.clients.size,
			});
		});
	});

	// Forward all Textrawl events to connected WebSocket clients
	const eventNames: Array<keyof TextrawlEvents> = [
		'document_ingested',
		'upload_progress',
		'extraction_complete',
		'insight_discovered',
	];

	for (const eventName of eventNames) {
		events.on(eventName, (data) => {
			const message = JSON.stringify({ event: eventName, data });
			for (const client of wss.clients) {
				if (client.readyState === client.OPEN) {
					client.send(message);
				}
			}
		});
	}

	logger.info('WebSocket server initialized on /ws');
}
