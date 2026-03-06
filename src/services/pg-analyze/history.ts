import { existsSync, mkdirSync, readFileSync, readdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import type { AnalysisReport } from './types.js';

/**
 * Save a report as a timestamped JSON file.
 */
export function saveReport(report: AnalysisReport, dir: string): string {
	if (!existsSync(dir)) {
		mkdirSync(dir, { recursive: true });
	}

	const filename = `${report.timestamp.replace(/[:.]/g, '-')}.json`;
	const filepath = join(dir, filename);
	writeFileSync(filepath, JSON.stringify(report, null, 2));
	return filepath;
}

/**
 * Load the last N reports from the history directory.
 */
export function getHistory(dir: string, count = 10): AnalysisReport[] {
	if (!existsSync(dir)) return [];

	const files = readdirSync(dir)
		.filter((f) => f.endsWith('.json'))
		.sort()
		.reverse()
		.slice(0, count);

	return files.map((f) => {
		const content = readFileSync(join(dir, f), 'utf-8');
		return JSON.parse(content) as AnalysisReport;
	});
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
