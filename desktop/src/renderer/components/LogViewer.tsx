import { useState, useRef, useEffect } from 'preact/hooks';
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
  const containerRef = useRef<HTMLDivElement>(null);

  // Auto-scroll to bottom when new logs arrive
  useEffect(() => {
    if (containerRef.current) {
      containerRef.current.scrollTop = containerRef.current.scrollHeight;
    }
  }, [logs]);

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
        <button class="btn-small" onClick={onClear}>
          Clear
        </button>
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
            >
              <span class={`log-icon ${log.level}`}>
                {LEVEL_ICONS[log.level]}
              </span>
              <div class="log-content">
                <div class="log-message">
                  {log.message}
                  <span class="log-time">{formatTime(log.timestamp)}</span>
                </div>
                {hasDetails && isExpanded && (
                  <div class="log-details">{log.details}</div>
                )}
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}
