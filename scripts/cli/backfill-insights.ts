#!/usr/bin/env tsx
/**
 * Backfill proactive insights across the entire chunk corpus.
 *
 * The live scan (and the 6-hourly cron) only analyze the most-recent ~maxChunks
 * chunks per run, so older content never becomes the *subject* of an insight. And
 * because the LLM synthesis is capped per call (top connections/outliers → ≤10
 * insights), one giant scan would discard almost everything. This CLI instead pages
 * through the whole corpus in windows and runs the insight pipeline once per window,
 * extracting far more knowledge while keeping each LLM prompt small.
 *
 * It is I/O-bound: the vector search runs on Postgres, synthesis on Anthropic, and
 * embeddings on the provider — this process just orchestrates and awaits. Per-chunk
 * neighbor queries fan out with bounded concurrency so a slow connection isn't the
 * wall-clock bottleneck. It does NOT touch the insight queue, so it won't disturb the
 * incremental scheduler's last_scan_at / chunks_pending state.
 *
 * Usage:
 *   pnpm insights:backfill
 *   pnpm insights:backfill -- --window 400 --concurrency 8
 *   pnpm insights:backfill -- --max-windows 3          # cap for a quick test run
 *   pnpm insights:backfill -- --dedup-threshold 0.9
 */
import 'dotenv/config';
import { randomUUID } from 'node:crypto';
import { closePgPool, isDatabaseConfigured } from '../../src/db/pg-client.js';
import { isEmbeddingsConfigured } from '../../src/services/embeddings.js';
import { analyzeAndStoreInsights, fetchChunkWindow } from '../../src/services/insight-analysis.js';
import { config } from '../../src/utils/config.js';
import { logger } from '../../src/utils/logger.js';

function numberArg(name: string, fallback: number): number {
	const idx = process.argv.indexOf(name);
	if (idx === -1) return fallback;
	const value = Number(process.argv[idx + 1]);
	return Number.isFinite(value) ? value : fallback;
}

async function main(): Promise<void> {
	if (!isDatabaseConfigured()) {
		logger.error('DATABASE_URL is required', { hint: 'Set it in your .env file' });
		process.exitCode = 1;
		return;
	}
	if (!isEmbeddingsConfigured()) {
		logger.error('An embeddings provider must be configured', {
			hint: 'Set OPENAI_API_KEY, or EMBEDDING_PROVIDER=ollama/google with the matching key',
		});
		process.exitCode = 1;
		return;
	}
	if (!config.ANTHROPIC_API_KEY) {
		logger.warn('ANTHROPIC_API_KEY not set — falling back to rule-based synthesis (lower quality)');
	}

	const windowSize = numberArg('--window', 400);
	const concurrency = numberArg('--concurrency', 8);
	const maxWindows = numberArg('--max-windows', Number.POSITIVE_INFINITY);
	const dedupThreshold = numberArg('--dedup-threshold', 0.92);

	logger.info('Starting insight backfill', { windowSize, concurrency, maxWindows, dedupThreshold });

	let cursor: { createdAt: string; id: string } | undefined;
	let windows = 0;
	let totalChunks = 0;
	let totalInsights = 0;

	while (windows < maxWindows) {
		const chunks = await fetchChunkWindow(windowSize, cursor);
		if (chunks.length === 0) break;

		windows++;
		const result = await analyzeAndStoreInsights(chunks, randomUUID(), {
			concurrency,
			dedupThreshold,
		});

		totalChunks += result.chunksAnalyzed;
		totalInsights += result.insightsCreated;
		logger.info(
			`Window ${windows}: ${result.chunksAnalyzed} chunks → ${result.insightsCreated} insights ` +
				`(running total: ${totalInsights} insights / ${totalChunks} chunks)`,
		);

		const last = chunks[chunks.length - 1];
		cursor = { createdAt: last.created_at, id: last.id };

		// Fewer rows than requested means we reached the oldest chunk.
		if (chunks.length < windowSize) break;
	}

	logger.info(
		`Backfill complete: ${windows} window(s), ${totalChunks} chunks analyzed, ${totalInsights} insights created`,
	);
}

main()
	.catch((error) => {
		logger.error('Backfill failed', {
			error: error instanceof Error ? error.message : String(error),
		});
		process.exitCode = 1;
	})
	.finally(async () => {
		await closePgPool();
	});
