/**
 * Memory Graph — visualize entities and relationships.
 */
export default function MemoryPage() {
	return (
		<div>
			<h2 style={{ fontSize: '1.5rem', fontWeight: 600, marginBottom: '1.5rem' }}>Memory Graph</h2>
			<div
				className="graph-container"
				style={{
					backgroundColor: 'var(--bg-secondary)',
					border: '1px solid var(--border-default)',
					borderRadius: '0.75rem',
					padding: '2rem',
					minHeight: 400,
					display: 'flex',
					alignItems: 'center',
					justifyContent: 'center',
				}}
			>
				<p style={{ color: 'var(--text-muted)', fontSize: '0.875rem', textAlign: 'center' }}>
					Interactive force-directed graph of your entities and relationships.
					<br />
					Connect to your server to visualize your memory graph.
				</p>
			</div>
		</div>
	);
}
