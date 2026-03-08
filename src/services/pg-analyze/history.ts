import { existsSync, mkdirSync, readFileSync, readdirSync, statSync, writeFileSync } from 'node:fs';
import { isAbsolute, join, relative, resolve } from 'node:path';
import { z } from 'zod';
import { logger } from '../../utils/logger.js';
import type { AnalysisReport } from './types.js';

/** Max report file size: 10 MB */
const MAX_REPORT_SIZE = 10 * 1024 * 1024;

/** Zod schema for validating persisted AnalysisReport objects. */
export const AnalysisReportSchema = z.object({
	timestamp: z.string(),
	databaseVersion: z.string(),
	databaseSize: z.string(),
	tables: z.array(
		z.object({
			schema: z.string(),
			table: z.string(),
			rowEstimate: z.number(),
			totalSize: z.string(),
			tableSize: z.string(),
			indexSize: z.string(),
			toastSize: z.string(),
			deadTuples: z.number(),
			liveTuples: z.number(),
			deadTupleRatio: z.number(),
		}),
	),
	indexes: z.array(
		z.object({
			schema: z.string(),
			table: z.string(),
			index: z.string(),
			size: z.string(),
			scans: z.number(),
			tuplesRead: z.number(),
			tuplesFetched: z.number(),
			indexDef: z.string(),
		}),
	),
	vacuum: z.array(
		z.object({
			schema: z.string(),
			table: z.string(),
			lastVacuum: z.string().nullable(),
			lastAutovacuum: z.string().nullable(),
			lastAnalyze: z.string().nullable(),
			lastAutoanalyze: z.string().nullable(),
			deadTuples: z.number(),
			liveTuples: z.number(),
			vacuumCount: z.number(),
			autovacuumCount: z.number(),
		}),
	),
	connections: z.object({
		totalConnections: z.number(),
		activeConnections: z.number(),
		idleConnections: z.number(),
		idleInTransaction: z.number(),
		maxConnections: z.number(),
		connectionUsagePercent: z.number(),
		longRunningQueries: z.array(
			z.object({
				pid: z.number(),
				duration: z.string(),
				state: z.string(),
				query: z.string(),
			}),
		),
	}),
	queries: z.array(
		z.object({
			queryId: z.string(),
			query: z.string(),
			calls: z.number(),
			totalTime: z.number(),
			meanTime: z.number(),
			minTime: z.number(),
			maxTime: z.number(),
			rows: z.number(),
		}),
	),
	pgStatStatementsAvailable: z.boolean().default(false),
	bloat: z.array(
		z.object({
			schema: z.string(),
			table: z.string(),
			type: z.enum(['table']),
			currentSize: z.string(),
			estimatedBloat: z.string(),
			bloatRatio: z.number(),
		}),
	),
	textrawl: z.array(
		z.object({
			name: z.string(),
			status: z.enum(['ok', 'warning', 'missing', 'error']),
			detail: z.string(),
		}),
	),
	recommendations: z.array(
		z.object({
			severity: z.enum(['info', 'warning', 'critical']),
			category: z.enum(['maintenance', 'performance', 'storage', 'security', 'textrawl']),
			title: z.string(),
			description: z.string(),
			suggestion: z.string(),
			reference: z.string().optional(),
		}),
	),
});

/** Expected timestamp-based filename pattern */
const REPORT_FILENAME_RE = /^\d{4}-\d{2}-\d{2}T[\d-]+Z\.json$/;

/**
 * Validate that the report directory path is safe.
 * Rejects absolute paths outside the process cwd tree.
 */
function validateReportDir(dir: string): string {
	const full = resolve(dir);
	const rel = relative(process.cwd(), full);
	if (rel.startsWith('..') || isAbsolute(rel)) {
		throw new Error(`Report directory "${dir}" is outside the project root`);
	}
	return full;
}

/**
 * Save a report as a timestamped JSON file.
 */
export function saveReport(report: AnalysisReport, dir: string): string {
	const resolvedDir = validateReportDir(dir);

	if (!existsSync(resolvedDir)) {
		mkdirSync(resolvedDir, { recursive: true });
	}

	const filename = `${report.timestamp.replace(/[:.]/g, '-')}.json`;
	const filepath = join(resolvedDir, filename);
	writeFileSync(filepath, JSON.stringify(report, null, 2));
	return filepath;
}

/**
 * Load the last N reports from the history directory.
 */
export function getHistory(dir: string, count = 10): AnalysisReport[] {
	const resolvedDir = validateReportDir(dir);
	if (!existsSync(resolvedDir)) return [];

	const safeCount = Math.min(Math.max(count, 1), 50);

	const files = readdirSync(resolvedDir)
		.filter((f) => f.endsWith('.json') && REPORT_FILENAME_RE.test(f))
		.sort()
		.reverse()
		.slice(0, safeCount);

	const reports: AnalysisReport[] = [];

	for (const f of files) {
		const filepath = join(resolvedDir, f);

		// Check file size before reading
		try {
			const stat = statSync(filepath);
			if (stat.size > MAX_REPORT_SIZE) {
				logger.debug('Skipping oversized report file', { file: f, size: stat.size });
				continue;
			}
		} catch {
			continue;
		}

		try {
			const content = readFileSync(filepath, 'utf-8');
			const raw = JSON.parse(content);
			const result = AnalysisReportSchema.safeParse(raw);

			if (!result.success) {
				logger.debug('Skipping malformed report file', { file: f, error: result.error.message });
				continue;
			}

			reports.push(result.data as AnalysisReport);
		} catch (err) {
			logger.error('Failed to parse report file', {
				file: f,
				error: err instanceof Error ? err.message : String(err),
			});
		}
	}

	return reports;
}

export interface ReportDiff {
	tableChanges: Array<{
		table: string;
		rowDelta: number;
		deadTupleDelta: number;
		sizeChange: string;
	}>;
	newRecommendations: string[];
	resolvedRecommendations: string[];
	connectionDelta: number;
}

/**
 * Compare two reports and return a diff summary.
 */
export function compareReports(current: AnalysisReport, previous: AnalysisReport): ReportDiff {
	const tableChanges: ReportDiff['tableChanges'] = [];

	for (const ct of current.tables) {
		const pt = previous.tables.find((t) => t.schema === ct.schema && t.table === ct.table);
		if (pt) {
			tableChanges.push({
				table: `${ct.schema}.${ct.table}`,
				rowDelta: ct.rowEstimate - pt.rowEstimate,
				deadTupleDelta: ct.deadTuples - pt.deadTuples,
				sizeChange: `${pt.totalSize} -> ${ct.totalSize}`,
			});
		}
	}

	const currentRecTitles = new Set(current.recommendations.map((r) => r.title));
	const previousRecTitles = new Set(previous.recommendations.map((r) => r.title));

	const newRecommendations = [...currentRecTitles].filter((t) => !previousRecTitles.has(t));
	const resolvedRecommendations = [...previousRecTitles].filter((t) => !currentRecTitles.has(t));

	return {
		tableChanges: tableChanges.filter((tc) => tc.rowDelta !== 0 || tc.deadTupleDelta !== 0),
		newRecommendations,
		resolvedRecommendations,
		connectionDelta: current.connections.totalConnections - previous.connections.totalConnections,
	};
}

export function formatDiff(diff: ReportDiff): string {
	const lines: string[] = ['## Changes Since Last Report', ''];

	if (diff.tableChanges.length > 0) {
		lines.push('### Table Changes');
		lines.push('| Table | Row Delta | Dead Tuple Delta | Size |');
		lines.push('|-------|-----------|------------------|------|');
		for (const tc of diff.tableChanges) {
			const rowSign = tc.rowDelta >= 0 ? '+' : '';
			const deadSign = tc.deadTupleDelta >= 0 ? '+' : '';
			lines.push(
				`| ${tc.table} | ${rowSign}${tc.rowDelta} | ${deadSign}${tc.deadTupleDelta} | ${tc.sizeChange} |`,
			);
		}
		lines.push('');
	}

	if (diff.newRecommendations.length > 0) {
		lines.push('### New Issues');
		for (const r of diff.newRecommendations) {
			lines.push(`- ${r}`);
		}
		lines.push('');
	}

	if (diff.resolvedRecommendations.length > 0) {
		lines.push('### Resolved Issues');
		for (const r of diff.resolvedRecommendations) {
			lines.push(`- ~~${r}~~`);
		}
		lines.push('');
	}

	if (diff.connectionDelta !== 0) {
		const sign = diff.connectionDelta >= 0 ? '+' : '';
		lines.push(`**Connection change:** ${sign}${diff.connectionDelta}`);
		lines.push('');
	}

	if (
		diff.tableChanges.length === 0 &&
		diff.newRecommendations.length === 0 &&
		diff.resolvedRecommendations.length === 0
	) {
		lines.push('No significant changes detected.');
		lines.push('');
	}

	return lines.join('\n');
}
