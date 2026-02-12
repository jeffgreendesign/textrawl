import { useEffect, useRef, useState } from 'preact/hooks';
import type { LogEntry } from '../../shared/types';

interface LogViewerProps {
	logs: LogEntry[];
	onClear: () => void;
	verboseEnabled?: boolean;
}

const LEVEL_ICONS: Record<string, string> = {
	info: '\u2139',
	warn: '\u26A0',
	error: '\u2717',
	debug: '\u25CB',
};

const LOG_LEVELS = ['debug', 'info', 'warn', 'error'] as const;

/** Max entries rendered in the DOM at once to keep the UI responsive. */
const RENDER_LIMIT = 500;

export function LogViewer({ logs, onClear, verboseEnabled = false }: LogViewerProps) {
	const [expandedIds, setExpandedIds] = useState<Set<string>>(new Set());
	const [copied, setCopied] = useState(false);
	const [showAll, setShowAll] = useState(false);
	const [activeLevels, setActiveLevels] = useState<Set<string>>(
		new Set(verboseEnabled ? ['debug', 'info', 'warn', 'error'] : ['info', 'warn', 'error']),
	);
	const containerRef = useRef<HTMLDivElement>(null);

	// When verbose is toggled on, auto-include debug level
	useEffect(() => {
		if (verboseEnabled) {
			setActiveLevels((prev) => new Set([...prev, 'debug']));
		} else {
			setActiveLevels((prev) => {
				const next = new Set(prev);
				next.delete('debug');
				return next;
			});
		}
	}, [verboseEnabled]);

	// Reset "show all" when logs are cleared
	useEffect(() => {
		if (logs.length === 0) setShowAll(false);
	}, [logs.length]);

	const filteredLogs = logs.filter((log) => activeLevels.has(log.level));
	const isTruncated = !showAll && filteredLogs.length > RENDER_LIMIT;
	const visibleLogs = isTruncated ? filteredLogs.slice(-RENDER_LIMIT) : filteredLogs;

	// Auto-scroll to bottom when new logs arrive
	// biome-ignore lint/correctness/useExhaustiveDependencies: visibleLogs.length triggers scroll on new logs
	useEffect(() => {
		if (containerRef.current) {
			containerRef.current.scrollTop = containerRef.current.scrollHeight;
		}
	}, [visibleLogs.length]);

	const toggleExpand = (id: string) => {
		setExpandedIds((prev) => {
			const next = new Set(prev);
			if (next.has(id)) {
				next.delete(id);
			} else {
				next.add(id);
			}
			return next;
		});
	};

	const toggleLevel = (level: string) => {
		setActiveLevels((prev) => {
			const next = new Set(prev);
			if (next.has(level)) {
				next.delete(level);
			} else {
				next.add(level);
			}
			return next;
		});
	};

	const handleCopyLogs = async () => {
		try {
			const text = filteredLogs
				.map((log) => {
					const time = new Date(log.timestamp).toLocaleTimeString('en-US', {
						hour: '2-digit',
						minute: '2-digit',
						second: '2-digit',
					});
					const prefix = `[${log.level.toUpperCase()}]`;
					const details = log.details ? `\n  ${log.details}` : '';
					return `${time} ${prefix} ${log.message}${details}`;
				})
				.join('\n');
			if (window.electronAPI?.copyToClipboard) {
				window.electronAPI.copyToClipboard(text);
			} else {
				await navigator.clipboard.writeText(text);
			}
			setCopied(true);
			setTimeout(() => setCopied(false), 2000);
		} catch {
			// Fallback: select-all in a temporary textarea
			const ta = document.createElement('textarea');
			ta.value = filteredLogs.map((l) => `[${l.level}] ${l.message}`).join('\n');
			document.body.appendChild(ta);
			ta.select();
			document.execCommand('copy');
			document.body.removeChild(ta);
			setCopied(true);
			setTimeout(() => setCopied(false), 2000);
		}
	};

	const formatTime = (date: Date) => {
		const d = new Date(date);
		return d.toLocaleTimeString('en-US', {
			hour: '2-digit',
			minute: '2-digit',
			second: '2-digit',
		});
	};

	return (
		<div class="log-section">
			<div class="log-header">
				<span>
					Log ({filteredLogs.length}
					{filteredLogs.length !== logs.length ? `/${logs.length}` : ''})
				</span>
				<div class="log-actions">
					<div class="log-level-filters">
						{LOG_LEVELS.map((level) => (
							<button
								key={level}
								type="button"
								class={`btn-tiny log-level-btn ${activeLevels.has(level) ? 'log-level-btn--active' : ''} log-level-btn--${level}`}
								onClick={() => toggleLevel(level)}
								title={`Toggle ${level} logs`}
							>
								{LEVEL_ICONS[level]}
							</button>
						))}
					</div>
					<button type="button" class="btn-small" onClick={handleCopyLogs}>
						{copied ? 'Copied!' : 'Copy'}
					</button>
					<button type="button" class="btn-small" onClick={onClear}>
						Clear
					</button>
				</div>
			</div>
			<div class="log-container" ref={containerRef}>
				{isTruncated && (
					<div class="log-truncated-banner">
						Showing last {RENDER_LIMIT} of {filteredLogs.length} logs
						<button type="button" class="btn-tiny" onClick={() => setShowAll(true)}>
							Show all
						</button>
					</div>
				)}
				{visibleLogs.map((log) => {
					const hasDetails = !!log.details;
					// Auto-expand errors so failure details are immediately visible
					const isExpanded = expandedIds.has(log.id) || (log.level === 'error' && hasDetails);

					return (
						<div
							key={log.id}
							class={`log-entry ${isExpanded ? 'expanded' : ''}`}
							onClick={() => hasDetails && toggleExpand(log.id)}
							onKeyDown={(e) => hasDetails && e.key === 'Enter' && toggleExpand(log.id)}
							role={hasDetails ? 'button' : undefined}
							tabIndex={hasDetails ? 0 : undefined}
						>
							<span class={`log-icon ${log.level}`}>{LEVEL_ICONS[log.level]}</span>
							<div class="log-content">
								<div class="log-message">
									{log.message}
									<span class="log-time">{formatTime(log.timestamp)}</span>
								</div>
								{hasDetails && isExpanded && <div class="log-details">{log.details}</div>}
							</div>
						</div>
					);
				})}
			</div>
		</div>
	);
}
