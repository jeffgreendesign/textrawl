/**
 * Settings — server connection and preferences.
 */
'use client';

import { useEffect, useState } from 'react';

export default function SettingsPage() {
	const [serverUrl, setServerUrl] = useState('');
	const [token, setToken] = useState('');
	const [saved, setSaved] = useState(false);

	useEffect(() => {
		setServerUrl(localStorage.getItem('textrawl_server') || '');
		setToken(localStorage.getItem('textrawl_token') || '');
	}, []);

	const handleSave = () => {
		localStorage.setItem('textrawl_server', serverUrl);
		localStorage.setItem('textrawl_token', token);
		setSaved(true);
		setTimeout(() => setSaved(false), 2000);
	};

	const fieldStyle = {
		width: '100%',
		padding: '0.5rem 0.75rem',
		backgroundColor: 'var(--bg-secondary)',
		border: '1px solid var(--border-default)',
		borderRadius: '0.5rem',
		color: 'var(--text-primary)',
		fontSize: '0.875rem',
		boxSizing: 'border-box' as const,
	};

	return (
		<div>
			<h2 style={{ fontSize: '1.5rem', fontWeight: 600, marginBottom: '1.5rem' }}>Settings</h2>

			<div style={{ maxWidth: 560, display: 'flex', flexDirection: 'column', gap: '1.5rem' }}>
				{/* Server Connection */}
				<div
					style={{
						backgroundColor: 'var(--bg-secondary)',
						border: '1px solid var(--border-default)',
						borderRadius: '0.75rem',
						padding: '1.5rem',
					}}
				>
					<h3 style={{ fontSize: '1rem', fontWeight: 600, marginBottom: '0.5rem' }}>
						Server Connection
					</h3>

					<p
						style={{
							fontSize: '0.8125rem',
							color: 'var(--text-muted)',
							lineHeight: 1.5,
							marginBottom: '1rem',
						}}
					>
						Enter the URL of your Textrawl server and the{' '}
						<code
							style={{
								fontSize: '0.75rem',
								backgroundColor: 'var(--bg-primary)',
								padding: '0.125rem 0.375rem',
								borderRadius: '0.25rem',
							}}
						>
							API_BEARER_TOKEN
						</code>{' '}
						value from your server&apos;s{' '}
						<code
							style={{
								fontSize: '0.75rem',
								backgroundColor: 'var(--bg-primary)',
								padding: '0.125rem 0.375rem',
								borderRadius: '0.25rem',
							}}
						>
							.env
						</code>{' '}
						file. Generate a token with{' '}
						<code
							style={{
								fontSize: '0.75rem',
								backgroundColor: 'var(--bg-primary)',
								padding: '0.125rem 0.375rem',
								borderRadius: '0.25rem',
							}}
						>
							openssl rand -base64 32
						</code>{' '}
						or run{' '}
						<code
							style={{
								fontSize: '0.75rem',
								backgroundColor: 'var(--bg-primary)',
								padding: '0.125rem 0.375rem',
								borderRadius: '0.25rem',
							}}
						>
							pnpm setup
						</code>
						.{' '}
						<a
							href="/docs/getting-started/configuration"
							target="_blank"
							rel="noopener noreferrer"
							style={{ color: 'var(--text-accent)' }}
						>
							See the configuration docs
						</a>{' '}
						for full setup details.
					</p>

					<div style={{ marginBottom: '1rem' }}>
						<label
							htmlFor="settings-server-url"
							style={{
								fontSize: '0.8125rem',
								color: 'var(--text-muted)',
								display: 'block',
								marginBottom: '0.375rem',
							}}
						>
							Server URL
						</label>
						<input
							id="settings-server-url"
							type="text"
							value={serverUrl}
							onChange={(e) => setServerUrl(e.target.value)}
							placeholder="http://localhost:3000"
							style={fieldStyle}
						/>
					</div>

					<div style={{ marginBottom: '1rem' }}>
						<label
							htmlFor="settings-api-token"
							style={{
								fontSize: '0.8125rem',
								color: 'var(--text-muted)',
								display: 'block',
								marginBottom: '0.375rem',
							}}
						>
							API Token
						</label>
						<input
							id="settings-api-token"
							type="password"
							value={token}
							onChange={(e) => setToken(e.target.value)}
							placeholder="Bearer token for authentication"
							style={fieldStyle}
						/>
					</div>

					<button
						type="button"
						onClick={handleSave}
						style={{
							padding: '0.5rem 1.25rem',
							backgroundColor: saved ? '#22c55e' : 'var(--text-accent)',
							color: '#000',
							border: 'none',
							borderRadius: '0.5rem',
							fontWeight: 600,
							fontSize: '0.8125rem',
							cursor: 'pointer',
						}}
					>
						{saved ? 'Saved' : 'Save'}
					</button>
				</div>

				{/* Preferences */}
				<div
					style={{
						backgroundColor: 'var(--bg-secondary)',
						border: '1px solid var(--border-default)',
						borderRadius: '0.75rem',
						padding: '1.5rem',
					}}
				>
					<h3 style={{ fontSize: '1rem', fontWeight: 600, marginBottom: '1rem' }}>Preferences</h3>
					<p style={{ color: 'var(--text-muted)', fontSize: '0.875rem' }}>
						Theme, default views, and notification preferences will be configurable here.
					</p>
				</div>
			</div>
		</div>
	);
}
