/**
 * Conversations — browse and search past conversations.
 */
export default function ConversationsPage() {
	return (
		<div>
			<h2 style={{ fontSize: '1.5rem', fontWeight: 600, marginBottom: '1.5rem' }}>Conversations</h2>
			<div
				style={{
					backgroundColor: 'var(--bg-secondary)',
					border: '1px solid var(--border-default)',
					borderRadius: '0.75rem',
					padding: '1.5rem',
				}}
			>
				<p style={{ color: 'var(--text-muted)', fontSize: '0.875rem' }}>
					Browse and search your saved conversation history.
				</p>
			</div>
		</div>
	);
}
