/**
 * Agents — live server monitor, MCP tool matrix, and feature flags.
 */
'use client';

import { Activity, Bot, Cpu, RefreshCw, Zap } from 'lucide-react';

import { useHealth, useStatus } from '@/lib/queries';

function formatUptime(seconds: number): string {
	const d = Math.floor(seconds / 86400);
	const h = Math.floor((seconds % 86400) / 3600);
	const m = Math.floor((seconds % 3600) / 60);
	if (d > 0) return `${d}d ${h}h`;
	if (h > 0) return `${h}h ${m}m`;
	return `${m}m`;
}

const STATUS_COLORS: Record<string, string> = {
	operational: '#22c55e',
	degraded: '#eab308',
	down: '#ef4444',
	disabled: '#71717a',
	unchecked: '#71717a',
};

const STATUS_BG: Record<string, string> = {
	operational: 'rgba(34, 197, 94, 0.08)',
	degraded: 'rgba(234, 179, 8, 0.08)',
	down: 'rgba(239, 68, 68, 0.08)',
};

const STATUS_LABELS: Record<string, string> = {
	operational: 'All Systems Operational',
	degraded: 'Partial Service Degradation',
	down: 'Service Disruption',
};

function Skeleton({ width, height = 16 }: { width: number | string; height?: number }) {
	return (
		<div
			style={{
				width,
				height,
				borderRadius: 4,
				backgroundColor: 'var(--bg-tertiary)',
				animation: 'pulse 1.5s infinite',
			}}
		/>
	);
}

export default function AgentsPage() {
	const { data: status, isLoading, refetch } = useStatus();
	const { data: health } = useHealth();

	const overall = status?.overall ?? 'down';
	const color = STATUS_COLORS[overall] ?? '#71717a';

	return (
		<div>
			<div className="page-header-row">
				<h2 style={{ fontSize: '1.5rem', fontWeight: 600 }}>Agent Orchestration</h2>
				<button
					type="button"
					onClick={() => refetch()}
					style={{
						display: 'flex',
						alignItems: 'center',
						gap: '0.375rem',
						padding: '0.375rem 0.75rem',
						fontSize: '0.8125rem',
						borderRadius: '0.375rem',
						border: '1px solid var(--border-default)',
						backgroundColor: 'var(--bg-tertiary)',
						color: 'var(--text-secondary)',
						cursor: 'pointer',
					}}
				>
					<RefreshCw size={14} />
					Refresh
				</button>
			</div>

			{/* Overall status banner */}
			<div
				style={{
					backgroundColor: STATUS_BG[overall] ?? 'var(--bg-secondary)',
					border: `1px solid ${color}`,
					borderRadius: '0.75rem',
					padding: '1.25rem',
					marginBottom: '1.5rem',
					display: 'flex',
					alignItems: 'center',
					gap: '0.75rem',
					flexWrap: 'wrap',
				}}
			>
				{isLoading ? (
					<Skeleton width={200} height={20} />
				) : (
					<>
						<div
							style={{
								width: 12,
								height: 12,
								borderRadius: '50%',
								backgroundColor: color,
								boxShadow: `0 0 8px ${color}`,
								flexShrink: 0,
							}}
						/>
						<span style={{ fontWeight: 600, fontSize: '0.9375rem' }}>
							{STATUS_LABELS[overall] ?? overall}
						</span>
						<span
							style={{
								marginLeft: 'auto',
								fontSize: '0.75rem',
								fontFamily: 'var(--font-mono)',
								color: 'var(--text-muted)',
								display: 'flex',
								alignItems: 'center',
								gap: '0.75rem',
							}}
						>
							{status && (
								<>
									v{status.version} · up {formatUptime(status.uptime)}
								</>
							)}
							{health?.ok && <span style={{ color: '#22c55e' }}>{health.latencyMs}ms</span>}
						</span>
					</>
				)}
			</div>

			{/* Services grid */}
			<section style={{ marginBottom: '2rem' }}>
				<h3
					style={{
						fontSize: '0.8125rem',
						fontWeight: 600,
						marginBottom: '0.75rem',
						color: 'var(--text-muted)',
						textTransform: 'uppercase',
						letterSpacing: '0.05em',
					}}
				>
					<Activity
						size={14}
						style={{ display: 'inline', marginRight: '0.5rem', verticalAlign: -2 }}
					/>
					Services
				</h3>
				<div
					style={{
						display: 'grid',
						gridTemplateColumns: 'repeat(auto-fill, minmax(240px, 1fr))',
						gap: '0.75rem',
					}}
				>
					{isLoading
						? Array.from({ length: 4 }, (_, i) => `svc-skel-${i}`).map((key) => (
								<div
									key={key}
									style={{
										backgroundColor: 'var(--bg-secondary)',
										border: '1px solid var(--border-default)',
										borderRadius: '0.75rem',
										padding: '1rem',
									}}
								>
									<Skeleton width={120} />
								</div>
							))
						: status?.services.map((svc) => {
								const svcColor = STATUS_COLORS[svc.status] ?? '#71717a';
								return (
									<div
										key={svc.name}
										style={{
											backgroundColor: 'var(--bg-secondary)',
											border: '1px solid var(--border-default)',
											borderRadius: '0.75rem',
											padding: '1rem',
											display: 'flex',
											alignItems: 'center',
											gap: '0.75rem',
										}}
									>
										<div
											style={{
												width: 8,
												height: 8,
												borderRadius: '50%',
												backgroundColor: svcColor,
												boxShadow: svc.status === 'operational' ? `0 0 6px ${svcColor}` : undefined,
												flexShrink: 0,
											}}
										/>
										<div style={{ flex: 1, minWidth: 0 }}>
											<p style={{ fontSize: '0.875rem', fontWeight: 500 }}>{svc.name}</p>
											<p style={{ fontSize: '0.75rem', color: 'var(--text-muted)' }}>
												{svc.message ?? svc.status}
											</p>
										</div>
										{svc.latencyMs != null && (
											<span
												style={{
													fontSize: '0.75rem',
													fontFamily: 'var(--font-mono)',
													color:
														svc.latencyMs < 100
															? '#22c55e'
															: svc.latencyMs < 500
																? '#eab308'
																: '#ef4444',
												}}
											>
												{svc.latencyMs}ms
											</span>
										)}
									</div>
								);
							})}
				</div>
			</section>

			{/* MCP Tool Matrix */}
			{status && status.tools.length > 0 && (
				<section style={{ marginBottom: '2rem' }}>
					<h3
						style={{
							fontSize: '0.8125rem',
							fontWeight: 600,
							marginBottom: '0.75rem',
							color: 'var(--text-muted)',
							textTransform: 'uppercase',
							letterSpacing: '0.05em',
						}}
					>
						<Cpu
							size={14}
							style={{ display: 'inline', marginRight: '0.5rem', verticalAlign: -2 }}
						/>
						MCP Tools ({status.tools.length})
					</h3>
					<div
						style={{
							display: 'grid',
							gridTemplateColumns: 'repeat(auto-fill, minmax(200px, 1fr))',
							gap: 1,
							backgroundColor: 'var(--border-default)',
							borderRadius: '0.75rem',
							overflow: 'hidden',
						}}
					>
						{status.tools.map((tool) => {
							const toolColor = STATUS_COLORS[tool.status] ?? '#71717a';
							return (
								<div
									key={tool.name}
									title={tool.message ?? tool.status}
									style={{
										backgroundColor: 'var(--bg-secondary)',
										padding: '0.75rem 1rem',
										display: 'flex',
										alignItems: 'center',
										gap: '0.625rem',
									}}
								>
									<div
										style={{
											width: 6,
											height: 6,
											borderRadius: '50%',
											backgroundColor: toolColor,
											flexShrink: 0,
										}}
									/>
									<span
										style={{
											fontSize: '0.8125rem',
											fontFamily: 'var(--font-mono)',
											fontWeight: 500,
										}}
									>
										{tool.name}
									</span>
									<span
										style={{
											marginLeft: 'auto',
											fontSize: '0.625rem',
											color: 'var(--text-muted)',
											textTransform: 'uppercase',
											letterSpacing: '0.05em',
										}}
									>
										{tool.group}
									</span>
								</div>
							);
						})}
					</div>
				</section>
			)}

			{/* Feature Flags */}
			{status && (
				<section style={{ marginBottom: '2rem' }}>
					<h3
						style={{
							fontSize: '0.8125rem',
							fontWeight: 600,
							marginBottom: '0.75rem',
							color: 'var(--text-muted)',
							textTransform: 'uppercase',
							letterSpacing: '0.05em',
						}}
					>
						<Zap
							size={14}
							style={{ display: 'inline', marginRight: '0.5rem', verticalAlign: -2 }}
						/>
						Feature Flags
					</h3>
					<div style={{ display: 'flex', gap: '0.5rem', flexWrap: 'wrap' }}>
						{Object.entries(status.features).map(([key, val]) => (
							<span
								key={key}
								style={{
									fontSize: '0.75rem',
									padding: '0.25rem 0.625rem',
									borderRadius: '9999px',
									fontFamily: 'var(--font-mono)',
									fontWeight: 500,
									backgroundColor: val ? 'rgba(34, 197, 94, 0.15)' : 'rgba(113, 113, 122, 0.15)',
									color: val ? '#22c55e' : '#71717a',
									border: `1px solid ${val ? 'rgba(34, 197, 94, 0.3)' : 'rgba(113, 113, 122, 0.3)'}`,
								}}
							>
								{key}: {val ? 'on' : 'off'}
							</span>
						))}
					</div>
				</section>
			)}

			{/* Embedding Provider */}
			{status && (
				<section style={{ marginBottom: '2rem' }}>
					<h3
						style={{
							fontSize: '0.8125rem',
							fontWeight: 600,
							marginBottom: '0.75rem',
							color: 'var(--text-muted)',
							textTransform: 'uppercase',
							letterSpacing: '0.05em',
						}}
					>
						<Bot
							size={14}
							style={{ display: 'inline', marginRight: '0.5rem', verticalAlign: -2 }}
						/>
						Embedding Provider
					</h3>
					<div
						style={{
							backgroundColor: 'var(--bg-secondary)',
							border: '1px solid var(--border-default)',
							borderRadius: '0.75rem',
							padding: '1rem',
							display: 'flex',
							alignItems: 'center',
							gap: '1rem',
							flexWrap: 'wrap',
						}}
					>
						<div
							style={{
								width: 8,
								height: 8,
								borderRadius: '50%',
								backgroundColor: status.embedding.configured ? '#22c55e' : '#ef4444',
								flexShrink: 0,
							}}
						/>
						<div>
							<span
								style={{
									fontSize: '0.75rem',
									color: 'var(--text-muted)',
									textTransform: 'uppercase',
									letterSpacing: '0.05em',
								}}
							>
								Provider
							</span>{' '}
							<span style={{ fontSize: '0.875rem', fontFamily: 'var(--font-mono)' }}>
								{status.embedding.provider}
							</span>
						</div>
						<div>
							<span
								style={{
									fontSize: '0.75rem',
									color: 'var(--text-muted)',
									textTransform: 'uppercase',
									letterSpacing: '0.05em',
								}}
							>
								Model
							</span>{' '}
							<span style={{ fontSize: '0.875rem', fontFamily: 'var(--font-mono)' }}>
								{status.embedding.model}
							</span>
						</div>
					</div>
				</section>
			)}

			<p style={{ color: 'var(--text-muted)', fontSize: '0.8125rem', marginTop: '1rem' }}>
				Tasks like insight scans, memory extraction, and briefings are executed via MCP tool calls.
			</p>
		</div>
	);
}
