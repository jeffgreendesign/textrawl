/**
 * Knowledge Explorer — browse documents with card/table/timeline views.
 */
'use client';

import { Clock, LayoutGrid, Table } from 'lucide-react';
import { useState } from 'react';

type ViewMode = 'card' | 'table' | 'timeline';

export default function KnowledgePage() {
	const [viewMode, setViewMode] = useState<ViewMode>('card');

	const viewButtons: { mode: ViewMode; icon: typeof LayoutGrid; label: string }[] = [
		{ mode: 'card', icon: LayoutGrid, label: 'Cards' },
		{ mode: 'table', icon: Table, label: 'Table' },
		{ mode: 'timeline', icon: Clock, label: 'Timeline' },
	];

	return (
		<div>
			<div className="page-header-row">
				<h2 style={{ fontSize: '1.5rem', fontWeight: 600 }}>Knowledge Explorer</h2>
				<div
					style={{
						display: 'flex',
						gap: '0.25rem',
						backgroundColor: 'var(--bg-tertiary)',
						borderRadius: '0.5rem',
						padding: '0.25rem',
					}}
				>
					{viewButtons.map(({ mode, icon: Icon, label }) => (
						<button
							type="button"
							key={mode}
							onClick={() => setViewMode(mode)}
							style={{
								display: 'flex',
								alignItems: 'center',
								gap: '0.375rem',
								padding: '0.375rem 0.75rem',
								fontSize: '0.8125rem',
								borderRadius: '0.375rem',
								border: 'none',
								cursor: 'pointer',
								backgroundColor: viewMode === mode ? 'var(--bg-hover)' : 'transparent',
								color: viewMode === mode ? 'var(--text-primary)' : 'var(--text-muted)',
							}}
						>
							<Icon size={14} />
							{label}
						</button>
					))}
				</div>
			</div>

			{viewMode === 'card' && (
				<div
					style={{
						display: 'grid',
						gridTemplateColumns: 'repeat(auto-fill, minmax(var(--grid-min-card), 1fr))',
						gap: '1rem',
					}}
				>
					<div
						style={{
							backgroundColor: 'var(--bg-secondary)',
							border: '1px solid var(--border-default)',
							borderRadius: '0.75rem',
							padding: '1.25rem',
						}}
					>
						<p style={{ color: 'var(--text-muted)', fontSize: '0.875rem' }}>
							Connect to your server to browse documents as cards.
						</p>
					</div>
				</div>
			)}

			{viewMode === 'table' && (
				<div
					className="table-wrapper"
					style={{
						backgroundColor: 'var(--bg-secondary)',
						border: '1px solid var(--border-default)',
						borderRadius: '0.75rem',
					}}
				>
					<table style={{ width: '100%', borderCollapse: 'collapse', fontSize: '0.875rem' }}>
						<thead>
							<tr style={{ borderBottom: '1px solid var(--border-default)' }}>
								{['Title', 'Type', 'Tags', 'Date'].map((h) => (
									<th
										key={h}
										style={{
											textAlign: 'left',
											padding: '0.75rem 1rem',
											color: 'var(--text-muted)',
											fontWeight: 500,
											fontSize: '0.75rem',
											textTransform: 'uppercase',
										}}
									>
										{h}
									</th>
								))}
							</tr>
						</thead>
						<tbody>
							<tr>
								<td
									colSpan={4}
									style={{ padding: '2rem', textAlign: 'center', color: 'var(--text-muted)' }}
								>
									No documents loaded yet
								</td>
							</tr>
						</tbody>
					</table>
				</div>
			)}

			{viewMode === 'timeline' && (
				<div
					style={{
						borderLeft: '2px solid var(--border-default)',
						paddingLeft: '1.5rem',
						marginLeft: '0.5rem',
					}}
				>
					<p style={{ color: 'var(--text-muted)', fontSize: '0.875rem' }}>
						Timeline view will show documents chronologically.
					</p>
				</div>
			)}
		</div>
	);
}
