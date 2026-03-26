/**
 * Applet Viewer — renders a saved applet in a sandboxed iframe.
 */
'use client';

import { ArrowLeft, Code, Maximize2, MessageSquare, Minimize2 } from 'lucide-react';
import Link from 'next/link';
import { useParams } from 'next/navigation';
import { useState } from 'react';

export default function AppletViewerPage() {
	const params = useParams();
	const appletId = params.id as string;
	const [showEditor, setShowEditor] = useState(false);
	const [isFullscreen, setIsFullscreen] = useState(false);

	// TODO: Fetch applet from API using appletId
	const applet = {
		id: appletId,
		title: 'Example Applet',
		code: `<div style="padding: 24px; font-family: system-ui;">
  <h2 style="margin-bottom: 16px; color: #e5e5e5;">Applet: ${appletId}</h2>
  <p style="color: #888;">This applet will load from your server when connected.</p>
  <p style="color: #666; margin-top: 8px; font-size: 14px;">
    Use the chat panel to edit this applet with AI assistance.
  </p>
</div>`,
	};

	const sandboxHtml = `<!DOCTYPE html>
<html>
<head>
<style>body{margin:0;font-family:system-ui,-apple-system,sans-serif;color:#e5e5e5;background:#1a1a1a;}</style>
<script>
// Textrawl bridge — postMessage API for sandboxed applets
window.textrawl = {
  search: (q) => new Promise((resolve) => {
    const id = Math.random().toString(36).slice(2);
    window.addEventListener('message', function handler(e) {
      if (e.data?.id === id) { window.removeEventListener('message', handler); resolve(e.data.result); }
    });
    parent.postMessage({ type: 'textrawl_api', method: 'search', args: [q], id }, '*');
  }),
  documents: () => new Promise((resolve) => {
    const id = Math.random().toString(36).slice(2);
    window.addEventListener('message', function handler(e) {
      if (e.data?.id === id) { window.removeEventListener('message', handler); resolve(e.data.result); }
    });
    parent.postMessage({ type: 'textrawl_api', method: 'documents', args: [], id }, '*');
  }),
};
</script>
</head>
<body>${applet.code}</body>
</html>`;

	return (
		<div style={{ display: 'flex', flexDirection: 'column', height: 'calc(100vh - 8rem)' }}>
			{/* Header */}
			<div
				style={{
					display: 'flex',
					alignItems: 'center',
					gap: '0.75rem',
					marginBottom: '1rem',
					flexShrink: 0,
				}}
			>
				<Link href="/applets" style={{ color: 'var(--text-muted)', display: 'flex' }}>
					<ArrowLeft size={20} />
				</Link>
				<h2 style={{ fontSize: '1.25rem', fontWeight: 600, flex: 1 }}>{applet.title}</h2>
				<button
					type="button"
					onClick={() => setShowEditor(!showEditor)}
					style={{
						display: 'flex',
						alignItems: 'center',
						gap: '0.375rem',
						padding: '0.375rem 0.75rem',
						backgroundColor: showEditor ? 'var(--text-accent)' : 'var(--bg-secondary)',
						color: showEditor ? '#000' : 'var(--text-muted)',
						border: '1px solid var(--border-default)',
						borderRadius: '0.375rem',
						fontSize: '0.75rem',
						cursor: 'pointer',
					}}
				>
					<MessageSquare size={14} />
					Edit
				</button>
				<button
					type="button"
					onClick={() => setIsFullscreen(!isFullscreen)}
					style={{
						display: 'flex',
						padding: '0.375rem',
						backgroundColor: 'var(--bg-secondary)',
						border: '1px solid var(--border-default)',
						borderRadius: '0.375rem',
						color: 'var(--text-muted)',
						cursor: 'pointer',
					}}
				>
					{isFullscreen ? <Minimize2 size={14} /> : <Maximize2 size={14} />}
				</button>
			</div>

			{/* Content */}
			<div
				style={{
					display: 'grid',
					gridTemplateColumns: showEditor ? '1fr 360px' : '1fr',
					gap: '1rem',
					flex: 1,
					minHeight: 0,
				}}
			>
				{/* Sandboxed iframe */}
				<div
					style={{
						backgroundColor: 'var(--bg-secondary)',
						border: '1px solid var(--border-default)',
						borderRadius: '0.75rem',
						overflow: 'hidden',
					}}
				>
					<iframe
						sandbox="allow-scripts"
						srcDoc={sandboxHtml}
						style={{ width: '100%', height: '100%', border: 'none' }}
						title={applet.title}
					/>
				</div>

				{/* Editor panel */}
				{showEditor && (
					<div
						style={{
							display: 'flex',
							flexDirection: 'column',
							backgroundColor: 'var(--bg-secondary)',
							border: '1px solid var(--border-default)',
							borderRadius: '0.75rem',
							overflow: 'hidden',
						}}
					>
						<div
							style={{
								padding: '0.75rem 1rem',
								borderBottom: '1px solid var(--border-default)',
								display: 'flex',
								alignItems: 'center',
								gap: '0.5rem',
							}}
						>
							<Code size={14} style={{ color: 'var(--text-accent)' }} />
							<span style={{ fontSize: '0.8125rem', fontWeight: 500 }}>Edit with AI</span>
						</div>
						<div style={{ flex: 1, padding: '1rem', overflow: 'auto' }}>
							<p style={{ color: 'var(--text-muted)', fontSize: '0.8125rem' }}>
								Chat with AI to modify this applet. Changes render live in the preview.
							</p>
						</div>
						<div style={{ padding: '0.75rem 1rem', borderTop: '1px solid var(--border-default)' }}>
							<input
								type="text"
								placeholder="Describe changes..."
								style={{
									width: '100%',
									padding: '0.5rem 0.75rem',
									backgroundColor: 'var(--bg-primary)',
									border: '1px solid var(--border-default)',
									borderRadius: '0.5rem',
									color: 'var(--text-primary)',
									fontSize: '0.8125rem',
								}}
							/>
						</div>
					</div>
				)}
			</div>
		</div>
	);
}
