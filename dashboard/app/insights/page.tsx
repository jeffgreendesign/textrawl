/**
 * Insights — view discovered patterns and connections.
 */
'use client';

import {
	AlertCircle,
	ChevronDown,
	ChevronUp,
	Eye,
	EyeOff,
	Lightbulb,
	Link2,
	Loader2,
	Network,
	Sparkles,
	Tag,
	Timer,
	X,
} from 'lucide-react';
import { useState } from 'react';

import type { InsightItem } from '@/lib/api';
import { patchInsightStatus } from '@/lib/api';
import { useInsightStats, useInsights } from '@/lib/queries';
import { useQueryClient } from '@tanstack/react-query';

/* ── Constants ── */

type StatusTab = 'all' | 'new' | 'seen' | 'dismissed';

const STATUS_TABS: { key: StatusTab; label: string }[] = [
	{ key: 'all', label: 'All' },
	{ key: 'new', label: 'New' },
	{ key: 'seen', label: 'Seen' },
	{ key: 'dismissed', label: 'Dismissed' },
];

const TYPE_COLORS: Record<string, { bg: string; fg: string }> = {
	cross_source: { bg: 'rgba(59, 130, 246, 0.15)', fg: '#60a5fa' },
	theme_cluster: { bg: 'rgba(139, 92, 246, 0.15)', fg: '#a78bfa' },
	entity_bridge: { bg: 'rgba(34, 197, 94, 0.15)', fg: '#4ade80' },
	temporal_pattern: { bg: 'rgba(245, 158, 11, 0.15)', fg: '#fbbf24' },
	outlier: { bg: 'rgba(239, 68, 68, 0.15)', fg: '#f87171' },
};

const TYPE_ICONS: Record<string, typeof Lightbulb> = {
	cross_source: Link2,
	theme_cluster: Sparkles,
	entity_bridge: Network,
	temporal_pattern: Timer,
	outlier: AlertCircle,
};

/* ── Helpers ── */

function timeAgo(dateStr: string): string {
	const now = Date.now();
	const then = new Date(dateStr).getTime();
	const seconds = Math.floor((now - then) / 1000);

	if (seconds < 60) return 'just now';
	const minutes = Math.floor(seconds / 60);
	if (minutes < 60) return `${minutes}m ago`;
	const hours = Math.floor(minutes / 60);
	if (hours < 24) return `${hours}h ago`;
	const days = Math.floor(hours / 24);
	if (days < 30) return `${days}d ago`;
	const months = Math.floor(days / 30);
	if (months < 12) return `${months}mo ago`;
	const years = Math.floor(months / 12);
	return `${years}y ago`;
}

function formatTypeName(type: string): string {
	return type.replace(/_/g, ' ').replace(/\b\w/g, (c) => c.toUpperCase());
}

/* ── Type Badge ── */

function TypeBadge({ type }: { type: string }) {
	const colors = TYPE_COLORS[type] ?? { bg: 'rgba(113, 113, 122, 0.15)', fg: '#a1a1aa' };
	const Icon = TYPE_ICONS[type] ?? Lightbulb;
	return (
		<span
			style={{
				display: 'inline-flex',
				alignItems: 'center',
				gap: '0.25rem',
				padding: '0.125rem 0.5rem',
				fontSize: '0.6875rem',
				fontFamily: 'var(--font-mono)',
				fontWeight: 500,
				borderRadius: '9999px',
				backgroundColor: colors.bg,
				color: colors.fg,
				lineHeight: 1.6,
			}}
		>
			<Icon size={11} />
			{formatTypeName(type)}
		</span>
	);
}

/* ── Status Badge ── */

function StatusBadge({ status }: { status: string }) {
	const styles: Record<string, { bg: string; fg: string }> = {
		new: { bg: 'rgba(34, 197, 94, 0.15)', fg: '#4ade80' },
		seen: { bg: 'rgba(113, 113, 122, 0.15)', fg: '#a1a1aa' },
		dismissed: { bg: 'rgba(239, 68, 68, 0.08)', fg: '#f87171' },
	};
	const s = styles[status] ?? styles.seen;
	return (
		<span
			style={{
				display: 'inline-block',
				padding: '0.125rem 0.375rem',
				fontSize: '0.625rem',
				fontFamily: 'var(--font-mono)',
				fontWeight: 500,
				borderRadius: '9999px',
				backgroundColor: s.bg,
				color: s.fg,
				lineHeight: 1.6,
				textTransform: 'uppercase',
			}}
		>
			{status}
		</span>
	);
}

/* ── Insight Card ── */

function InsightCard({
	insight,
	onDismiss,
	onMarkSeen,
}: {
	insight: InsightItem;
	onDismiss: (id: string) => void;
	onMarkSeen: (id: string) => void;
}) {
	const [expanded, setExpanded] = useState(false);

	return (
		<div
			style={{
				backgroundColor: 'var(--bg-secondary)',
				border: `1px solid ${insight.status === 'new' ? 'rgba(34, 197, 94, 0.3)' : 'var(--border-default)'}`,
				borderRadius: '0.75rem',
				padding: '1.25rem',
				display: 'flex',
				flexDirection: 'column',
				gap: '0.75rem',
			}}
		>
			{/* Header */}
			<div style={{ display: 'flex', alignItems: 'flex-start', gap: '0.5rem' }}>
				<div style={{ flex: 1 }}>
					<div
						style={{
							display: 'flex',
							alignItems: 'center',
							gap: '0.5rem',
							marginBottom: '0.375rem',
							flexWrap: 'wrap',
						}}
					>
						<TypeBadge type={insight.insight_type} />
						<StatusBadge status={insight.status} />
					</div>
					<h3
						style={{
							margin: 0,
							fontSize: '0.9375rem',
							fontWeight: 600,
							color: 'var(--text-primary)',
							lineHeight: 1.4,
						}}
					>
						{insight.title}
					</h3>
				</div>
				<span
					style={{
						fontSize: '0.6875rem',
						fontFamily: 'var(--font-mono)',
						color: 'var(--text-muted)',
						flexShrink: 0,
						whiteSpace: 'nowrap',
					}}
				>
					{timeAgo(insight.created_at)}
				</span>
			</div>

			{/* Summary */}
			<p
				style={{
					margin: 0,
					fontSize: '0.8125rem',
					lineHeight: 1.6,
					color: 'var(--text-muted)',
				}}
			>
				{insight.summary}
			</p>

			{/* Entities */}
			{insight.entities.length > 0 && (
				<div style={{ display: 'flex', flexWrap: 'wrap', gap: '0.375rem' }}>
					{insight.entities.map((entity) => (
						<span
							key={entity}
							style={{
								display: 'inline-flex',
								alignItems: 'center',
								gap: '0.25rem',
								padding: '0.125rem 0.5rem',
								fontSize: '0.6875rem',
								fontFamily: 'var(--font-mono)',
								borderRadius: '0.25rem',
								backgroundColor: 'var(--bg-tertiary)',
								color: 'var(--text-secondary)',
							}}
						>
							<Tag size={10} />
							{entity}
						</span>
					))}
				</div>
			)}

			{/* Evidence toggle */}
			{insight.evidence.length > 0 && (
				<button
					type="button"
					onClick={() => setExpanded(!expanded)}
					style={{
						display: 'flex',
						alignItems: 'center',
						gap: '0.375rem',
						background: 'none',
						border: 'none',
						color: 'var(--text-accent)',
						fontSize: '0.8125rem',
						cursor: 'pointer',
						padding: 0,
					}}
				>
					{expanded ? <ChevronUp size={14} /> : <ChevronDown size={14} />}
					{insight.evidence.length} evidence source{insight.evidence.length !== 1 ? 's' : ''}
				</button>
			)}

			{/* Evidence list */}
			{expanded && insight.evidence.length > 0 && (
				<div
					style={{
						display: 'flex',
						flexDirection: 'column',
						gap: '0.5rem',
						paddingLeft: '0.75rem',
						borderLeft: '2px solid var(--border-default)',
					}}
				>
					{insight.evidence.map((ev, i) => (
						<div
							key={`${ev.chunk_id ?? i}`}
							style={{
								fontSize: '0.8125rem',
								lineHeight: 1.5,
							}}
						>
							{ev.document_title && (
								<span style={{ color: 'var(--text-secondary)', fontWeight: 500 }}>
									{ev.document_title}
								</span>
							)}
							{ev.excerpt && (
								<p
									style={{
										margin: '0.25rem 0 0',
										color: 'var(--text-muted)',
										fontSize: '0.75rem',
										fontStyle: 'italic',
									}}
								>
									&ldquo;{ev.excerpt}&rdquo;
								</p>
							)}
						</div>
					))}
				</div>
			)}

			{/* Actions */}
			<div style={{ display: 'flex', gap: '0.5rem', marginTop: '0.25rem' }}>
				{insight.status === 'new' && (
					<button
						type="button"
						onClick={() => onMarkSeen(insight.id)}
						style={{
							display: 'inline-flex',
							alignItems: 'center',
							gap: '0.375rem',
							padding: '0.375rem 0.75rem',
							fontSize: '0.75rem',
							borderRadius: '0.375rem',
							backgroundColor: 'var(--bg-tertiary)',
							border: '1px solid var(--border-default)',
							color: 'var(--text-secondary)',
							cursor: 'pointer',
						}}
					>
						<Eye size={12} />
						Mark seen
					</button>
				)}
				{insight.status !== 'dismissed' && (
					<button
						type="button"
						onClick={() => onDismiss(insight.id)}
						style={{
							display: 'inline-flex',
							alignItems: 'center',
							gap: '0.375rem',
							padding: '0.375rem 0.75rem',
							fontSize: '0.75rem',
							borderRadius: '0.375rem',
							backgroundColor: 'rgba(239, 68, 68, 0.08)',
							border: '1px solid rgba(239, 68, 68, 0.2)',
							color: '#f87171',
							cursor: 'pointer',
						}}
					>
						<EyeOff size={12} />
						Dismiss
					</button>
				)}
			</div>
		</div>
	);
}

/* ── Main Page ── */

export default function InsightsPage() {
	const [activeTab, setActiveTab] = useState<StatusTab>('all');

	const statusFilter = activeTab === 'all' ? undefined : activeTab;
	const { data, isLoading, isError, error, refetch } = useInsights({ status: statusFilter });
	const { data: stats } = useInsightStats();
	const queryClient = useQueryClient();

	const handleStatusChange = async (id: string, status: 'seen' | 'dismissed') => {
		try {
			await patchInsightStatus(id, status);
			queryClient.invalidateQueries({ queryKey: ['insights'] });
		} catch {
			// Silently fail — user can retry
		}
	};

	const insights = data?.insights ?? [];

	return (
		<div>
			{/* Header */}
			<div
				style={{ display: 'flex', alignItems: 'center', gap: '0.75rem', marginBottom: '1.5rem' }}
			>
				<h2 style={{ fontSize: '1.5rem', fontWeight: 600, margin: 0 }}>Insights</h2>
				{stats && (
					<span
						style={{
							display: 'inline-block',
							padding: '0.125rem 0.5rem',
							fontSize: '0.6875rem',
							fontFamily: 'var(--font-mono)',
							fontWeight: 500,
							borderRadius: '9999px',
							backgroundColor: 'rgba(99, 102, 241, 0.15)',
							color: 'var(--text-accent)',
						}}
					>
						{stats.total} total
					</span>
				)}
			</div>

			{/* Status filter tabs */}
			<div
				style={{
					display: 'flex',
					gap: '0.375rem',
					marginBottom: '1.5rem',
					flexWrap: 'wrap',
				}}
			>
				{STATUS_TABS.map((tab) => {
					const isActive = activeTab === tab.key;
					const count =
						tab.key === 'all' ? stats?.total : stats?.[tab.key as 'new' | 'seen' | 'dismissed'];
					return (
						<button
							key={tab.key}
							type="button"
							onClick={() => setActiveTab(tab.key)}
							style={{
								display: 'inline-flex',
								alignItems: 'center',
								gap: '0.375rem',
								padding: '0.5rem 0.875rem',
								fontSize: '0.8125rem',
								fontWeight: 500,
								borderRadius: '9999px',
								backgroundColor: isActive ? 'var(--text-accent)' : 'var(--bg-secondary)',
								border: `1px solid ${isActive ? 'var(--text-accent)' : 'var(--border-default)'}`,
								color: isActive ? '#000' : 'var(--text-secondary)',
								cursor: 'pointer',
								transition: 'all 0.2s ease',
							}}
						>
							{tab.label}
							{count !== undefined && (
								<span
									style={{
										fontSize: '0.6875rem',
										fontFamily: 'var(--font-mono)',
										opacity: 0.8,
									}}
								>
									{count}
								</span>
							)}
						</button>
					);
				})}
			</div>

			{/* Content */}
			{isLoading && (
				<div
					style={{
						display: 'flex',
						alignItems: 'center',
						justifyContent: 'center',
						padding: '3rem',
						color: 'var(--text-muted)',
					}}
				>
					<Loader2 size={24} style={{ animation: 'spin 1s linear infinite' }} />
					<style>
						{
							'@keyframes spin { from { transform: rotate(0deg); } to { transform: rotate(360deg); } }'
						}
					</style>
				</div>
			)}

			{isError && (
				<div style={{ maxWidth: 600 }}>
					<div
						style={{
							backgroundColor: 'rgba(239, 68, 68, 0.08)',
							border: '1px solid rgba(239, 68, 68, 0.3)',
							borderRadius: '0.75rem',
							padding: '1.5rem',
							display: 'flex',
							alignItems: 'center',
							gap: '0.75rem',
						}}
					>
						<AlertCircle size={20} style={{ color: '#ef4444', flexShrink: 0 }} />
						<p style={{ color: '#fca5a5', fontSize: '0.875rem', margin: 0, flex: 1 }}>
							{error instanceof Error ? error.message : 'Failed to load insights'}
						</p>
						<button
							type="button"
							onClick={() => refetch()}
							style={{
								padding: '0.375rem 0.75rem',
								fontSize: '0.8125rem',
								borderRadius: '0.375rem',
								backgroundColor: 'rgba(239, 68, 68, 0.15)',
								border: '1px solid rgba(239, 68, 68, 0.3)',
								color: '#fca5a5',
								cursor: 'pointer',
							}}
						>
							Retry
						</button>
					</div>
				</div>
			)}

			{!isLoading && !isError && insights.length === 0 && (
				<div
					style={{
						backgroundColor: 'var(--bg-secondary)',
						border: '1px solid var(--border-default)',
						borderRadius: '0.75rem',
						padding: '3rem',
						textAlign: 'center',
					}}
				>
					<Lightbulb size={40} style={{ color: 'var(--text-muted)', margin: '0 auto 1rem' }} />
					<p
						style={{
							color: 'var(--text-muted)',
							fontSize: '0.875rem',
							lineHeight: 1.6,
							maxWidth: 400,
							margin: '0 auto',
						}}
					>
						{activeTab === 'all'
							? 'No insights discovered yet. Insights are generated automatically as your knowledge base grows, or trigger a scan via the discover_connections MCP tool.'
							: `No ${activeTab} insights.`}
					</p>
				</div>
			)}

			{!isLoading && !isError && insights.length > 0 && (
				<div
					style={{
						display: 'grid',
						gridTemplateColumns: 'repeat(auto-fill, minmax(min(100%, 420px), 1fr))',
						gap: '1rem',
					}}
				>
					{insights.map((insight) => (
						<InsightCard
							key={insight.id}
							insight={insight}
							onDismiss={(id) => handleStatusChange(id, 'dismissed')}
							onMarkSeen={(id) => handleStatusChange(id, 'seen')}
						/>
					))}
				</div>
			)}
		</div>
	);
}
