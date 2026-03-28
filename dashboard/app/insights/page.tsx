/**
 * Insights — view discovered patterns and connections.
 */
import { ExternalLink, Lightbulb } from 'lucide-react';

export default function InsightsPage() {
	return (
		<div>
			<h2 style={{ fontSize: '1.5rem', fontWeight: 600, marginBottom: '1.5rem' }}>Insights</h2>
			<div
				style={{
					display: 'grid',
					gridTemplateColumns: 'repeat(auto-fill, minmax(var(--grid-min-insight), 1fr))',
					gap: '1rem',
				}}
			>
				<div
					style={{
						backgroundColor: 'var(--bg-secondary)',
						border: '1px solid var(--border-default)',
						borderRadius: '0.75rem',
						padding: '2rem',
						display: 'flex',
						alignItems: 'center',
						justifyContent: 'center',
						minHeight: 300,
					}}
				>
					<div style={{ textAlign: 'center', maxWidth: 400 }}>
						<Lightbulb size={40} style={{ color: 'var(--text-muted)', margin: '0 auto 1rem' }} />
						<p
							style={{
								color: 'var(--text-muted)',
								fontSize: '0.875rem',
								marginBottom: '1rem',
								lineHeight: 1.6,
							}}
						>
							Cross-source connections, theme clusters, and outlier discoveries will appear here.
							This view requires a REST API endpoint that is coming soon.
						</p>
						<p style={{ fontSize: '0.8125rem' }}>
							Insight tools are available via MCP —{' '}
							<a
								href="/agents"
								style={{
									color: 'var(--text-accent)',
									textDecoration: 'none',
									display: 'inline-flex',
									alignItems: 'center',
									gap: '0.25rem',
								}}
							>
								check the Agents page <ExternalLink size={12} />
							</a>{' '}
							to see if they are operational.
						</p>
					</div>
				</div>
			</div>
		</div>
	);
}
