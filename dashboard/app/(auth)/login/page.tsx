/**
 * Login — OAuth login page.
 */
'use client';

import { useState } from 'react';

export default function LoginPage() {
	const [serverUrl, setServerUrl] = useState('http://localhost:3100');

	const handleGoogleLogin = () => {
		window.location.href = `${serverUrl}/auth/google`;
	};

	return (
		<div
			style={{
				display: 'flex',
				alignItems: 'center',
				justifyContent: 'center',
				minHeight: '100vh',
				backgroundColor: 'var(--bg-primary)',
			}}
		>
			<div
				style={{
					width: '100%',
					maxWidth: 400,
					padding: '2.5rem',
					backgroundColor: 'var(--bg-secondary)',
					border: '1px solid var(--border-default)',
					borderRadius: '1rem',
					textAlign: 'center',
				}}
			>
				<h1
					style={{
						fontSize: '1.75rem',
						fontWeight: 700,
						marginBottom: '0.5rem',
						background: 'linear-gradient(135deg, #84cc16, #a3e635)',
						WebkitBackgroundClip: 'text',
						WebkitTextFillColor: 'transparent',
					}}
				>
					Textrawl
				</h1>
				<p style={{ color: 'var(--text-muted)', fontSize: '0.875rem', marginBottom: '2rem' }}>
					Sign in to your second brain
				</p>

				<div style={{ marginBottom: '1.5rem' }}>
					<label
						htmlFor="login-server-url"
						style={{
							fontSize: '0.8125rem',
							color: 'var(--text-muted)',
							display: 'block',
							marginBottom: '0.375rem',
							textAlign: 'left',
						}}
					>
						Server URL
					</label>
					<input
						id="login-server-url"
						type="text"
						value={serverUrl}
						onChange={(e) => setServerUrl(e.target.value)}
						style={{
							width: '100%',
							padding: '0.5rem 0.75rem',
							backgroundColor: 'var(--bg-primary)',
							border: '1px solid var(--border-default)',
							borderRadius: '0.5rem',
							color: 'var(--text-primary)',
							fontSize: '0.875rem',
						}}
					/>
				</div>

				<button
					type="button"
					onClick={handleGoogleLogin}
					style={{
						width: '100%',
						padding: '0.75rem',
						backgroundColor: 'var(--text-accent)',
						color: '#000',
						border: 'none',
						borderRadius: '0.5rem',
						fontWeight: 600,
						fontSize: '0.9375rem',
						cursor: 'pointer',
						marginBottom: '1rem',
					}}
				>
					Sign in with Google
				</button>

				<p style={{ color: 'var(--text-muted)', fontSize: '0.75rem' }}>
					Uses your Textrawl server&apos;s Google OAuth integration
				</p>
			</div>
		</div>
	);
}
