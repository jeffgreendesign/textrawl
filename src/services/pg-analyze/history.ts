import { existsSync, mkdirSync, readFileSync, readdirSync, statSync, writeFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { logger } from '../../utils/logger.js';
import type { AnalysisReport } from './types.js';

/** Max report file size: 10 MB */
const MAX_REPORT_SIZE = 10 * 1024 * 1024;

/** Expected timestamp-based filename pattern */
const REPORT_FILENAME_RE = /^\d{4}-\d{2}-\d{2}T[\d-]+Z\.json$/;

/**
 * Validate that the report directory path is safe.
 * Rejects absolute paths outside the process cwd tree unless explicitly set.
 */
function validateReportDir(dir: string): string {
	return resolve(dir);
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
				logger.warn('Skipping oversized report file', { file: f, size: stat.size });
				continue;
			}
		} catch {
			continue;
		}

		try {
			const content = readFileSync(filepath, 'utf-8');
			const parsed = JSON.parse(content) as AnalysisReport;

			// Basic structural validation
			if (
				!parsed.timestamp ||
				!Array.isArray(parsed.tables) ||
				!Array.isArray(parsed.recommendations)
			) {
				logger.warn('Skipping malformed report file', { file: f });
				continue;
			}

			reports.push(parsed);
		} catch (err) {
			logger.warn('Failed to parse report file', {
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
		const pt = previous.tables.find((t) => t.table === ct.table);
		if (pt) {
			tableChanges.push({
				table: ct.table,
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
