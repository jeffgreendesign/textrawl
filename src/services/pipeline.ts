import { shouldRunInsightScan } from '../db/insights.js';
import { config } from '../utils/config.js';
import { logger } from '../utils/logger.js';
import { events } from './events.js';
import { extractAndStoreMemories, isExtractionConfigured } from './memory-extraction.js';

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
): Promise<void> {
	logger.info('Pipeline: document ingested', { documentId, title, chunksCreated });

	// Emit event for WebSocket clients
	events.emit('document_ingested', { documentId, title, chunksCreated });

	// Auto-extract memories if configured
	if (config.ENABLE_MEMORY_EXTRACTION && isExtractionConfigured()) {
		try {
			const { extraction, storage } = await extractAndStoreMemories(content, 'document');
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
		} catch (error) {
			logger.error('Pipeline: memory extraction failed', {
				documentId,
				error: error instanceof Error ? error.message : String(error),
			});
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
