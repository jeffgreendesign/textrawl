/**
 * AgentChat — inline chat component that queries knowledge via the ask tool.
 */
'use client';

import { Search, Send } from 'lucide-react';
import { useEffect, useRef, useState } from 'react';

interface Message {
	role: 'user' | 'assistant';
	content: string;
}

interface AgentChatProps {
	placeholder?: string;
	style?: React.CSSProperties;
}

export default function AgentChat({
	placeholder = 'Ask your knowledge base...',
	style,
}: AgentChatProps) {
	const [input, setInput] = useState('');
	const [messages, setMessages] = useState<Message[]>([]);
	const [isLoading, setIsLoading] = useState(false);
	const messagesEndRef = useRef<HTMLDivElement>(null);

	// biome-ignore lint/correctness/useExhaustiveDependencies: scroll on new messages
	useEffect(() => {
		messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' });
	}, [messages, isLoading]);

	const handleSubmit = async (e: React.FormEvent) => {
		e.preventDefault();
		if (!input.trim() || isLoading) return;

		const question = input.trim();
		setInput('');
		setMessages((prev) => [...prev, { role: 'user', content: question }]);
		setIsLoading(true);

		try {
			const token = typeof window !== 'undefined' ? localStorage.getItem('textrawl_token') : null;
			const baseUrl =
				typeof window !== 'undefined' ? localStorage.getItem('textrawl_server') || '' : '';

			const res = await fetch(`${baseUrl}/api/search?q=${encodeURIComponent(question)}&limit=5`, {
				headers: token ? { Authorization: `Bearer ${token}` } : {},
			});

			if (!res.ok) throw new Error('Search failed');

			const data = await res.json();
			const results = data.results || data;

			if (Array.isArray(results) && results.length > 0) {
				const formatted = results
					.map(
						(r: { documentTitle?: string; content?: string; score?: number }, i: number) =>
							`**${i + 1}. ${r.documentTitle || 'Untitled'}** (${((r.score || 0) * 100).toFixed(0)}% match)\n${(r.content || '').slice(0, 200)}...`,
					)
					.join('\n\n');
				setMessages((prev) => [...prev, { role: 'assistant', content: formatted }]);
			} else {
				setMessages((prev) => [
					...prev,
					{ role: 'assistant', content: 'No results found for your query.' },
				]);
			}
		} catch {
			setMessages((prev) => [
				...prev,
				{
					role: 'assistant',
					content: 'Failed to search. Check your server connection in Settings.',
				},
			]);
		} finally {
			setIsLoading(false);
		}
	};

	return (
		<div
			style={{
				display: 'flex',
				flexDirection: 'column',
				backgroundColor: 'var(--bg-secondary)',
				border: '1px solid var(--border-default)',
				borderRadius: '0.75rem',
				overflow: 'hidden',
				...style,
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
				<Search size={14} style={{ color: 'var(--text-accent)' }} />
				<span style={{ fontSize: '0.8125rem', fontWeight: 500 }}>Knowledge Chat</span>
			</div>

			<div style={{ flex: 1, overflow: 'auto', padding: '0.75rem 1rem', minHeight: 200 }}>
				{messages.length === 0 && (
					<p
						style={{
							color: 'var(--text-muted)',
							fontSize: '0.8125rem',
							textAlign: 'center',
							padding: '2rem 0',
						}}
					>
						Ask questions about your knowledge base
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
							lineHeight: 1.6,
							whiteSpace: 'pre-wrap',
						}}
					>
						{msg.content}
					</div>
				))}
				{isLoading && (
					<div
						style={{ padding: '0.5rem 0.75rem', color: 'var(--text-muted)', fontSize: '0.8125rem' }}
					>
						Searching...
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
					value={input}
					onChange={(e) => setInput(e.target.value)}
					placeholder={placeholder}
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
					disabled={!input.trim() || isLoading}
					style={{
						padding: '0.5rem',
						backgroundColor: input.trim() ? 'var(--text-accent)' : 'var(--bg-tertiary)',
						color: input.trim() ? '#000' : 'var(--text-muted)',
						border: 'none',
						borderRadius: '0.5rem',
						cursor: input.trim() ? 'pointer' : 'not-allowed',
					}}
				>
					<Send size={16} />
				</button>
			</form>
		</div>
	);
}
