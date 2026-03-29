/**
 * Conversations — browse and search past conversations.
 */
'use client';

import { AlertCircle, ChevronLeft, ChevronRight, MessageSquare, Search, X } from 'lucide-react';
import { useState } from 'react';

import type { ConversationSession, ConversationTurn } from '@/lib/api';
import { useConversation, useConversationSearch, useConversations } from '@/lib/queries';

const PAGE_SIZE = 20;

/* ── Helpers ── */

function timeAgo(dateStr: string): string {
	const now = Date.now();
	const then = new Date(dateStr).getTime();
	const seconds = Math.floor((now - then) / 1000);

	if (seconds < 60) return 'just now';
	const minutes = Math.floor(seconds / 60);
	if (minutes < 60) return `${minutes}m ago`;
	const hours = Math.floor(minutes / 60);
	if (hours < 24) return `${hours}h ago`;
	const days = Math.floor(hours / 24);
	if (days < 30) return `${days}d ago`;
	const months = Math.floor(days / 30);
	if (months < 12) return `${months}mo ago`;
	const years = Math.floor(months / 12);
	return `${years}y ago`;
}

function formatTimestamp(dateStr: string): string {
	return new Date(dateStr).toLocaleString('en-US', {
		month: 'short',
		day: 'numeric',
		year: 'numeric',
		hour: 'numeric',
		minute: '2-digit',
	});
}

/* ── Styles ── */

const shimmerStyle = {
	background:
		'linear-gradient(90deg, var(--bg-tertiary) 25%, var(--bg-hover) 50%, var(--bg-tertiary) 75%)',
	backgroundSize: '200% 100%',
	animation: 'shimmer 1.5s infinite',
	borderRadius: '0.375rem',
} as const;

/* ── Skeleton ── */

const SKEL_ITEMS = ['a', 'b', 'c', 'd', 'e'];

function SkeletonList() {
	return (
		<>
			<style>
				{
					'@keyframes shimmer { 0% { background-position: 200% 0; } 100% { background-position: -200% 0; } }'
				}
			</style>
			<div style={{ display: 'flex', flexDirection: 'column', gap: '0.75rem' }}>
				{SKEL_ITEMS.map((k) => (
					<div
						key={k}
						style={{
							backgroundColor: 'var(--bg-secondary)',
							border: '1px solid var(--border-default)',
							borderRadius: '0.75rem',
							padding: '1rem',
							display: 'flex',
							flexDirection: 'column',
							gap: '0.5rem',
						}}
					>
						<div style={{ ...shimmerStyle, height: '1rem', width: '60%' }} />
						<div style={{ ...shimmerStyle, height: '0.625rem', width: '90%' }} />
						<div style={{ ...shimmerStyle, height: '0.625rem', width: '40%' }} />
					</div>
				))}
			</div>
		</>
	);
}

/* ── Error state ── */

function ErrorCard({ message, onRetry }: { message: string; onRetry: () => void }) {
	return (
		<div
			style={{
				backgroundColor: 'rgba(239, 68, 68, 0.08)',
				border: '1px solid rgba(239, 68, 68, 0.3)',
				borderRadius: '0.75rem',
				padding: '1.5rem',
				display: 'flex',
				alignItems: 'center',
				gap: '0.75rem',
			}}
		>
			<AlertCircle size={20} style={{ color: '#ef4444', flexShrink: 0 }} />
			<div style={{ flex: 1 }}>
				<p style={{ color: '#fca5a5', fontSize: '0.875rem', margin: 0 }}>{message}</p>
			</div>
			<button
				type="button"
				onClick={onRetry}
				style={{
					padding: '0.375rem 0.75rem',
					fontSize: '0.8125rem',
					borderRadius: '0.375rem',
					backgroundColor: 'rgba(239, 68, 68, 0.15)',
					border: '1px solid rgba(239, 68, 68, 0.3)',
					color: '#fca5a5',
					cursor: 'pointer',
					flexShrink: 0,
				}}
			>
				Retry
			</button>
		</div>
	);
}

/* ── Pagination ── */

function Pagination({
	offset,
	total,
	onPrev,
	onNext,
}: {
	offset: number;
	total: number;
	onPrev: () => void;
	onNext: () => void;
}) {
	const page = Math.floor(offset / PAGE_SIZE) + 1;
	const totalPages = Math.ceil(total / PAGE_SIZE);

	return (
		<div
			style={{
				display: 'flex',
				alignItems: 'center',
				justifyContent: 'space-between',
				marginTop: '1rem',
				fontSize: '0.8125rem',
				color: 'var(--text-muted)',
				fontFamily: 'var(--font-mono)',
			}}
		>
			<span>
				Page {page} of {totalPages}
			</span>
			<div style={{ display: 'flex', gap: '0.5rem' }}>
				<button
					type="button"
					disabled={offset === 0}
					onClick={onPrev}
					style={{
						display: 'flex',
						alignItems: 'center',
						gap: '0.25rem',
						padding: '0.375rem 0.75rem',
						fontSize: '0.8125rem',
						borderRadius: '0.375rem',
						backgroundColor: 'var(--bg-tertiary)',
						border: '1px solid var(--border-default)',
						color: offset === 0 ? 'var(--text-muted)' : 'var(--text-primary)',
						cursor: offset === 0 ? 'not-allowed' : 'pointer',
						opacity: offset === 0 ? 0.5 : 1,
					}}
				>
					<ChevronLeft size={14} />
					Prev
				</button>
				<button
					type="button"
					disabled={offset + PAGE_SIZE >= total}
					onClick={onNext}
					style={{
						display: 'flex',
						alignItems: 'center',
						gap: '0.25rem',
						padding: '0.375rem 0.75rem',
						fontSize: '0.8125rem',
						borderRadius: '0.375rem',
						backgroundColor: 'var(--bg-tertiary)',
						border: '1px solid var(--border-default)',
						color: offset + PAGE_SIZE >= total ? 'var(--text-muted)' : 'var(--text-primary)',
						cursor: offset + PAGE_SIZE >= total ? 'not-allowed' : 'pointer',
						opacity: offset + PAGE_SIZE >= total ? 0.5 : 1,
					}}
				>
					Next
					<ChevronRight size={14} />
				</button>
			</div>
		</div>
	);
}

/* ── Conversation Card ── */

function ConversationCard({
	session,
	isActive,
	onClick,
}: {
	session: ConversationSession;
	isActive: boolean;
	onClick: () => void;
}) {
	return (
		<button
			type="button"
			onClick={onClick}
			style={{
				display: 'block',
				width: '100%',
				textAlign: 'left',
				backgroundColor: 'var(--bg-secondary)',
				border: `1px solid ${isActive ? 'var(--text-accent)' : 'var(--border-default)'}`,
				borderRadius: '0.75rem',
				padding: '1rem',
				cursor: 'pointer',
				transition: 'border-color 0.2s ease',
			}}
		>
			<div
				style={{ display: 'flex', alignItems: 'center', gap: '0.5rem', marginBottom: '0.375rem' }}
			>
				<h3
					style={{
						margin: 0,
						fontSize: '0.9375rem',
						fontWeight: 600,
						color: 'var(--text-primary)',
						overflow: 'hidden',
						textOverflow: 'ellipsis',
						whiteSpace: 'nowrap',
						flex: 1,
					}}
				>
					{session.title || 'Untitled'}
				</h3>
				<span
					style={{
						display: 'inline-block',
						padding: '0.125rem 0.5rem',
						fontSize: '0.6875rem',
						fontFamily: 'var(--font-mono)',
						fontWeight: 500,
						borderRadius: '9999px',
						backgroundColor: 'rgba(99, 102, 241, 0.15)',
						color: 'var(--text-accent)',
						lineHeight: 1.6,
						flexShrink: 0,
					}}
				>
					{session.turn_count} turn{session.turn_count !== 1 ? 's' : ''}
				</span>
			</div>

			{session.summary && (
				<p
					style={{
						margin: '0 0 0.5rem 0',
						fontSize: '0.8125rem',
						lineHeight: 1.5,
						color: 'var(--text-muted)',
						overflow: 'hidden',
						display: '-webkit-box',
						WebkitLineClamp: 2,
						WebkitBoxOrient: 'vertical',
					}}
				>
					{session.summary}
				</p>
			)}

			<span
				style={{
					fontSize: '0.6875rem',
					fontFamily: 'var(--font-mono)',
					color: 'var(--text-muted)',
				}}
			>
				{timeAgo(session.last_activity)}
			</span>
		</button>
	);
}

/* ── Chat Bubble ── */

function ChatBubble({ turn }: { turn: ConversationTurn }) {
	const isUser = turn.role === 'user';

	return (
		<div
			style={{
				display: 'flex',
				justifyContent: isUser ? 'flex-end' : 'flex-start',
				marginBottom: '0.75rem',
			}}
		>
			<div
				style={{
					maxWidth: '75%',
					backgroundColor: isUser ? 'var(--text-accent)' : 'var(--bg-secondary)',
					color: isUser ? '#fff' : 'var(--text-primary)',
					border: isUser ? 'none' : '1px solid var(--border-default)',
					borderRadius: '0.75rem',
					padding: '0.75rem 1rem',
				}}
			>
				<div
					style={{
						fontSize: '0.6875rem',
						fontFamily: 'var(--font-mono)',
						fontWeight: 600,
						marginBottom: '0.25rem',
						opacity: 0.7,
						textTransform: 'uppercase',
						letterSpacing: '0.025em',
					}}
				>
					{turn.role}
				</div>
				<div
					style={{
						fontSize: '0.875rem',
						lineHeight: 1.6,
						whiteSpace: 'pre-wrap',
						wordBreak: 'break-word',
					}}
				>
					{turn.content}
				</div>
				<div
					style={{
						fontSize: '0.625rem',
						fontFamily: 'var(--font-mono)',
						marginTop: '0.375rem',
						opacity: 0.5,
					}}
				>
					{formatTimestamp(turn.created_at)}
				</div>
			</div>
		</div>
	);
}

/* ── Detail Panel ── */

function ConversationDetailPanel({
	sessionId,
	onClose,
}: {
	sessionId: string;
	onClose: () => void;
}) {
	const { data, isLoading, isError, error, refetch } = useConversation(sessionId);

	if (isLoading) {
		return (
			<div
				style={{
					backgroundColor: 'var(--bg-secondary)',
					border: '1px solid var(--border-default)',
					borderRadius: '0.75rem',
					padding: '1.5rem',
					flex: 1,
					minHeight: 400,
				}}
			>
				<style>
					{
						'@keyframes shimmer { 0% { background-position: 200% 0; } 100% { background-position: -200% 0; } }'
					}
				</style>
				<div style={{ ...shimmerStyle, height: '1.25rem', width: '50%', marginBottom: '1rem' }} />
				<div style={{ ...shimmerStyle, height: '0.75rem', width: '30%', marginBottom: '1.5rem' }} />
				{['a', 'b', 'c'].map((k) => (
					<div
						key={k}
						style={{ ...shimmerStyle, height: '3rem', width: '70%', marginBottom: '0.75rem' }}
					/>
				))}
			</div>
		);
	}

	if (isError) {
		return (
			<div style={{ flex: 1 }}>
				<ErrorCard
					message={(error as Error)?.message ?? 'Failed to load conversation'}
					onRetry={() => refetch()}
				/>
			</div>
		);
	}

	if (!data) return null;

	const { session, turns } = data;

	return (
		<div
			style={{
				backgroundColor: 'var(--bg-secondary)',
				border: '1px solid var(--border-default)',
				borderRadius: '0.75rem',
				padding: '1.5rem',
				flex: 1,
				minHeight: 400,
				display: 'flex',
				flexDirection: 'column',
				overflow: 'hidden',
			}}
		>
			{/* Header */}
			<div
				style={{
					display: 'flex',
					alignItems: 'flex-start',
					justifyContent: 'space-between',
					marginBottom: '1rem',
				}}
			>
				<div style={{ flex: 1, minWidth: 0 }}>
					<h3
						style={{
							margin: 0,
							fontSize: '1.125rem',
							fontWeight: 600,
							color: 'var(--text-primary)',
							overflow: 'hidden',
							textOverflow: 'ellipsis',
							whiteSpace: 'nowrap',
						}}
					>
						{session.title || 'Untitled'}
					</h3>
					<div
						style={{
							fontSize: '0.75rem',
							fontFamily: 'var(--font-mono)',
							color: 'var(--text-muted)',
							marginTop: '0.25rem',
							display: 'flex',
							gap: '1rem',
							flexWrap: 'wrap',
						}}
					>
						<span>Created: {formatTimestamp(session.created_at)}</span>
						<span>Last activity: {formatTimestamp(session.last_activity)}</span>
						<span>{session.turn_count} turns</span>
					</div>
				</div>
				<button
					type="button"
					onClick={onClose}
					style={{
						display: 'flex',
						alignItems: 'center',
						justifyContent: 'center',
						width: '2rem',
						height: '2rem',
						borderRadius: '0.375rem',
						border: '1px solid var(--border-default)',
						backgroundColor: 'transparent',
						color: 'var(--text-muted)',
						cursor: 'pointer',
						flexShrink: 0,
					}}
					aria-label="Close detail panel"
				>
					<X size={16} />
				</button>
			</div>

			{/* Summary */}
			{session.summary && (
				<div
					style={{
						backgroundColor: 'var(--bg-tertiary)',
						borderRadius: '0.5rem',
						padding: '0.75rem 1rem',
						marginBottom: '1rem',
						fontSize: '0.8125rem',
						lineHeight: 1.6,
						color: 'var(--text-muted)',
					}}
				>
					<span
						style={{
							fontWeight: 600,
							fontSize: '0.6875rem',
							textTransform: 'uppercase',
							letterSpacing: '0.025em',
						}}
					>
						Summary
					</span>
					<p style={{ margin: '0.25rem 0 0 0' }}>{session.summary}</p>
				</div>
			)}

			{/* Turns */}
			<div
				style={{
					flex: 1,
					overflowY: 'auto',
					paddingRight: '0.25rem',
				}}
			>
				{turns.length === 0 ? (
					<p
						style={{
							color: 'var(--text-muted)',
							fontSize: '0.875rem',
							textAlign: 'center',
							marginTop: '2rem',
						}}
					>
						No turns recorded in this conversation.
					</p>
				) : (
					turns.map((turn) => <ChatBubble key={turn.id} turn={turn} />)
				)}
			</div>
		</div>
	);
}

/* ── Main Page ── */

export default function ConversationsPage() {
	const [offset, setOffset] = useState(0);
	const [searchQuery, setSearchQuery] = useState('');
	const [selectedId, setSelectedId] = useState<string | null>(null);

	const conversationsQuery = useConversations(PAGE_SIZE, offset);
	const searchQueryResult = useConversationSearch(searchQuery);

	const isSearching = searchQuery.length > 0;
	const activeQuery = isSearching ? searchQueryResult : conversationsQuery;

	const sessions: ConversationSession[] = isSearching
		? (searchQueryResult.data?.results ?? [])
		: (conversationsQuery.data?.sessions ?? []);
	const total = isSearching
		? (searchQueryResult.data?.totalResults ?? 0)
		: (conversationsQuery.data?.total ?? 0);

	function handlePrev() {
		setOffset((prev) => Math.max(0, prev - PAGE_SIZE));
	}

	function handleNext() {
		setOffset((prev) => prev + PAGE_SIZE);
	}

	return (
		<div>
			{/* Header */}
			<div
				style={{ display: 'flex', alignItems: 'center', gap: '0.75rem', marginBottom: '1.5rem' }}
			>
				<h2 style={{ fontSize: '1.5rem', fontWeight: 600, margin: 0 }}>Conversations</h2>
				{!activeQuery.isLoading && !activeQuery.isError && (
					<span
						style={{
							display: 'inline-block',
							padding: '0.125rem 0.5rem',
							fontSize: '0.75rem',
							fontFamily: 'var(--font-mono)',
							fontWeight: 500,
							borderRadius: '9999px',
							backgroundColor: 'var(--bg-tertiary)',
							color: 'var(--text-muted)',
							lineHeight: 1.6,
						}}
					>
						{total}
					</span>
				)}
			</div>

			{/* Search bar */}
			<div
				style={{
					display: 'flex',
					alignItems: 'center',
					gap: '0.5rem',
					marginBottom: '1.5rem',
					backgroundColor: 'var(--bg-secondary)',
					border: '1px solid var(--border-default)',
					borderRadius: '0.5rem',
					padding: '0.5rem 0.75rem',
				}}
			>
				<Search size={16} style={{ color: 'var(--text-muted)', flexShrink: 0 }} />
				<input
					type="text"
					placeholder="Search conversations..."
					value={searchQuery}
					onChange={(e) => {
						setSearchQuery(e.target.value);
						setOffset(0);
					}}
					style={{
						flex: 1,
						border: 'none',
						outline: 'none',
						backgroundColor: 'transparent',
						color: 'var(--text-primary)',
						fontSize: '0.875rem',
						fontFamily: 'inherit',
					}}
				/>
				{searchQuery && (
					<button
						type="button"
						onClick={() => {
							setSearchQuery('');
							setOffset(0);
						}}
						style={{
							display: 'flex',
							alignItems: 'center',
							justifyContent: 'center',
							border: 'none',
							backgroundColor: 'transparent',
							color: 'var(--text-muted)',
							cursor: 'pointer',
							padding: '0.125rem',
						}}
						aria-label="Clear search"
					>
						<X size={14} />
					</button>
				)}
			</div>

			{/* Error */}
			{activeQuery.isError && (
				<ErrorCard
					message={(activeQuery.error as Error)?.message ?? 'Failed to load conversations'}
					onRetry={() => activeQuery.refetch()}
				/>
			)}

			{/* Loading */}
			{activeQuery.isLoading && !activeQuery.isError && <SkeletonList />}

			{/* Loaded */}
			{!activeQuery.isLoading &&
				!activeQuery.isError &&
				(sessions.length === 0 ? (
					<div
						style={{
							backgroundColor: 'var(--bg-secondary)',
							border: '1px solid var(--border-default)',
							borderRadius: '0.75rem',
							padding: '3rem',
							textAlign: 'center',
							display: 'flex',
							flexDirection: 'column',
							alignItems: 'center',
							gap: '0.75rem',
						}}
					>
						<MessageSquare size={32} style={{ color: 'var(--text-muted)' }} />
						<p style={{ color: 'var(--text-muted)', fontSize: '0.875rem', margin: 0 }}>
							{isSearching
								? 'No conversations match your search.'
								: 'No conversations yet. Conversation context is saved via MCP tools.'}
						</p>
					</div>
				) : (
					<div
						style={{
							display: 'flex',
							gap: '1.5rem',
							alignItems: 'flex-start',
						}}
					>
						{/* Left panel: list */}
						<div
							style={{
								width: selectedId ? '340px' : '100%',
								flexShrink: 0,
								display: 'flex',
								flexDirection: 'column',
								gap: '0.75rem',
								transition: 'width 0.2s ease',
							}}
						>
							{sessions.map((session) => (
								<ConversationCard
									key={session.session_id}
									session={session}
									isActive={selectedId === session.session_id}
									onClick={() => setSelectedId(session.session_id)}
								/>
							))}

							{/* Pagination (only for non-search mode) */}
							{!isSearching && total > PAGE_SIZE && (
								<Pagination offset={offset} total={total} onPrev={handlePrev} onNext={handleNext} />
							)}
						</div>

						{/* Right panel: detail */}
						{selectedId ? (
							<ConversationDetailPanel sessionId={selectedId} onClose={() => setSelectedId(null)} />
						) : (
							<div
								style={{
									flex: 1,
									backgroundColor: 'var(--bg-secondary)',
									border: '1px solid var(--border-default)',
									borderRadius: '0.75rem',
									padding: '3rem',
									display: 'flex',
									alignItems: 'center',
									justifyContent: 'center',
									minHeight: 400,
								}}
							>
								<p
									style={{
										color: 'var(--text-muted)',
										fontSize: '0.875rem',
										margin: 0,
									}}
								>
									Select a conversation to view details
								</p>
							</div>
						)}
					</div>
				))}
		</div>
	);
}
