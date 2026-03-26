/**
 * Timeline — chronological view of all knowledge.
 */
export default function TimelinePage() {
	return (
		<div>
			<h2 style={{ fontSize: '1.5rem', fontWeight: 600, marginBottom: '1.5rem' }}>Timeline</h2>
			<div
				style={{
					borderLeft: '2px solid var(--text-accent)',
					paddingLeft: '1.5rem',
					marginLeft: '0.5rem',
				}}
			>
				<p style={{ color: 'var(--text-muted)', fontSize: '0.875rem' }}>
					Chronological view of your knowledge, grouped by day/week/month. Select a date range to
					explore.
				</p>
			</div>
		</div>
	);
}
