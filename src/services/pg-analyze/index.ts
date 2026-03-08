import { pgQuery } from '../../db/pg-client.js';
import { logger } from '../../utils/logger.js';
import { getBloatEstimates } from './checks/bloat-estimate.js';
import { getConnectionStats } from './checks/connection-stats.js';
import { getIndexHealth } from './checks/index-health.js';
import type { QueryPerformanceResult } from './checks/query-performance.js';
import { getQueryPerformance } from './checks/query-performance.js';
import { getTableStats } from './checks/table-stats.js';
import { getTextrawlChecks } from './checks/textrawl-specific.js';
import { getVacuumStats } from './checks/vacuum-stats.js';
import { generateRecommendations } from './recommendations.js';
import type { AnalysisReport, ConnectionStat } from './types.js';

/** Extract a fulfilled value or return a fallback, logging errors for rejected checks. */
function settled<T>(result: PromiseSettledResult<T>, fallback: T, label: string): T {
	if (result.status === 'fulfilled') return result.value;
	logger.error(`${label} check failed`, {
		error: result.reason instanceof Error ? result.reason.message : String(result.reason),
	});
	return fallback;
}

const EMPTY_CONNECTIONS: ConnectionStat = {
	totalConnections: 0,
	activeConnections: 0,
	idleConnections: 0,
	idleInTransaction: 0,
	maxConnections: 0,
	connectionUsagePercent: 0,
	longRunningQueries: [],
};

const EMPTY_QUERY_RESULT: QueryPerformanceResult = {
	stats: [],
	pgStatStatementsAvailable: false,
};

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

	// Run all checks in parallel — failures in one check don't abort the rest
	const results = await Promise.allSettled([
		getTableStats(),
		getIndexHealth(),
		getVacuumStats(),
		getConnectionStats(),
		getQueryPerformance(),
		getBloatEstimates(),
		getTextrawlChecks(),
	]);

	const tables = settled(results[0], [], 'table-stats');
	const indexes = settled(results[1], [], 'index-health');
	const vacuum = settled(results[2], [], 'vacuum-stats');
	const connections = settled(results[3], EMPTY_CONNECTIONS, 'connection-stats');
	const queryResult = settled(results[4], EMPTY_QUERY_RESULT, 'query-performance');
	const bloat = settled(results[5], [], 'bloat-estimates');
	const textrawl = settled(results[6], [], 'textrawl-checks');

	const partial = {
		timestamp: new Date().toISOString(),
		databaseVersion,
		databaseSize,
		tables,
		indexes,
		vacuum,
		connections,
		queries: queryResult.stats,
		pgStatStatementsAvailable: queryResult.pgStatStatementsAvailable,
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
