/**
 * Memory Graph — visualize entities and relationships.
 */
import { Brain, ExternalLink } from 'lucide-react';

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
				<div style={{ textAlign: 'center', maxWidth: 400 }}>
					<Brain size={40} style={{ color: 'var(--text-muted)', margin: '0 auto 1rem' }} />
					<p
						style={{
							color: 'var(--text-muted)',
							fontSize: '0.875rem',
							marginBottom: '1rem',
							lineHeight: 1.6,
						}}
					>
						Interactive force-directed graph of your entities and relationships. This visualization
						requires a REST API endpoint that is coming soon.
					</p>
					<p style={{ fontSize: '0.8125rem' }}>
						Your memory tools are available via MCP —{' '}
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
	);
}
