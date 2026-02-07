import { useEffect, useRef, useState } from 'preact/hooks';
import type { LogEntry } from '../../shared/types';

interface LogViewerProps {
	logs: LogEntry[];
	onClear: () => void;
}

const LEVEL_ICONS: Record<string, string> = {
	info: 'ℹ',
	warn: '⚠',
	error: '✗',
	debug: '○',
};

export function LogViewer({ logs, onClear }: LogViewerProps) {
	const [expandedIds, setExpandedIds] = useState<Set<string>>(new Set());
	const [copied, setCopied] = useState(false);
	const containerRef = useRef<HTMLDivElement>(null);

	// Auto-scroll to bottom when new logs arrive
	// biome-ignore lint/correctness/useExhaustiveDependencies: logs.length triggers scroll on new logs
	useEffect(() => {
		if (containerRef.current) {
			containerRef.current.scrollTop = containerRef.current.scrollHeight;
		}
	}, [logs.length]);

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

	const handleCopyLogs = () => {
		const text = logs
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
		window.electronAPI.copyToClipboard(text);
		setCopied(true);
		setTimeout(() => setCopied(false), 2000);
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
				<span>Log ({logs.length})</span>
				<div class="log-actions">
					<button type="button" class="btn-small" onClick={handleCopyLogs}>
						{copied ? 'Copied!' : 'Copy'}
					</button>
					<button type="button" class="btn-small" onClick={onClear}>
						Clear
					</button>
				</div>
			</div>
			<div class="log-container" ref={containerRef}>
				{logs.map((log) => {
					const isExpanded = expandedIds.has(log.id);
					const hasDetails = !!log.details;

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
