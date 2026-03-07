#!/usr/bin/env tsx
/**
 * CLI entry point for Postgres analysis.
 *
 * Usage:
 *   pnpm pg:analyze              Full markdown report to stdout
 *   pnpm pg:analyze -- --json    JSON output
 *   pnpm pg:analyze -- --save    Save to history directory
 *   pnpm pg:analyze -- --diff    Compare with last saved report
 */
import 'dotenv/config';
import { closePgPool, getPgPool } from '../../src/db/pg-client.js';
import { formatCompact, formatMarkdown } from '../../src/services/pg-analyze/formatter.js';
import {
	compareReports,
	formatDiff,
	getHistory,
	saveReport,
} from '../../src/services/pg-analyze/history.js';
import { runAnalysis } from '../../src/services/pg-analyze/index.js';
import { logger } from '../../src/utils/logger.js';

const args = process.argv.slice(2);
const jsonMode = args.includes('--json');
const shouldSave = args.includes('--save');
const showDiff = args.includes('--diff');

const reportDir = process.env.PG_REPORT_DIR ?? './reports/pg-analysis';

async function main(): Promise<void> {
	if (!process.env.DATABASE_URL) {
		logger.error('DATABASE_URL environment variable is required', {
			hint: 'Set it in your .env file or pass it inline: DATABASE_URL=postgres://... pnpm pg:analyze',
		});
		process.exit(1);
	}

	// Validate connection with a real network round-trip
	try {
		const pool = getPgPool(process.env.DATABASE_URL);
		const client = await pool.connect();
		client.release();
	} catch (err) {
		logger.error('Connection failed', {
			error: err instanceof Error ? err.message : String(err),
		});
		process.exit(1);
	}

	try {
		const report = await runAnalysis();

		// Grab previous report before saving so diff compares against the prior run
		const previousHistory = showDiff ? getHistory(reportDir, 1) : [];

		if (shouldSave) {
			const path = saveReport(report, reportDir);
			logger.info('Report saved', { path });
		}

		if (showDiff) {
			if (previousHistory.length >= 1) {
				// Compare current run with most recent saved
				const diff = compareReports(report, previousHistory[0]);
				const diffText = formatDiff(diff);
				if (jsonMode) {
					console.log(JSON.stringify({ report: formatCompact(report), diff }, null, 2));
				} else {
					console.log(formatMarkdown(report));
					console.log('');
					console.log(diffText);
				}
			} else {
				logger.warn('No previous reports to diff against. Run with --save first.');
				if (jsonMode) {
					console.log(JSON.stringify(formatCompact(report), null, 2));
				} else {
					console.log(formatMarkdown(report));
				}
			}
		} else if (jsonMode) {
			console.log(JSON.stringify(formatCompact(report), null, 2));
		} else {
			console.log(formatMarkdown(report));
		}

		// Exit with code 1 if critical issues found
		const hasCritical = report.recommendations.some((r) => r.severity === 'critical');
		process.exitCode = hasCritical ? 1 : 0;
	} finally {
		await closePgPool();
	}
}

main().catch((err) => {
	logger.error('Fatal', { error: err instanceof Error ? err.message : String(err) });
	process.exit(2);
});
