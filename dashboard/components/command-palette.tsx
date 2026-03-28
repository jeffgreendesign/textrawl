/**
 * Command Palette — ⌘K search overlay with keyboard navigation.
 */
'use client';

import { FileText, Search } from 'lucide-react';
import { useRouter } from 'next/navigation';
import { useCallback, useEffect, useRef, useState } from 'react';

import { useDocuments, useSearch } from '@/lib/queries';

export default function CommandPalette({ onClose }: { onClose: () => void }) {
	const [query, setQuery] = useState('');
	const [debouncedQuery, setDebouncedQuery] = useState('');
	const [selectedIndex, setSelectedIndex] = useState(0);
	const inputRef = useRef<HTMLInputElement>(null);
	const debounceRef = useRef<ReturnType<typeof setTimeout>>();
	const router = useRouter();

	// Debounce search query
	useEffect(() => {
		clearTimeout(debounceRef.current);
		if (query.trim().length === 0) {
			setDebouncedQuery('');
			return;
		}
		debounceRef.current = setTimeout(() => {
			setDebouncedQuery(query.trim());
		}, 300);
		return () => clearTimeout(debounceRef.current);
	}, [query]);

	const { data: searchData, isLoading: isSearching } = useSearch(debouncedQuery);
	const { data: recentData } = useDocuments(5, 0);

	const results = debouncedQuery
		? (searchData?.results ?? [])
		: (recentData?.documents ?? []).map((doc) => ({
				documentId: doc.id,
				documentTitle: doc.title,
				content: doc.raw_content?.slice(0, 150) ?? '',
				sourceType: doc.source_type,
				score: 1,
			}));

	// Reset selection when search query changes
	// biome-ignore lint/correctness/useExhaustiveDependencies: intentional reset on query change
	useEffect(() => {
		setSelectedIndex(0);
	}, [debouncedQuery]);

	// Focus input on mount
	useEffect(() => {
		inputRef.current?.focus();
	}, []);

	// Close on click outside
	const overlayRef = useRef<HTMLDivElement>(null);
	const handleOverlayClick = useCallback(
		(e: React.MouseEvent) => {
			if (e.target === overlayRef.current) onClose();
		},
		[onClose],
	);

	// Keyboard navigation
	const handleKeyDown = useCallback(
		(e: React.KeyboardEvent) => {
			if (e.key === 'Escape') {
				onClose();
			} else if (e.key === 'ArrowDown') {
				e.preventDefault();
				setSelectedIndex((i) => Math.min(i + 1, results.length - 1));
			} else if (e.key === 'ArrowUp') {
				e.preventDefault();
				setSelectedIndex((i) => Math.max(i - 1, 0));
			} else if (e.key === 'Enter' && results.length > 0) {
				e.preventDefault();
				onClose();
				router.push('/knowledge');
			}
		},
		[results.length, onClose, router],
	);

	const SOURCE_COLORS: Record<string, string> = {
		pdf: '#3b82f6',
		txt: '#71717a',
		html: '#f97316',
		markdown: '#8b5cf6',
		email: '#ec4899',
	};

	return (
		// biome-ignore lint/a11y/useKeyWithClickEvents: overlay click-to-close
		<div
			ref={overlayRef}
			onClick={handleOverlayClick}
			style={{
				position: 'fixed',
				inset: 0,
				zIndex: 100,
				background: 'rgba(0, 0, 0, 0.6)',
				backdropFilter: 'blur(4px)',
				WebkitBackdropFilter: 'blur(4px)',
				display: 'flex',
				justifyContent: 'center',
				paddingTop: '15vh',
			}}
		>
			<div
				onKeyDown={handleKeyDown}
				style={{
					width: '100%',
					maxWidth: 560,
					maxHeight: '60vh',
					backgroundColor: 'var(--bg-secondary)',
					border: '1px solid var(--border-default)',
					borderRadius: '0.75rem',
					overflow: 'hidden',
					display: 'flex',
					flexDirection: 'column',
					boxShadow: '0 24px 48px rgba(0, 0, 0, 0.4)',
				}}
			>
				{/* Search input */}
				<div
					style={{
						display: 'flex',
						alignItems: 'center',
						gap: '0.75rem',
						padding: '0.875rem 1rem',
						borderBottom: '1px solid var(--border-default)',
					}}
				>
					<Search size={18} style={{ color: 'var(--text-muted)', flexShrink: 0 }} />
					<input
						ref={inputRef}
						type="text"
						value={query}
						onChange={(e) => setQuery(e.target.value)}
						placeholder="Search your knowledge..."
						style={{
							background: 'none',
							border: 'none',
							outline: 'none',
							color: 'var(--text-primary)',
							fontSize: '1rem',
							width: '100%',
							fontFamily: 'var(--font-sans)',
						}}
					/>
					<kbd
						style={{
							fontSize: '0.6875rem',
							fontFamily: 'var(--font-mono)',
							color: 'var(--text-muted)',
							backgroundColor: 'var(--bg-tertiary)',
							padding: '0.125rem 0.375rem',
							borderRadius: '0.25rem',
							border: '1px solid var(--border-default)',
							flexShrink: 0,
						}}
					>
						ESC
					</kbd>
				</div>

				{/* Results */}
				<div style={{ overflowY: 'auto', flex: 1 }}>
					{!debouncedQuery && results.length > 0 && (
						<div
							style={{
								padding: '0.5rem 1rem',
								fontSize: '0.6875rem',
								color: 'var(--text-muted)',
								textTransform: 'uppercase',
								letterSpacing: '0.05em',
							}}
						>
							Recent documents
						</div>
					)}

					{isSearching && (
						<div style={{ padding: '1.5rem', textAlign: 'center' }}>
							<p
								style={{
									color: 'var(--text-muted)',
									fontSize: '0.875rem',
								}}
							>
								Searching...
							</p>
						</div>
					)}

					{!isSearching && debouncedQuery && results.length === 0 && (
						<div style={{ padding: '1.5rem', textAlign: 'center' }}>
							<p
								style={{
									color: 'var(--text-muted)',
									fontSize: '0.875rem',
								}}
							>
								No results found
							</p>
						</div>
					)}

					{!isSearching &&
						results.map((result, idx) => (
							// biome-ignore lint/a11y/useKeyWithClickEvents: keyboard nav on parent
							<div
								key={result.documentId}
								onClick={() => {
									onClose();
									router.push('/knowledge');
								}}
								style={{
									display: 'flex',
									alignItems: 'flex-start',
									gap: '0.75rem',
									padding: '0.75rem 1rem',
									cursor: 'pointer',
									backgroundColor: idx === selectedIndex ? 'var(--bg-tertiary)' : 'transparent',
									borderBottom: '1px solid var(--border-default)',
								}}
							>
								<FileText
									size={16}
									style={{
										color: 'var(--text-muted)',
										flexShrink: 0,
										marginTop: 2,
									}}
								/>
								<div style={{ flex: 1, minWidth: 0 }}>
									<p
										style={{
											fontSize: '0.875rem',
											fontWeight: 500,
											overflow: 'hidden',
											textOverflow: 'ellipsis',
											whiteSpace: 'nowrap',
										}}
									>
										{result.documentTitle}
									</p>
									<p
										style={{
											fontSize: '0.75rem',
											color: 'var(--text-muted)',
											marginTop: '0.125rem',
											overflow: 'hidden',
											textOverflow: 'ellipsis',
											whiteSpace: 'nowrap',
										}}
									>
										{result.content.slice(0, 120)}
									</p>
								</div>
								<div
									style={{
										display: 'flex',
										alignItems: 'center',
										gap: '0.5rem',
										flexShrink: 0,
									}}
								>
									<span
										style={{
											fontSize: '0.625rem',
											padding: '0.125rem 0.375rem',
											borderRadius: '0.25rem',
											backgroundColor: 'var(--bg-tertiary)',
											color: SOURCE_COLORS[result.sourceType] ?? '#71717a',
											fontFamily: 'var(--font-mono)',
											textTransform: 'uppercase',
										}}
									>
										{result.sourceType}
									</span>
									{debouncedQuery && (
										<div
											style={{
												width: 40,
												height: 4,
												borderRadius: 2,
												backgroundColor: 'var(--bg-tertiary)',
												overflow: 'hidden',
											}}
										>
											<div
												style={{
													width: `${Math.round(result.score * 100)}%`,
													height: '100%',
													backgroundColor: 'var(--text-accent)',
													borderRadius: 2,
												}}
											/>
										</div>
									)}
								</div>
							</div>
						))}
				</div>

				{/* Footer */}
				<div
					style={{
						padding: '0.5rem 1rem',
						borderTop: '1px solid var(--border-default)',
						display: 'flex',
						gap: '1rem',
						fontSize: '0.6875rem',
						color: 'var(--text-muted)',
					}}
				>
					<span>↑↓ navigate</span>
					<span>↵ open</span>
					<span>esc close</span>
				</div>
			</div>
		</div>
	);
}
