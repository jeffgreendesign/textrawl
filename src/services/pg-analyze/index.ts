import { pgQuery } from '../../db/pg-client.js';
import { logger } from '../../utils/logger.js';
import { getBloatEstimates } from './checks/bloat-estimate.js';
import { getConnectionStats } from './checks/connection-stats.js';
import { getIndexHealth } from './checks/index-health.js';
import { getQueryPerformance } from './checks/query-performance.js';
import { getTableStats } from './checks/table-stats.js';
import { getTextrawlChecks } from './checks/textrawl-specific.js';
import { getVacuumStats } from './checks/vacuum-stats.js';
import { generateRecommendations } from './recommendations.js';
import type { AnalysisReport } from './types.js';

/**
 * Run a full Postgres analysis and return the report.
 */
export async function runAnalysis(): Promise<AnalysisReport> {
	logger.info('Starting Postgres analysis');

	// Get database metadata
	const [versionResult, sizeResult] = await Promise.all([
		pgQuery<{ version: string }>('SELECT version()'),
		pgQuery<{ size: string }>(
			'SELECT pg_size_pretty(pg_database_size(current_database())) AS size',
		),
	]);

	const databaseVersion = versionResult.rows[0]?.version ?? 'unknown';
	const databaseSize = sizeResult.rows[0]?.size ?? 'unknown';

	// Run all checks in parallel
	const [tables, indexes, vacuum, connections, queries, bloat, textrawl] = await Promise.all([
		getTableStats(),
		getIndexHealth(),
		getVacuumStats(),
		getConnectionStats(),
		getQueryPerformance(),
		getBloatEstimates(),
		getTextrawlChecks(),
	]);

	const partial = {
		timestamp: new Date().toISOString(),
		databaseVersion,
		databaseSize,
		tables,
		indexes,
		vacuum,
		connections,
		queries,
		bloat,
		textrawl,
	};

	const recommendations = generateRecommendations(partial);

	logger.info('Postgres analysis complete', {
		tables: tables.length,
		indexes: indexes.length,
		recommendations: recommendations.length,
	});

	return { ...partial, recommendations };
}
