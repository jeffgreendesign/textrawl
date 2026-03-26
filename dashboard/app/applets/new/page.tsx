/**
 * New Applet — AI-powered applet creation wizard.
 */
'use client';

import { Code, Eye, Send, Sparkles } from 'lucide-react';
import { useState } from 'react';

export default function NewAppletPage() {
	const [prompt, setPrompt] = useState('');
	const [messages, setMessages] = useState<{ role: 'user' | 'assistant'; content: string }[]>([]);
	const [generatedCode, setGeneratedCode] = useState('');
	const [activeTab, setActiveTab] = useState<'preview' | 'code'>('preview');
	const [isGenerating, setIsGenerating] = useState(false);

	const handleSubmit = async (e: React.FormEvent) => {
		e.preventDefault();
		if (!prompt.trim() || isGenerating) return;

		const userMsg = prompt.trim();
		setPrompt('');
		setMessages((prev) => [...prev, { role: 'user', content: userMsg }]);
		setIsGenerating(true);

		// TODO: Call POST /api/applets/generate with the prompt
		// For now, show a placeholder response
		setTimeout(() => {
			setMessages((prev) => [
				...prev,
				{
					role: 'assistant',
					content: `I'll create that for you. Here's a custom UI based on your request: "${userMsg}"`,
				},
			]);
			setGeneratedCode(`<div style="padding: 24px; font-family: system-ui;">
  <h2 style="margin-bottom: 16px;">Custom Applet</h2>
  <p style="color: #888;">Generated from: "${userMsg}"</p>
  <p style="margin-top: 12px;">Connect to your Textrawl server to generate live applets with AI.</p>
</div>`);
			setIsGenerating(false);
		}, 1500);
	};

	return (
		<div
			style={{
				display: 'grid',
				gridTemplateColumns: '1fr 1fr',
				gap: '1rem',
				height: 'calc(100vh - 8rem)',
			}}
		>
			{/* Left: Chat panel */}
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
				<div style={{ padding: '1rem 1.25rem', borderBottom: '1px solid var(--border-default)' }}>
					<div style={{ display: 'flex', alignItems: 'center', gap: '0.5rem' }}>
						<Sparkles size={16} style={{ color: 'var(--text-accent)' }} />
						<h3 style={{ fontSize: '0.9375rem', fontWeight: 600 }}>Describe your UI</h3>
					</div>
					<p style={{ fontSize: '0.75rem', color: 'var(--text-muted)', marginTop: '0.25rem' }}>
						Tell the AI what you want to see and it will generate a custom interface.
					</p>
				</div>

				{/* Messages */}
				<div style={{ flex: 1, overflow: 'auto', padding: '1rem' }}>
					{messages.length === 0 && (
						<div
							style={{
								color: 'var(--text-muted)',
								fontSize: '0.8125rem',
								textAlign: 'center',
								padding: '2rem 1rem',
							}}
						>
							<p style={{ marginBottom: '1rem' }}>Try something like:</p>
							<div style={{ display: 'flex', flexDirection: 'column', gap: '0.5rem' }}>
								{[
									'"Show my saved URLs as a reading list"',
									'"Create a Kanban board from my project entities"',
									'"Build a chart of documents added per week"',
								].map((example) => (
									<button
										type="button"
										key={example}
										onClick={() => setPrompt(example.slice(1, -1))}
										style={{
											padding: '0.5rem 0.75rem',
											backgroundColor: 'var(--bg-tertiary)',
											border: '1px solid var(--border-default)',
											borderRadius: '0.5rem',
											color: 'var(--text-primary)',
											fontSize: '0.8125rem',
											cursor: 'pointer',
											textAlign: 'left',
										}}
									>
										{example}
									</button>
								))}
							</div>
						</div>
					)}
					{messages.map((msg, i) => (
						<div
							key={`msg-${i}-${msg.role}`}
							style={{
								marginBottom: '0.75rem',
								padding: '0.625rem 0.875rem',
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
								padding: '0.625rem 0.875rem',
								color: 'var(--text-muted)',
								fontSize: '0.8125rem',
							}}
						>
							Generating...
						</div>
					)}
				</div>

				{/* Input */}
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
						placeholder="Describe the interface you want..."
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

			{/* Right: Preview / Code */}
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
				<div style={{ display: 'flex', borderBottom: '1px solid var(--border-default)' }}>
					{[
						{ tab: 'preview' as const, icon: Eye, label: 'Preview' },
						{ tab: 'code' as const, icon: Code, label: 'Code' },
					].map(({ tab, icon: Icon, label }) => (
						<button
							type="button"
							key={tab}
							onClick={() => setActiveTab(tab)}
							style={{
								display: 'flex',
								alignItems: 'center',
								gap: '0.375rem',
								padding: '0.75rem 1rem',
								backgroundColor: activeTab === tab ? 'var(--bg-primary)' : 'transparent',
								color: activeTab === tab ? 'var(--text-primary)' : 'var(--text-muted)',
								border: 'none',
								borderBottom:
									activeTab === tab ? '2px solid var(--text-accent)' : '2px solid transparent',
								cursor: 'pointer',
								fontSize: '0.8125rem',
								fontWeight: 500,
							}}
						>
							<Icon size={14} />
							{label}
						</button>
					))}
				</div>

				<div style={{ flex: 1, overflow: 'auto' }}>
					{activeTab === 'preview' &&
						(generatedCode ? (
							<iframe
								sandbox="allow-scripts"
								srcDoc={`<!DOCTYPE html><html><head><style>body{margin:0;font-family:system-ui,-apple-system,sans-serif;color:#e5e5e5;background:#1a1a1a;}</style></head><body>${generatedCode}</body></html>`}
								style={{ width: '100%', height: '100%', border: 'none' }}
								title="Applet Preview"
							/>
						) : (
							<div
								style={{
									display: 'flex',
									alignItems: 'center',
									justifyContent: 'center',
									height: '100%',
									color: 'var(--text-muted)',
									fontSize: '0.875rem',
								}}
							>
								Describe your UI to see a live preview
							</div>
						))}
					{activeTab === 'code' && (
						<pre
							style={{
								padding: '1rem',
								fontSize: '0.8125rem',
								fontFamily: 'var(--font-mono)',
								lineHeight: 1.6,
								margin: 0,
								overflow: 'auto',
								height: '100%',
							}}
						>
							{generatedCode || '// Code will appear here after generation'}
						</pre>
					)}
				</div>
			</div>
		</div>
	);
}
