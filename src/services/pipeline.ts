import { shouldRunInsightScan } from '../db/insights.js';
import { config } from '../utils/config.js';
import { logger } from '../utils/logger.js';
import { events } from './events.js';
import { extractAndStoreMemories, isExtractionConfigured } from './memory-extraction.js';

export interface IngestionOptions {
	/**
	 * When provided, memory extraction runs as a background task handed to this
	 * collector instead of being awaited inline. Bulk ingestion (e.g. a ZIP of N
	 * entries) therefore does NOT serialize on a per-document LLM call — the caller
	 * collects the promises and awaits them once, after marking the upload terminal,
	 * so processing finishes fast while CPU stays allocated for the Cloud Task
	 * request. Omit it (the default) to await inline as before.
	 */
	deferMemory?: (work: Promise<void>) => void;
}

/**
 * Event-driven ingestion pipeline.
 * Called after a document is created and its chunks are stored.
 * Handles memory extraction and insight scan triggering.
 */
export async function onDocumentIngested(
	documentId: string,
	title: string,
	content: string,
	chunksCreated: number,
	opts: IngestionOptions = {},
): Promise<void> {
	logger.info('Pipeline: document ingested', { documentId, title, chunksCreated });

	// Emit event for WebSocket clients
	events.emit('document_ingested', { documentId, title, chunksCreated });

	// Auto-extract memories if configured. This is an LLM call (~1-3s); keep it off
	// the per-document critical path when the caller supplies `deferMemory`.
	if (config.ENABLE_MEMORY_EXTRACTION && isExtractionConfigured()) {
		const memoryWork = extractAndStoreMemories(content, 'document')
			.then(({ extraction, storage }) => {
				logger.info('Pipeline: memories extracted', {
					documentId,
					entitiesFound: extraction.entities.length,
					observationsCreated: storage.observationsCreated,
				});
				events.emit('extraction_complete', {
					documentId,
					entitiesFound: extraction.entities.length,
					relationsFound: extraction.relations.length,
				});
			})
			.catch((error) => {
				logger.error('Pipeline: memory extraction failed', {
					documentId,
					error: error instanceof Error ? error.message : String(error),
				});
			});
		if (opts.deferMemory) {
			opts.deferMemory(memoryWork);
		} else {
			await memoryWork;
		}
	}

	// Check if insight scan should run
	if (config.ENABLE_INSIGHTS) {
		try {
			const { shouldScan } = await shouldRunInsightScan(
				config.INSIGHT_BATCH_THRESHOLD,
				config.INSIGHT_DEBOUNCE_SECONDS,
			);
			if (shouldScan) {
				// Dynamic import to avoid circular dependency
				const { runInsightScan } = await import('./insight-analysis.js');
				runInsightScan().catch((err) =>
					logger.error('Pipeline: background insight scan failed', {
						error: err instanceof Error ? err.message : String(err),
					}),
				);
			}
		} catch (error) {
			logger.error('Pipeline: insight scan check failed', {
				error: error instanceof Error ? error.message : String(error),
			});
		}
	}
}
