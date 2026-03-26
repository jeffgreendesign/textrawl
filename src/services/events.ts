import { EventEmitter } from 'node:events';

/**
 * Typed event definitions for the Textrawl event system.
 */
export interface TextrawlEvents {
	document_ingested: { documentId: string; title: string; chunksCreated: number };
	upload_progress: { documentId: string; stage: string; progress: number };
	extraction_complete: { documentId: string; entitiesFound: number; relationsFound: number };
	insight_discovered: { insightCount: number; batchId: string };
}

type EventName = keyof TextrawlEvents;

class TextrawlEventEmitter {
	private emitter = new EventEmitter();

	emit<K extends EventName>(event: K, data: TextrawlEvents[K]): void {
		this.emitter.emit(event, data);
	}

	on<K extends EventName>(event: K, handler: (data: TextrawlEvents[K]) => void): void {
		this.emitter.on(event, handler);
	}

	off<K extends EventName>(event: K, handler: (data: TextrawlEvents[K]) => void): void {
		this.emitter.off(event, handler);
	}
}

/**
 * Global event emitter singleton.
 * Used to coordinate between the upload pipeline, WebSocket server, and scheduler.
 */
export const events = new TextrawlEventEmitter();
