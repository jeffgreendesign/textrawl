import { shouldRunInsightScan } from '../db/insights.js';
import { config } from '../utils/config.js';
import { logger } from '../utils/logger.js';
import { events } from './events.js';

const HOUR_MS = 60 * 60 * 1000;

/**
 * Background scheduler for autonomous tasks.
 * Runs periodic checks for insight scans and knowledge maintenance.
 */
export function startScheduler(): void {
	logger.info('Scheduler started', {
		insightIntervalHours: 6,
	});

	// Auto-insights: check every 6 hours
	setInterval(async () => {
		if (!config.ENABLE_INSIGHTS) return;

		try {
			const { shouldScan, pending } = await shouldRunInsightScan(
				config.INSIGHT_BATCH_THRESHOLD,
				config.INSIGHT_DEBOUNCE_SECONDS,
			);

			if (shouldScan) {
				logger.info('Scheduler: triggering insight scan', { pending });
				const { runInsightScan } = await import('./insight-analysis.js');
				const result = await runInsightScan();

				if (result) {
					events.emit('insight_discovered', {
						insightCount: result.insightsCreated ?? 0,
						batchId: result.batchId ?? 'scheduled',
					});
				}
			}
		} catch (error) {
			logger.error('Scheduler: insight scan failed', {
				error: error instanceof Error ? error.message : String(error),
			});
		}
	}, 6 * HOUR_MS);
}
