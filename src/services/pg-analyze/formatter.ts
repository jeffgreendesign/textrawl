import type { AnalysisReport, Recommendation, Severity } from './types.js';

const SEVERITY_ICONS: Record<Severity, string> = {
	critical: '[CRITICAL]',
	warning: '[WARNING]',
	info: '[INFO]',
};

export function formatMarkdown(report: AnalysisReport): string {
	const lines: string[] = [];

	// Header
	lines.push('# Postgres Analysis Report');
	lines.push('');
	lines.push(`**Generated:** ${report.timestamp}`);
	lines.push(`**PostgreSQL:** ${report.databaseVersion}`);
	lines.push(`**Database size:** ${report.databaseSize}`);
	lines.push('');

	// Score summary
	const critical = report.recommendations.filter((r) => r.severity === 'critical').length;
	const warnings = report.recommendations.filter((r) => r.severity === 'warning').length;
	const info = report.recommendations.filter((r) => r.severity === 'info').length;
	lines.push(`## Summary: ${critical} critical, ${warnings} warnings, ${info} info`);
	lines.push('');

	// Table stats
	if (report.tables.length > 0) {
		lines.push('## Table Statistics');
		lines.push('');
		lines.push('| Table | Rows | Total Size | Dead Tuples | Dead % |');
		lines.push('|-------|------|------------|-------------|--------|');
		for (const t of report.tables) {
			lines.push(
				`| ${t.table} | ${t.rowEstimate.toLocaleString()} | ${t.totalSize} | ${t.deadTuples.toLocaleString()} | ${(t.deadTupleRatio * 100).toFixed(1)}% |`,
			);
		}
		lines.push('');
	}

	// Index health
	if (report.indexes.length > 0) {
		lines.push('## Index Health');
		lines.push('');
		const unused = report.indexes.filter((i) => i.scans === 0);
		if (unused.length > 0) {
			lines.push(`**Unused indexes (0 scans):** ${unused.length}`);
			lines.push('');
		}
		lines.push('| Index | Table | Size | Scans | Tuples Read |');
		lines.push('|-------|-------|------|-------|-------------|');
		for (const i of report.indexes.slice(0, 20)) {
			lines.push(
				`| ${i.index} | ${i.table} | ${i.size} | ${i.scans.toLocaleString()} | ${i.tuplesRead.toLocaleString()} |`,
			);
		}
		lines.push('');
	}

	// Vacuum status
	if (report.vacuum.length > 0) {
		lines.push('## Vacuum Status');
		lines.push('');
		lines.push('| Table | Last Vacuum | Last Autovacuum | Dead Tuples |');
		lines.push('|-------|-------------|-----------------|-------------|');
		for (const v of report.vacuum) {
			const lastV = v.lastVacuum ? v.lastVacuum.split('.')[0] : 'never';
			const lastAv = v.lastAutovacuum ? v.lastAutovacuum.split('.')[0] : 'never';
			lines.push(`| ${v.table} | ${lastV} | ${lastAv} | ${v.deadTuples.toLocaleString()} |`);
		}
		lines.push('');
	}

	// Connections
	lines.push('## Connections');
	lines.push('');
	const c = report.connections;
	lines.push(`- **Active:** ${c.activeConnections}`);
	lines.push(`- **Idle:** ${c.idleConnections}`);
	lines.push(`- **Idle in transaction:** ${c.idleInTransaction}`);
	lines.push(
		`- **Total:** ${c.totalConnections} / ${c.maxConnections} (${c.connectionUsagePercent.toFixed(1)}%)`,
	);
	if (c.longRunningQueries.length > 0) {
		lines.push(`- **Long-running queries:** ${c.longRunningQueries.length}`);
	}
	lines.push('');

	// Query performance
	if (report.queries.length > 0) {
		lines.push('## Slowest Queries (by total time)');
		lines.push('');
		for (const q of report.queries.slice(0, 10)) {
			lines.push(
				`- **${q.totalTime.toFixed(1)}ms total** (${q.calls} calls, ${q.meanTime.toFixed(2)}ms avg)`,
			);
			lines.push(`  \`${q.query.slice(0, 120)}${q.query.length > 120 ? '...' : ''}\``);
		}
		lines.push('');
	}

	// Bloat
	if (report.bloat.length > 0) {
		lines.push('## Bloat Estimates');
		lines.push('');
		lines.push('| Table | Type | Size | Bloat % |');
		lines.push('|-------|------|------|---------|');
		for (const b of report.bloat) {
			lines.push(`| ${b.table} | ${b.type} | ${b.currentSize} | ${b.bloatRatio}% |`);
		}
		lines.push('');
	}

	// Textrawl-specific checks
	if (report.textrawl.length > 0) {
		lines.push('## Textrawl Checks');
		lines.push('');
		for (const tc of report.textrawl) {
			const icon =
				{ ok: '[OK]', warning: '[WARN]', missing: '[MISS]', error: '[ERR]' }[tc.status] ?? '[??]';
			lines.push(`- ${icon} **${tc.name}**: ${tc.detail}`);
		}
		lines.push('');
	}

	// Recommendations
	if (report.recommendations.length > 0) {
		lines.push('## Recommendations');
		lines.push('');
		for (const r of report.recommendations) {
			lines.push(`### ${SEVERITY_ICONS[r.severity]} ${r.title}`);
			lines.push('');
			lines.push(r.description);
			lines.push('');
			lines.push('**Suggestion:**');
			lines.push('```sql');
			lines.push(r.suggestion);
			lines.push('```');
			if (r.reference) {
				lines.push(`**Reference:** ${r.reference}`);
			}
			lines.push('');
		}
	}

	return lines.join('\n');
}

export function formatCompact(report: AnalysisReport): Record<string, unknown> {
	return {
		ts: report.timestamp,
		ver: report.databaseVersion,
		size: report.databaseSize,
		summary: {
			tables: report.tables.length,
			indexes: report.indexes.length,
			critical: report.recommendations.filter((r) => r.severity === 'critical').length,
			warnings: report.recommendations.filter((r) => r.severity === 'warning').length,
			info: report.recommendations.filter((r) => r.severity === 'info').length,
		},
		tables: report.tables.map((t) => ({
			name: t.table,
			rows: t.rowEstimate,
			size: t.totalSize,
			deadPct: Number((t.deadTupleRatio * 100).toFixed(1)),
		})),
		unusedIndexes: report.indexes
			.filter((i) => i.scans === 0)
			.map((i) => ({ name: i.index, table: i.table, size: i.size })),
		connections: {
			active: report.connections.activeConnections,
			idle: report.connections.idleConnections,
			total: report.connections.totalConnections,
			max: report.connections.maxConnections,
			pct: Number(report.connections.connectionUsagePercent.toFixed(1)),
		},
		textrawl: report.textrawl
			.filter((c) => c.status !== 'ok')
			.map((c) => ({ name: c.name, status: c.status, detail: c.detail })),
		recommendations: report.recommendations.map((r) => ({
			sev: r.severity,
			cat: r.category,
			title: r.title,
			fix: r.suggestion,
		})),
	};
}
