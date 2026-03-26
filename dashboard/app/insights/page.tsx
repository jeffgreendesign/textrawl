/**
 * Insights — view discovered patterns and connections.
 */
export default function InsightsPage() {
	return (
		<div>
			<h2 style={{ fontSize: '1.5rem', fontWeight: 600, marginBottom: '1.5rem' }}>Insights</h2>
			<div
				style={{
					display: 'grid',
					gridTemplateColumns: 'repeat(auto-fill, minmax(320px, 1fr))',
					gap: '1rem',
				}}
			>
				<div
					style={{
						backgroundColor: 'var(--bg-secondary)',
						border: '1px solid var(--border-default)',
						borderRadius: '0.75rem',
						padding: '1.5rem',
					}}
				>
					<p style={{ color: 'var(--text-muted)', fontSize: '0.875rem' }}>
						Cross-source connections, theme clusters, and outlier discoveries will appear here.
					</p>
				</div>
			</div>
		</div>
	);
}
