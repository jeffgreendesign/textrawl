/**
 * Knowledge Explorer — browse documents with card/table/timeline views.
 */
'use client';

import {
	type SortingState,
	createColumnHelper,
	flexRender,
	getCoreRowModel,
	getSortedRowModel,
	useReactTable,
} from '@tanstack/react-table';
import {
	AlertCircle,
	ChevronLeft,
	ChevronRight,
	Clock,
	LayoutGrid,
	Table,
	Upload,
} from 'lucide-react';
import Link from 'next/link';
import { useMemo, useState } from 'react';

import type { Document } from '@/lib/api';
import { useDocuments } from '@/lib/queries';

type ViewMode = 'card' | 'table' | 'timeline';

const PAGE_SIZE = 20;

const SOURCE_TYPE_COLORS: Record<string, string> = {
	pdf: '#3b82f6',
	txt: '#71717a',
	html: '#f97316',
	markdown: '#8b5cf6',
	email: '#ec4899',
};

function getSourceColor(type: string): string {
	return SOURCE_TYPE_COLORS[type.toLowerCase()] ?? '#71717a';
}

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

function formatDayHeader(dateStr: string): string {
	return new Date(dateStr).toLocaleDateString('en-US', {
		month: 'long',
		day: 'numeric',
		year: 'numeric',
	});
}

function getDateKey(dateStr: string): string {
	return new Date(dateStr).toISOString().slice(0, 10);
}

function getTags(doc: Document): string[] {
	const tags = doc.metadata?.tags;
	if (Array.isArray(tags)) return tags.filter((t) => typeof t === 'string');
	return [];
}

/* ── Reusable sub-components ── */

function SourceBadge({ type }: { type: string }) {
	const color = getSourceColor(type);
	return (
		<span
			style={{
				display: 'inline-block',
				padding: '0.125rem 0.5rem',
				fontSize: '0.6875rem',
				fontFamily: 'var(--font-mono)',
				fontWeight: 500,
				borderRadius: '9999px',
				backgroundColor: `${color}18`,
				color,
				lineHeight: 1.6,
				textTransform: 'uppercase',
				letterSpacing: '0.025em',
			}}
		>
			{type}
		</span>
	);
}

function TagPill({ tag }: { tag: string }) {
	return (
		<span
			style={{
				display: 'inline-block',
				padding: '0.0625rem 0.375rem',
				fontSize: '0.625rem',
				fontFamily: 'var(--font-mono)',
				borderRadius: '9999px',
				backgroundColor: 'var(--bg-tertiary)',
				color: 'var(--text-muted)',
				lineHeight: 1.6,
			}}
		>
			{tag}
		</span>
	);
}

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
	const start = total === 0 ? 0 : offset + 1;
	const end = Math.min(offset + PAGE_SIZE, total);

	return (
		<div
			style={{
				display: 'flex',
				alignItems: 'center',
				justifyContent: 'space-between',
				marginTop: '1.5rem',
				fontSize: '0.8125rem',
				color: 'var(--text-muted)',
				fontFamily: 'var(--font-mono)',
			}}
		>
			<span>
				Showing {start}–{end} of {total}
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
					Previous
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

/* ── Skeleton loading states ── */

const shimmerStyle = {
	background:
		'linear-gradient(90deg, var(--bg-tertiary) 25%, var(--bg-hover) 50%, var(--bg-tertiary) 75%)',
	backgroundSize: '200% 100%',
	animation: 'shimmer 1.5s infinite',
	borderRadius: '0.375rem',
} as const;

const SKEL_CARDS = ['a', 'b', 'c', 'd', 'e', 'f'];
const SKEL_ROWS = ['a', 'b', 'c', 'd', 'e'];
const SKEL_GROUPS = ['a', 'b'];
const SKEL_ENTRIES = ['a', 'b', 'c'];

function SkeletonCards() {
	return (
		<>
			<style>
				{
					'@keyframes shimmer { 0% { background-position: 200% 0; } 100% { background-position: -200% 0; } }'
				}
			</style>
			<div
				style={{
					display: 'grid',
					gridTemplateColumns: 'repeat(auto-fill, minmax(var(--grid-min-card), 1fr))',
					gap: '1rem',
				}}
			>
				{SKEL_CARDS.map((k) => (
					<div
						key={k}
						style={{
							backgroundColor: 'var(--bg-secondary)',
							border: '1px solid var(--border-default)',
							borderRadius: '0.75rem',
							padding: '1.25rem',
							display: 'flex',
							flexDirection: 'column',
							gap: '0.75rem',
						}}
					>
						<div style={{ ...shimmerStyle, height: '1rem', width: '70%' }} />
						<div style={{ ...shimmerStyle, height: '0.75rem', width: '4rem' }} />
						<div style={{ display: 'flex', flexDirection: 'column', gap: '0.375rem' }}>
							<div style={{ ...shimmerStyle, height: '0.625rem', width: '100%' }} />
							<div style={{ ...shimmerStyle, height: '0.625rem', width: '90%' }} />
							<div style={{ ...shimmerStyle, height: '0.625rem', width: '60%' }} />
						</div>
						<div
							style={{ ...shimmerStyle, height: '0.625rem', width: '5rem', marginTop: 'auto' }}
						/>
					</div>
				))}
			</div>
		</>
	);
}

function SkeletonTable() {
	return (
		<>
			<style>
				{
					'@keyframes shimmer { 0% { background-position: 200% 0; } 100% { background-position: -200% 0; } }'
				}
			</style>
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
							{['Title', 'Source Type', 'Tags', 'Date'].map((h) => (
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
						{SKEL_ROWS.map((k) => (
							<tr key={k} style={{ borderBottom: '1px solid var(--border-default)' }}>
								<td style={{ padding: '0.75rem 1rem' }}>
									<div style={{ ...shimmerStyle, height: '0.875rem', width: '60%' }} />
								</td>
								<td style={{ padding: '0.75rem 1rem' }}>
									<div style={{ ...shimmerStyle, height: '0.875rem', width: '3.5rem' }} />
								</td>
								<td style={{ padding: '0.75rem 1rem' }}>
									<div style={{ ...shimmerStyle, height: '0.875rem', width: '5rem' }} />
								</td>
								<td style={{ padding: '0.75rem 1rem' }}>
									<div style={{ ...shimmerStyle, height: '0.875rem', width: '4rem' }} />
								</td>
							</tr>
						))}
					</tbody>
				</table>
			</div>
		</>
	);
}

function SkeletonTimeline() {
	return (
		<>
			<style>
				{
					'@keyframes shimmer { 0% { background-position: 200% 0; } 100% { background-position: -200% 0; } }'
				}
			</style>
			<div>
				{SKEL_GROUPS.map((k) => (
					<div key={k} style={{ marginBottom: '2rem' }}>
						<div
							style={{ ...shimmerStyle, height: '1.25rem', width: '14rem', marginBottom: '1rem' }}
						/>
						<div
							style={{
								borderLeft: '2px solid var(--border-default)',
								paddingLeft: '1.5rem',
								display: 'flex',
								flexDirection: 'column',
								gap: '1rem',
							}}
						>
							{SKEL_ENTRIES.map((ek) => (
								<div
									key={ek}
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
									<div style={{ ...shimmerStyle, height: '0.875rem', width: '50%' }} />
									<div style={{ ...shimmerStyle, height: '0.625rem', width: '3rem' }} />
									<div style={{ ...shimmerStyle, height: '0.625rem', width: '80%' }} />
								</div>
							))}
						</div>
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

/* ── Empty state ── */

function EmptyState() {
	return (
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
			<Upload size={32} style={{ color: 'var(--text-muted)' }} />
			<p style={{ color: 'var(--text-muted)', fontSize: '0.875rem', margin: 0 }}>
				No documents yet.{' '}
				<Link
					href="/upload"
					style={{
						color: 'var(--text-accent)',
						textDecoration: 'underline',
						textUnderlineOffset: '2px',
					}}
				>
					Upload your first document
				</Link>
			</p>
		</div>
	);
}

/* ── Card View ── */

function CardView({ documents }: { documents: Document[] }) {
	const [hoveredId, setHoveredId] = useState<string | null>(null);

	if (documents.length === 0) return <EmptyState />;

	return (
		<div
			style={{
				display: 'grid',
				gridTemplateColumns: 'repeat(auto-fill, minmax(var(--grid-min-card), 1fr))',
				gap: '1rem',
			}}
		>
			{documents.map((doc) => {
				const tags = getTags(doc);
				const preview = doc.raw_content.slice(0, 200);
				const isHovered = hoveredId === doc.id;

				return (
					<div
						key={doc.id}
						onMouseEnter={() => setHoveredId(doc.id)}
						onMouseLeave={() => setHoveredId(null)}
						style={{
							backgroundColor: 'var(--bg-secondary)',
							border: `1px solid ${isHovered ? 'var(--text-accent)' : 'var(--border-default)'}`,
							borderRadius: '0.75rem',
							padding: '1.25rem',
							display: 'flex',
							flexDirection: 'column',
							gap: '0.5rem',
							transition: 'border-color 0.2s ease',
							cursor: 'default',
						}}
					>
						{/* Title */}
						<h3
							style={{
								margin: 0,
								fontSize: '0.9375rem',
								fontWeight: 600,
								color: 'var(--text-primary)',
								overflow: 'hidden',
								textOverflow: 'ellipsis',
								whiteSpace: 'nowrap',
							}}
							title={doc.title}
						>
							{doc.title}
						</h3>

						{/* Source type badge */}
						<div>
							<SourceBadge type={doc.source_type} />
						</div>

						{/* Content preview with fade-out */}
						<div
							style={{
								position: 'relative',
								fontSize: '0.8125rem',
								lineHeight: 1.6,
								color: 'var(--text-secondary)',
								overflow: 'hidden',
								maxHeight: '5.2rem',
								flex: 1,
							}}
						>
							<p style={{ margin: 0 }}>{preview}</p>
							<div
								style={{
									position: 'absolute',
									bottom: 0,
									left: 0,
									right: 0,
									height: '2rem',
									background: 'linear-gradient(to bottom, transparent, var(--bg-secondary))',
									pointerEvents: 'none',
								}}
							/>
						</div>

						{/* Tags */}
						{tags.length > 0 && (
							<div style={{ display: 'flex', flexWrap: 'wrap', gap: '0.25rem' }}>
								{tags.map((tag) => (
									<TagPill key={tag} tag={tag} />
								))}
							</div>
						)}

						{/* Relative date */}
						<span
							style={{
								fontSize: '0.6875rem',
								fontFamily: 'var(--font-mono)',
								color: 'var(--text-muted)',
								marginTop: 'auto',
							}}
						>
							{timeAgo(doc.created_at)}
						</span>
					</div>
				);
			})}
		</div>
	);
}

/* ── Table View ── */

const columnHelper = createColumnHelper<Document>();

const tableColumns = [
	columnHelper.accessor('title', {
		header: 'Title',
		cell: (info) => (
			<span
				style={{
					fontWeight: 500,
					color: 'var(--text-primary)',
					overflow: 'hidden',
					textOverflow: 'ellipsis',
					whiteSpace: 'nowrap',
					display: 'block',
					maxWidth: '20rem',
				}}
				title={info.getValue()}
			>
				{info.getValue()}
			</span>
		),
	}),
	columnHelper.accessor('source_type', {
		header: 'Source Type',
		cell: (info) => <SourceBadge type={info.getValue()} />,
	}),
	columnHelper.accessor(
		(row) => {
			const tags = getTags(row);
			return tags.join(', ');
		},
		{
			id: 'tags',
			header: 'Tags',
			cell: (info) => {
				const tags = info.getValue().split(', ').filter(Boolean);
				if (tags.length === 0) {
					return <span style={{ color: 'var(--text-muted)', fontSize: '0.75rem' }}>—</span>;
				}
				return (
					<div style={{ display: 'flex', flexWrap: 'wrap', gap: '0.25rem' }}>
						{tags.map((tag) => (
							<TagPill key={tag} tag={tag} />
						))}
					</div>
				);
			},
		},
	),
	columnHelper.accessor('created_at', {
		header: 'Date',
		cell: (info) => (
			<span
				style={{
					fontFamily: 'var(--font-mono)',
					fontSize: '0.8125rem',
					color: 'var(--text-muted)',
				}}
			>
				{timeAgo(info.getValue())}
			</span>
		),
	}),
];

function TableView({ documents }: { documents: Document[] }) {
	const [sorting, setSorting] = useState<SortingState>([]);

	const table = useReactTable({
		data: documents,
		columns: tableColumns,
		state: { sorting },
		onSortingChange: setSorting,
		getCoreRowModel: getCoreRowModel(),
		getSortedRowModel: getSortedRowModel(),
	});

	if (documents.length === 0) return <EmptyState />;

	return (
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
					{table.getHeaderGroups().map((headerGroup) => (
						<tr key={headerGroup.id} style={{ borderBottom: '1px solid var(--border-default)' }}>
							{headerGroup.headers.map((header) => (
								<th
									key={header.id}
									onClick={header.column.getToggleSortingHandler()}
									onKeyDown={(e) => {
										if (e.key === 'Enter' || e.key === ' ') {
											e.preventDefault();
											header.column.getToggleSortingHandler()?.(e);
										}
									}}
									tabIndex={header.column.getCanSort() ? 0 : undefined}
									style={{
										textAlign: 'left',
										padding: '0.75rem 1rem',
										color: 'var(--text-muted)',
										fontWeight: 500,
										fontSize: '0.75rem',
										textTransform: 'uppercase',
										cursor: header.column.getCanSort() ? 'pointer' : 'default',
										userSelect: 'none',
										whiteSpace: 'nowrap',
									}}
								>
									<span style={{ display: 'flex', alignItems: 'center', gap: '0.25rem' }}>
										{flexRender(header.column.columnDef.header, header.getContext())}
										{{
											asc: ' \u25B2',
											desc: ' \u25BC',
										}[header.column.getIsSorted() as string] ?? ''}
									</span>
								</th>
							))}
						</tr>
					))}
				</thead>
				<tbody>
					{table.getRowModel().rows.map((row) => (
						<tr key={row.id} style={{ borderBottom: '1px solid var(--border-default)' }}>
							{row.getVisibleCells().map((cell) => (
								<td
									key={cell.id}
									style={{
										padding: '0.75rem 1rem',
										fontFamily: 'var(--font-mono)',
										fontSize: '0.8125rem',
									}}
								>
									{flexRender(cell.column.columnDef.cell, cell.getContext())}
								</td>
							))}
						</tr>
					))}
				</tbody>
			</table>
		</div>
	);
}

/* ── Timeline View ── */

function TimelineView({ documents }: { documents: Document[] }) {
	const groups = useMemo(() => {
		const map = new Map<string, Document[]>();
		for (const doc of documents) {
			const key = getDateKey(doc.created_at);
			const list = map.get(key) ?? [];
			list.push(doc);
			map.set(key, list);
		}
		// Sort keys descending (most recent first)
		return Array.from(map.entries()).sort(([a], [b]) => b.localeCompare(a));
	}, [documents]);

	if (documents.length === 0) return <EmptyState />;

	return (
		<div>
			{groups.map(([dateKey, docs]) => (
				<div key={dateKey} style={{ marginBottom: '2rem' }}>
					{/* Date header */}
					<div
						style={{
							display: 'flex',
							alignItems: 'center',
							gap: '0.5rem',
							marginBottom: '1rem',
						}}
					>
						<h3
							style={{
								margin: 0,
								fontSize: '1rem',
								fontWeight: 600,
								color: 'var(--text-primary)',
							}}
						>
							{formatDayHeader(docs[0].created_at)}
						</h3>
						<span
							style={{
								fontSize: '0.75rem',
								color: 'var(--text-muted)',
								fontFamily: 'var(--font-mono)',
							}}
						>
							&middot; {docs.length} document{docs.length !== 1 ? 's' : ''}
						</span>
					</div>

					{/* Timeline entries */}
					<div
						style={{
							borderLeft: '2px solid var(--border-default)',
							paddingLeft: '1.5rem',
							display: 'flex',
							flexDirection: 'column',
							gap: '0.75rem',
						}}
					>
						{docs.map((doc) => (
							<div
								key={doc.id}
								style={{
									backgroundColor: 'var(--bg-secondary)',
									border: '1px solid var(--border-default)',
									borderRadius: '0.75rem',
									padding: '1rem',
								}}
							>
								<div
									style={{
										display: 'flex',
										alignItems: 'center',
										gap: '0.5rem',
										marginBottom: '0.375rem',
									}}
								>
									<span
										style={{
											fontWeight: 600,
											fontSize: '0.875rem',
											color: 'var(--text-primary)',
										}}
									>
										{doc.title}
									</span>
									<SourceBadge type={doc.source_type} />
								</div>
								<p
									style={{
										margin: 0,
										fontSize: '0.8125rem',
										lineHeight: 1.6,
										color: 'var(--text-secondary)',
									}}
								>
									{doc.raw_content.slice(0, 100)}
									{doc.raw_content.length > 100 ? '...' : ''}
								</p>
							</div>
						))}
					</div>
				</div>
			))}
		</div>
	);
}

/* ── Main Page ── */

export default function KnowledgePage() {
	const [viewMode, setViewMode] = useState<ViewMode>('card');
	const [offset, setOffset] = useState(0);
	const { data, isLoading, isError, error, refetch } = useDocuments(PAGE_SIZE, offset);

	const documents = data?.documents ?? [];
	const total = data?.total ?? 0;

	const viewButtons: { mode: ViewMode; icon: typeof LayoutGrid; label: string }[] = [
		{ mode: 'card', icon: LayoutGrid, label: 'Cards' },
		{ mode: 'table', icon: Table, label: 'Table' },
		{ mode: 'timeline', icon: Clock, label: 'Timeline' },
	];

	function handlePrev() {
		setOffset((prev) => Math.max(0, prev - PAGE_SIZE));
	}

	function handleNext() {
		setOffset((prev) => prev + PAGE_SIZE);
	}

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

			{/* Error state */}
			{isError && (
				<ErrorCard
					message={(error as Error)?.message ?? 'Failed to load documents'}
					onRetry={() => refetch()}
				/>
			)}

			{/* Loading state */}
			{isLoading && !isError && (
				<>
					{viewMode === 'card' && <SkeletonCards />}
					{viewMode === 'table' && <SkeletonTable />}
					{viewMode === 'timeline' && <SkeletonTimeline />}
				</>
			)}

			{/* Data loaded */}
			{!isLoading && !isError && (
				<>
					{viewMode === 'card' && <CardView documents={documents} />}
					{viewMode === 'table' && <TableView documents={documents} />}
					{viewMode === 'timeline' && <TimelineView documents={documents} />}

					{total > 0 && (
						<Pagination offset={offset} total={total} onPrev={handlePrev} onNext={handleNext} />
					)}
				</>
			)}
		</div>
	);
}
