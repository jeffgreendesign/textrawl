/**
 * Dashboard Home — stats, server status, and live activity feed.
 */
'use client';

import { Brain, FileText, Lightbulb, MessageSquare, Upload, Wifi, WifiOff } from 'lucide-react';
import { useEffect, useRef, useState } from 'react';
import { Area, AreaChart, ResponsiveContainer } from 'recharts';

import { type StatusResponse, connectWebSocket } from '@/lib/api';
import { useStats, useStatus } from '@/lib/queries';

// --- Helpers ---

function formatUptime(seconds: number): string {
	const d = Math.floor(seconds / 86400);
	const h = Math.floor((seconds % 86400) / 3600);
	const m = Math.floor((seconds % 3600) / 60);
	if (d > 0) return `${d}d ${h}h`;
	if (h > 0) return `${h}h ${m}m`;
	return `${m}m`;
}

function timeAgo(dateStr: string): string {
	const diff = Date.now() - new Date(dateStr).getTime();
	const s = Math.floor(diff / 1000);
	if (s < 60) return 'just now';
	const m = Math.floor(s / 60);
	if (m < 60) return `${m}m ago`;
	const h = Math.floor(m / 60);
	if (h < 24) return `${h}h ago`;
	const d = Math.floor(h / 24);
	return `${d}d ago`;
}

// --- Event types ---

interface ActivityEvent {
	id: string;
	event: string;
	data: Record<string, unknown>;
	timestamp: string;
}

const EVENT_CONFIG: Record<
	string,
	{ icon: typeof FileText; color: string; format: (d: Record<string, unknown>) => string }
> = {
	document_ingested: {
		icon: FileText,
		color: '#22c55e',
		format: (d) => `Document added: ${d.title ?? 'Untitled'} (${d.chunksCreated ?? 0} chunks)`,
	},
	upload_progress: {
		icon: Upload,
		color: '#3b82f6',
		format: (d) => `Upload: ${d.stage ?? 'processing'} (${d.progress ?? 0}%)`,
	},
	extraction_complete: {
		icon: Brain,
		color: '#a78bfa',
		format: (d) =>
			`Extraction complete: ${d.entitiesFound ?? 0} entities, ${d.relationsFound ?? 0} relations`,
	},
	insight_discovered: {
		icon: Lightbulb,
		color: '#fb923c',
		format: (d) => `New insights: ${d.insightCount ?? 0} discovered`,
	},
};

// --- Status Banner Colors ---

const STATUS_STYLES: Record<string, { bg: string; border: string; label: string }> = {
	operational: {
		bg: 'rgba(34, 197, 94, 0.08)',
		border: '#22c55e',
		label: 'All Systems Operational',
	},
	degraded: {
		bg: 'rgba(234, 179, 8, 0.08)',
		border: '#eab308',
		label: 'Partial Degradation',
	},
	down: {
		bg: 'rgba(239, 68, 68, 0.08)',
		border: '#ef4444',
		label: 'Service Disruption',
	},
};

// --- Components ---

function StatCard({
	label,
	value,
	color,
	icon: Icon,
}: {
	label: string;
	value: number | null | undefined;
	color: string;
	icon: typeof FileText;
}) {
	// Single data point for now — sparkline becomes useful with historical data
	const sparkData = value != null ? [{ v: 0 }, { v: value * 0.7 }, { v: value }] : [];

	return (
		<div
			style={{
				backgroundColor: 'var(--bg-secondary)',
				border: '1px solid var(--border-default)',
				borderRadius: '0.75rem',
				padding: '1.25rem',
				position: 'relative',
				overflow: 'hidden',
			}}
		>
			<div
				style={{
					display: 'flex',
					alignItems: 'center',
					gap: '0.5rem',
					marginBottom: '0.5rem',
				}}
			>
				<Icon size={14} style={{ color: 'var(--text-muted)' }} />
				<span
					style={{
						fontSize: '0.75rem',
						color: 'var(--text-muted)',
						textTransform: 'uppercase',
						letterSpacing: '0.05em',
					}}
				>
					{label}
				</span>
			</div>
			<div
				style={{
					fontSize: '2rem',
					fontWeight: 700,
					fontFamily: 'var(--font-mono)',
					color,
				}}
			>
				{value != null ? value.toLocaleString() : '—'}
			</div>
			{sparkData.length > 0 && (
				<div
					style={{
						position: 'absolute',
						bottom: 0,
						right: 0,
						width: 100,
						height: 36,
						opacity: 0.3,
					}}
				>
					<ResponsiveContainer width="100%" height="100%">
						<AreaChart data={sparkData}>
							<Area
								type="monotone"
								dataKey="v"
								stroke={color}
								fill={color}
								strokeWidth={1.5}
								fillOpacity={0.3}
								isAnimationActive={false}
							/>
						</AreaChart>
					</ResponsiveContainer>
				</div>
			)}
		</div>
	);
}

function ServerStatusPanel({ status }: { status: StatusResponse }) {
	const style = STATUS_STYLES[status.overall] ?? STATUS_STYLES.down;

	return (
		<div
			style={{
				backgroundColor: style.bg,
				border: `1px solid ${style.border}`,
				borderRadius: '0.75rem',
				padding: '1.25rem',
				marginBottom: '2rem',
			}}
		>
			<div
				style={{
					display: 'flex',
					alignItems: 'center',
					gap: '0.75rem',
					marginBottom: '1rem',
					flexWrap: 'wrap',
				}}
			>
				<div
					style={{
						width: 10,
						height: 10,
						borderRadius: '50%',
						backgroundColor: style.border,
						boxShadow: `0 0 8px ${style.border}`,
						flexShrink: 0,
					}}
				/>
				<span style={{ fontWeight: 600, fontSize: '0.9375rem' }}>{style.label}</span>
				<span
					style={{
						marginLeft: 'auto',
						fontSize: '0.75rem',
						fontFamily: 'var(--font-mono)',
						color: 'var(--text-muted)',
					}}
				>
					v{status.version} · up {formatUptime(status.uptime)}
				</span>
			</div>
			<div
				style={{
					display: 'flex',
					gap: '0.5rem',
					flexWrap: 'wrap',
					alignItems: 'center',
				}}
			>
				{Object.entries(status.features).map(([key, val]) => (
					<span
						key={key}
						style={{
							fontSize: '0.6875rem',
							padding: '0.125rem 0.5rem',
							borderRadius: '9999px',
							fontFamily: 'var(--font-mono)',
							backgroundColor: val ? 'rgba(34, 197, 94, 0.15)' : 'rgba(113, 113, 122, 0.15)',
							color: val ? '#22c55e' : '#71717a',
						}}
					>
						{key}
					</span>
				))}
				<span
					style={{
						fontSize: '0.6875rem',
						padding: '0.125rem 0.5rem',
						borderRadius: '9999px',
						fontFamily: 'var(--font-mono)',
						backgroundColor: 'rgba(59, 130, 246, 0.15)',
						color: '#60a5fa',
						marginLeft: '0.25rem',
					}}
				>
					{status.embedding.provider}: {status.embedding.model}
				</span>
			</div>
		</div>
	);
}

// --- Page ---

export default function DashboardHome() {
	const { data: stats } = useStats();
	const { data: status } = useStatus();
	const [events, setEvents] = useState<ActivityEvent[]>([]);
	const [wsConnected, setWsConnected] = useState(false);
	const wsRef = useRef<WebSocket | null>(null);
	const reconnectTimeout = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);
	const reconnectDelay = useRef(5000);

	// WebSocket connection with auto-reconnect
	useEffect(() => {
		let mounted = true;

		function connect() {
			const ws = connectWebSocket((evt) => {
				if (!mounted) return;
				setEvents((prev) =>
					[
						{
							id: `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
							event: evt.event,
							data: evt.data as Record<string, unknown>,
							timestamp: new Date().toISOString(),
						},
						...prev,
					].slice(0, 30),
				);
			});
			if (!ws) return;
			wsRef.current = ws;

			ws.onopen = () => {
				if (!mounted) return;
				setWsConnected(true);
				reconnectDelay.current = 5000;
			};

			ws.onclose = () => {
				if (!mounted) return;
				setWsConnected(false);
				reconnectTimeout.current = setTimeout(() => {
					reconnectDelay.current = Math.min(reconnectDelay.current * 1.5, 60000);
					connect();
				}, reconnectDelay.current);
			};
		}

		connect();

		return () => {
			mounted = false;
			clearTimeout(reconnectTimeout.current);
			wsRef.current?.close();
		};
	}, []);

	const cards = [
		{
			label: 'Documents',
			value: stats?.documents,
			color: 'var(--text-accent)',
			icon: FileText,
		},
		{
			label: 'Memories',
			value: stats?.memories,
			color: '#60a5fa',
			icon: Brain,
		},
		{
			label: 'Conversations',
			value: stats?.conversations,
			color: '#a78bfa',
			icon: MessageSquare,
		},
		{
			label: 'Insights',
			value: stats?.insights,
			color: '#fb923c',
			icon: Lightbulb,
		},
	];

	const hasToken = typeof window !== 'undefined' && !!localStorage.getItem('textrawl_token');

	return (
		<div>
			<h2
				style={{
					fontSize: '1.5rem',
					fontWeight: 600,
					marginBottom: '1.5rem',
				}}
			>
				Dashboard
			</h2>

			{/* Stats cards */}
			<div
				style={{
					display: 'grid',
					gridTemplateColumns: 'repeat(auto-fit, minmax(var(--grid-min-stat), 1fr))',
					gap: '1rem',
					marginBottom: '2rem',
				}}
			>
				{cards.map((c) => (
					<StatCard key={c.label} {...c} />
				))}
			</div>

			{/* Server status */}
			{status && <ServerStatusPanel status={status} />}
			{!status && (
				<div
					style={{
						backgroundColor: 'var(--bg-secondary)',
						border: '1px solid var(--border-default)',
						borderRadius: '0.75rem',
						padding: '1.5rem',
						marginBottom: '2rem',
					}}
				>
					<h3
						style={{
							fontSize: '1rem',
							fontWeight: 600,
							marginBottom: '0.5rem',
						}}
					>
						Server Status
					</h3>
					<p
						style={{
							color: 'var(--text-muted)',
							fontSize: '0.875rem',
						}}
					>
						Connecting to server...
					</p>
				</div>
			)}

			{/* Activity feed */}
			<div
				style={{
					backgroundColor: 'var(--bg-secondary)',
					border: '1px solid var(--border-default)',
					borderRadius: '0.75rem',
					padding: '1.5rem',
				}}
			>
				<div
					style={{
						display: 'flex',
						alignItems: 'center',
						justifyContent: 'space-between',
						marginBottom: '1rem',
					}}
				>
					<h3 style={{ fontSize: '1rem', fontWeight: 600 }}>Recent Activity</h3>
					<span
						style={{
							display: 'flex',
							alignItems: 'center',
							gap: '0.375rem',
							fontSize: '0.75rem',
							color: wsConnected ? '#22c55e' : 'var(--text-muted)',
						}}
					>
						{wsConnected ? <Wifi size={12} /> : <WifiOff size={12} />}
						{wsConnected ? 'Live' : 'Disconnected'}
					</span>
				</div>

				{!hasToken && events.length === 0 && (
					<p style={{ color: 'var(--text-muted)', fontSize: '0.875rem' }}>
						Set your API token in{' '}
						<a href="/settings" style={{ color: 'var(--text-accent)', textDecoration: 'none' }}>
							Settings
						</a>{' '}
						to enable real-time events.
					</p>
				)}

				{hasToken && events.length === 0 && (
					<p style={{ color: 'var(--text-muted)', fontSize: '0.875rem' }}>
						Listening for real-time events...
					</p>
				)}

				{events.length > 0 && (
					<div
						style={{
							display: 'flex',
							flexDirection: 'column',
							gap: '0.5rem',
						}}
					>
						{events.map((evt) => {
							const config = EVENT_CONFIG[evt.event];
							const Icon = config?.icon ?? FileText;
							const color = config?.color ?? 'var(--text-muted)';
							const message = config
								? config.format(evt.data)
								: `${evt.event}: ${JSON.stringify(evt.data)}`;

							return (
								<div
									key={evt.id}
									style={{
										display: 'flex',
										alignItems: 'flex-start',
										gap: '0.75rem',
										padding: '0.625rem 0',
										borderBottom: '1px solid var(--border-default)',
									}}
								>
									<Icon
										size={16}
										style={{
											color,
											flexShrink: 0,
											marginTop: 2,
										}}
									/>
									<div style={{ flex: 1, minWidth: 0 }}>
										<p
											style={{
												fontSize: '0.8125rem',
												lineHeight: 1.4,
											}}
										>
											{message}
										</p>
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
										{timeAgo(evt.timestamp)}
									</span>
								</div>
							);
						})}
					</div>
				)}
			</div>
		</div>
	);
}
