/**
 * Applet Viewer — renders a saved applet in a sandboxed iframe.
 */
'use client';

import { ArrowLeft, Code, Maximize2, MessageSquare, Minimize2, Send } from 'lucide-react';
import Link from 'next/link';
import { useParams } from 'next/navigation';
import { useEffect, useRef, useState } from 'react';

import AppletSandbox from '@/components/applet-sandbox';

function escapeHtml(str: string): string {
	return str
		.replaceAll('&', '&amp;')
		.replaceAll('<', '&lt;')
		.replaceAll('>', '&gt;')
		.replaceAll('"', '&quot;')
		.replaceAll("'", '&#39;');
}

export default function AppletViewerPage() {
	const params = useParams();
	const appletId = params.id as string;
	const [showEditor, setShowEditor] = useState(false);
	const [isFullscreen, setIsFullscreen] = useState(false);
	const [prompt, setPrompt] = useState('');
	const [messages, setMessages] = useState<{ role: 'user' | 'assistant'; content: string }[]>([]);
	const [isGenerating, setIsGenerating] = useState(false);
	const messagesEndRef = useRef<HTMLDivElement>(null);

	// TODO: Fetch applet from API using appletId
	const [appletCode, setAppletCode] = useState(
		`<div style="padding: 24px; font-family: system-ui;">
  <h2 style="margin-bottom: 16px; color: #e5e5e5;">Applet: ${appletId}</h2>
  <p style="color: #888;">This applet will load from your server when connected.</p>
  <p style="color: #666; margin-top: 8px; font-size: 14px;">
    Use the chat panel to edit this applet with AI assistance.
  </p>
</div>`,
	);

	const applet = { id: appletId, title: 'Example Applet', code: appletCode };

	// biome-ignore lint/correctness/useExhaustiveDependencies: scroll on new messages
	useEffect(() => {
		messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' });
	}, [messages, isGenerating]);

	const handleSubmit = async (e: React.FormEvent) => {
		e.preventDefault();
		if (!prompt.trim() || isGenerating) return;

		const userMsg = prompt.trim();
		setPrompt('');
		setMessages((prev) => [...prev, { role: 'user', content: userMsg }]);
		setIsGenerating(true);

		// TODO: Call POST /api/applets/edit with the prompt and current code
		setTimeout(() => {
			setMessages((prev) => [
				...prev,
				{
					role: 'assistant',
					content: `I've updated the applet based on your request: "${userMsg}"`,
				},
			]);
			setAppletCode(`<div style="padding: 24px; font-family: system-ui;">
  <h2 style="margin-bottom: 16px; color: #e5e5e5;">Applet: ${appletId}</h2>
  <p style="color: #888;">Updated from: "${escapeHtml(userMsg)}"</p>
  <p style="color: #666; margin-top: 8px; font-size: 14px;">
    Connect to your Textrawl server to generate live edits with AI.
  </p>
</div>`);
			setIsGenerating(false);
		}, 1500);
	};

	return (
		<div
			style={{
				display: 'flex',
				flexDirection: 'column',
				height: 'calc(100dvh - var(--main-padding) - var(--main-padding) - 5.5rem)',
			}}
		>
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
					<AppletSandbox
						code={applet.code}
						title={applet.title}
						style={{ width: '100%', height: '100%' }}
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
						<div style={{ flex: 1, overflow: 'auto', padding: '1rem' }}>
							{messages.length === 0 && (
								<p style={{ color: 'var(--text-muted)', fontSize: '0.8125rem' }}>
									Chat with AI to modify this applet. Changes render live in the preview.
								</p>
							)}
							{messages.map((msg, i) => (
								<div
									key={`msg-${i}-${msg.role}`}
									style={{
										marginBottom: '0.625rem',
										padding: '0.5rem 0.75rem',
										borderRadius: '0.5rem',
										backgroundColor: msg.role === 'user' ? 'var(--bg-tertiary)' : 'transparent',
										fontSize: '0.8125rem',
										lineHeight: 1.5,
									}}
								>
									{msg.content}
								</div>
							))}
							{isGenerating && (
								<div
									style={{
										padding: '0.5rem 0.75rem',
										color: 'var(--text-muted)',
										fontSize: '0.8125rem',
									}}
								>
									Generating...
								</div>
							)}
							<div ref={messagesEndRef} />
						</div>
						<form
							onSubmit={handleSubmit}
							style={{
								padding: '0.75rem 1rem',
								borderTop: '1px solid var(--border-default)',
								display: 'flex',
								gap: '0.5rem',
							}}
						>
							<input
								type="text"
								value={prompt}
								onChange={(e) => setPrompt(e.target.value)}
								placeholder="Describe changes..."
								style={{
									flex: 1,
									padding: '0.5rem 0.75rem',
									backgroundColor: 'var(--bg-primary)',
									border: '1px solid var(--border-default)',
									borderRadius: '0.5rem',
									color: 'var(--text-primary)',
									fontSize: '0.8125rem',
								}}
							/>
							<button
								type="submit"
								disabled={!prompt.trim() || isGenerating}
								style={{
									padding: '0.5rem',
									backgroundColor: prompt.trim() ? 'var(--text-accent)' : 'var(--bg-tertiary)',
									color: prompt.trim() ? '#000' : 'var(--text-muted)',
									border: 'none',
									borderRadius: '0.5rem',
									cursor: prompt.trim() ? 'pointer' : 'not-allowed',
								}}
							>
								<Send size={16} />
							</button>
						</form>
					</div>
				)}
			</div>
		</div>
	);
}
