/**
 * Dashboard Home — stats, activity feed, and daily briefing.
 */
export default function DashboardHome() {
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
					gridTemplateColumns: 'repeat(auto-fit, minmax(200px, 1fr))',
					gap: '1rem',
					marginBottom: '2rem',
				}}
			>
				{[
					{ label: 'Documents', value: '—', color: 'var(--text-accent)' },
					{ label: 'Memories', value: '—', color: '#60a5fa' },
					{ label: 'Conversations', value: '—', color: '#a78bfa' },
					{ label: 'Insights', value: '—', color: '#fb923c' },
				].map((stat) => (
					<div
						key={stat.label}
						style={{
							backgroundColor: 'var(--bg-secondary)',
							border: '1px solid var(--border-default)',
							borderRadius: '0.75rem',
							padding: '1.5rem',
						}}
					>
						<div
							style={{
								fontSize: '0.75rem',
								color: 'var(--text-muted)',
								textTransform: 'uppercase',
								letterSpacing: '0.05em',
								marginBottom: '0.5rem',
							}}
						>
							{stat.label}
						</div>
						<div
							style={{
								fontSize: '2rem',
								fontWeight: 700,
								fontFamily: 'var(--font-mono)',
								color: stat.color,
							}}
						>
							{stat.value}
						</div>
					</div>
				))}
			</div>

			{/* Daily briefing section */}
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
						marginBottom: '1rem',
					}}
				>
					Daily Briefing
				</h3>
				<p style={{ color: 'var(--text-muted)', fontSize: '0.875rem' }}>
					Connect to your Textrawl server to see your daily briefing, recent additions, and
					resurfaced knowledge.
				</p>
			</div>

			{/* Activity feed placeholder */}
			<div
				style={{
					backgroundColor: 'var(--bg-secondary)',
					border: '1px solid var(--border-default)',
					borderRadius: '0.75rem',
					padding: '1.5rem',
				}}
			>
				<h3
					style={{
						fontSize: '1rem',
						fontWeight: 600,
						marginBottom: '1rem',
					}}
				>
					Recent Activity
				</h3>
				<p style={{ color: 'var(--text-muted)', fontSize: '0.875rem' }}>
					Real-time activity feed will appear here when connected via WebSocket.
				</p>
			</div>
		</div>
	);
}
