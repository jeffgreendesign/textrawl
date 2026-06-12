import { shouldRunInsightScan } from '../db/insights.js';
import { config } from '../utils/config.js';
import { logger } from '../utils/logger.js';
import { events } from './events.js';
import { extractAndStoreMemories, isExtractionConfigured } from './memory-extraction.js';

export interface IngestionOptions {
	/**
	 * When provided, memory extraction is handed to this collector as a **thunk**
	 * (not started here) instead of being awaited inline. Bulk ingestion (e.g. a ZIP
	 * of N entries) therefore does NOT serialize on a per-document LLM call, but the
	 * caller controls when and how many run — it executes the thunks with bounded
	 * concurrency after marking the upload terminal, so a large archive cannot pile
	 * up N concurrent LLM calls + N retained documents and exhaust memory. Omit it
	 * (the default) to run inline as before.
	 */
	deferMemory?: (task: () => Promise<void>) => void;
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
		// Extraction truncates to ~30k chars internally; capture a slice (not a
		// multi-MB document) so a deferred thunk's retained memory stays flat even
		// across a large archive.
		const memoryInput = content.length > 30_000 ? content.slice(0, 30_000) : content;
		const runMemoryExtraction = (): Promise<void> =>
			extractAndStoreMemories(memoryInput, 'document')
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
			// Hand over the thunk (do NOT start it here) so the caller can bound how
			// many run at once — starting it eagerly would let a large archive pile up
			// N concurrent LLM calls and OOM the instance.
			opts.deferMemory(runMemoryExtraction);
		} else {
			await runMemoryExtraction();
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
