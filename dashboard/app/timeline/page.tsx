/**
 * Timeline — chronological document feed with activity heatmap.
 */
'use client';

import { Calendar, FileText, Upload } from 'lucide-react';
import Link from 'next/link';
import { useEffect, useMemo, useState } from 'react';

import type { Document } from '@/lib/api';
import { useDocuments } from '@/lib/queries';

const SOURCE_COLORS: Record<string, string> = {
	pdf: '#3b82f6',
	txt: '#71717a',
	html: '#f97316',
	markdown: '#8b5cf6',
	email: '#ec4899',
};

function getSourceColor(sourceType: string): string {
	const key = sourceType.toLowerCase();
	return SOURCE_COLORS[key] ?? 'var(--text-muted)';
}

function getHeatmapColor(count: number): string {
	if (count === 0) return 'var(--bg-tertiary)';
	if (count === 1) return '#3d5c00';
	if (count <= 3) return '#6b9e00';
	return '#c8ff00';
}

function formatTime(dateString: string): string {
	const date = new Date(dateString);
	return date.toLocaleTimeString('en-US', {
		hour: 'numeric',
		minute: '2-digit',
		hour12: true,
	});
}

function formatDayHeader(dateString: string): string {
	const date = new Date(`${dateString}T00:00:00`);
	return date.toLocaleDateString('en-US', {
		weekday: 'long',
		year: 'numeric',
		month: 'long',
		day: 'numeric',
	});
}

function toDateKey(dateString: string): string {
	const d = new Date(dateString);
	const year = d.getFullYear();
	const month = String(d.getMonth() + 1).padStart(2, '0');
	const day = String(d.getDate()).padStart(2, '0');
	return `${year}-${month}-${day}`;
}

interface DayGroup {
	dateKey: string;
	documents: Document[];
}

function groupByDay(documents: Document[]): DayGroup[] {
	const map = new Map<string, Document[]>();
	for (const doc of documents) {
		const key = toDateKey(doc.created_at);
		const existing = map.get(key);
		if (existing) {
			existing.push(doc);
		} else {
			map.set(key, [doc]);
		}
	}
	const groups: DayGroup[] = [];
	for (const [dateKey, docs] of map) {
		groups.push({ dateKey, documents: docs });
	}
	groups.sort((a, b) => b.dateKey.localeCompare(a.dateKey));
	return groups;
}

function buildHeatmapData(documents: Document[]): { date: Date; dateKey: string; count: number }[] {
	const today = new Date();
	today.setHours(0, 0, 0, 0);

	const counts = new Map<string, number>();
	for (const doc of documents) {
		const key = toDateKey(doc.created_at);
		counts.set(key, (counts.get(key) ?? 0) + 1);
	}

	const days: { date: Date; dateKey: string; count: number }[] = [];
	for (let i = 83; i >= 0; i--) {
		const d = new Date(today);
		d.setDate(d.getDate() - i);
		const key = toDateKey(d.toISOString());
		days.push({ date: d, dateKey: key, count: counts.get(key) ?? 0 });
	}
	return days;
}

function getMonthLabels(days: { date: Date }[]): { label: string; weekIndex: number }[] {
	const labels: { label: string; weekIndex: number }[] = [];
	let lastMonth = -1;
	let weekIndex = 0;

	for (let i = 0; i < days.length; i++) {
		if (i > 0 && i % 7 === 0) weekIndex++;
		const month = days[i].date.getMonth();
		if (month !== lastMonth && days[i].date.getDay() <= 3) {
			labels.push({
				label: days[i].date.toLocaleDateString('en-US', { month: 'short' }),
				weekIndex,
			});
			lastMonth = month;
		}
	}
	return labels;
}

function SkeletonHeatmap() {
	return (
		<div
			style={{
				backgroundColor: 'var(--bg-secondary)',
				border: '1px solid var(--border-default)',
				borderRadius: '0.75rem',
				padding: '1.25rem',
				marginBottom: '2rem',
			}}
		>
			<div
				style={{
					display: 'flex',
					alignItems: 'center',
					gap: '0.5rem',
					marginBottom: '1rem',
				}}
			>
				<div
					style={{
						width: 120,
						height: 16,
						backgroundColor: 'var(--bg-tertiary)',
						borderRadius: 4,
						animation: 'pulse 1.5s ease-in-out infinite',
					}}
				/>
			</div>
			<div
				style={{
					height: 110,
					backgroundColor: 'var(--bg-tertiary)',
					borderRadius: 6,
					animation: 'pulse 1.5s ease-in-out infinite',
				}}
			/>
			<style>{'@keyframes pulse { 0%, 100% { opacity: 1; } 50% { opacity: 0.5; } }'}</style>
		</div>
	);
}

function SkeletonFeed() {
	return (
		<div style={{ display: 'flex', flexDirection: 'column', gap: '1.5rem' }}>
			{[0, 1, 2].map((i) => (
				<div key={i}>
					<div
						style={{
							width: 200,
							height: 18,
							backgroundColor: 'var(--bg-tertiary)',
							borderRadius: 4,
							marginBottom: '1rem',
							animation: 'pulse 1.5s ease-in-out infinite',
						}}
					/>
					<div
						style={{
							borderLeft: '2px solid var(--bg-tertiary)',
							paddingLeft: '1.5rem',
							marginLeft: '0.5rem',
							display: 'flex',
							flexDirection: 'column',
							gap: '0.75rem',
						}}
					>
						{[0, 1].map((j) => (
							<div
								key={j}
								style={{
									height: 60,
									backgroundColor: 'var(--bg-tertiary)',
									borderRadius: 8,
									animation: 'pulse 1.5s ease-in-out infinite',
								}}
							/>
						))}
					</div>
				</div>
			))}
			<style>{'@keyframes pulse { 0%, 100% { opacity: 1; } 50% { opacity: 0.5; } }'}</style>
		</div>
	);
}

function ActivityHeatmap({ documents }: { documents: Document[] }) {
	const days = useMemo(() => buildHeatmapData(documents), [documents]);
	const monthLabels = useMemo(() => getMonthLabels(days), [days]);

	// Organize days into week columns (7 rows each)
	const weeks: { date: Date; dateKey: string; count: number }[][] = [];
	for (let i = 0; i < days.length; i += 7) {
		weeks.push(days.slice(i, i + 7));
	}

	const dayLabels = ['Mon', '', 'Wed', '', 'Fri', '', 'Sun'];

	return (
		<div
			style={{
				backgroundColor: 'var(--bg-secondary)',
				border: '1px solid var(--border-default)',
				borderRadius: '0.75rem',
				padding: '1.25rem',
				marginBottom: '2rem',
			}}
		>
			<div
				style={{
					display: 'flex',
					alignItems: 'center',
					gap: '0.5rem',
					marginBottom: '1rem',
				}}
			>
				<Calendar size={16} style={{ color: 'var(--text-accent)' }} />
				<span
					style={{
						fontSize: '0.875rem',
						fontWeight: 600,
						color: 'var(--text-primary)',
						fontFamily: 'var(--font-sans)',
					}}
				>
					Activity (last 12 weeks)
				</span>
			</div>

			{/* Month labels */}
			<div style={{ display: 'flex', paddingLeft: 32, marginBottom: 4 }}>
				{monthLabels.map((m, i) => (
					<span
						key={`${m.label}-${i}`}
						style={{
							position: 'absolute',
							left: `${32 + m.weekIndex * 16}px`,
							fontSize: '0.625rem',
							color: 'var(--text-muted)',
							fontFamily: 'var(--font-mono)',
						}}
					/>
				))}
				{/* Use a relative container for month labels */}
			</div>

			<div style={{ display: 'flex', gap: 0 }}>
				{/* Day labels column */}
				<div
					style={{
						display: 'flex',
						flexDirection: 'column',
						gap: '3px',
						marginRight: '6px',
						paddingTop: 18,
					}}
				>
					{dayLabels.map((label, i) => (
						<div
							key={`day-${label || i}`}
							style={{
								height: 13,
								display: 'flex',
								alignItems: 'center',
								justifyContent: 'flex-end',
							}}
						>
							<span
								style={{
									fontSize: '0.5625rem',
									color: 'var(--text-muted)',
									fontFamily: 'var(--font-mono)',
									lineHeight: 1,
								}}
							>
								{label}
							</span>
						</div>
					))}
				</div>

				{/* Heatmap grid */}
				<div style={{ position: 'relative' }}>
					{/* Month labels above grid */}
					<div style={{ height: 18, position: 'relative' }}>
						{monthLabels.map((m, i) => (
							<span
								key={`${m.label}-${i}`}
								style={{
									position: 'absolute',
									left: m.weekIndex * 16,
									fontSize: '0.5625rem',
									color: 'var(--text-muted)',
									fontFamily: 'var(--font-mono)',
									whiteSpace: 'nowrap',
								}}
							>
								{m.label}
							</span>
						))}
					</div>

					{/* Grid of cells */}
					<div style={{ display: 'flex', gap: '3px' }}>
						{weeks.map((week) => (
							<div
								key={week[0]?.dateKey ?? week.length}
								style={{
									display: 'flex',
									flexDirection: 'column',
									gap: '3px',
								}}
							>
								{week.map((day, di) => (
									<div
										key={day.dateKey}
										title={`${day.date.toLocaleDateString('en-US', { weekday: 'short', month: 'short', day: 'numeric' })}: ${day.count} document${day.count !== 1 ? 's' : ''}`}
										style={{
											width: 13,
											height: 13,
											borderRadius: 2,
											backgroundColor: getHeatmapColor(day.count),
											cursor: 'default',
										}}
									/>
								))}
							</div>
						))}
					</div>
				</div>
			</div>

			{/* Legend */}
			<div
				style={{
					display: 'flex',
					alignItems: 'center',
					gap: '0.375rem',
					marginTop: '0.75rem',
					justifyContent: 'flex-end',
				}}
			>
				<span
					style={{
						fontSize: '0.625rem',
						color: 'var(--text-muted)',
						fontFamily: 'var(--font-mono)',
					}}
				>
					Less
				</span>
				{[0, 1, 2, 4].map((count) => (
					<div
						key={count}
						style={{
							width: 10,
							height: 10,
							borderRadius: 2,
							backgroundColor: getHeatmapColor(count),
						}}
					/>
				))}
				<span
					style={{
						fontSize: '0.625rem',
						color: 'var(--text-muted)',
						fontFamily: 'var(--font-mono)',
					}}
				>
					More
				</span>
			</div>
		</div>
	);
}

export default function TimelinePage() {
	const [offset, setOffset] = useState(0);
	const { data, isLoading } = useDocuments(50, offset);
	const [allDocuments, setAllDocuments] = useState<Document[]>([]);

	// Append new documents when data arrives
	useEffect(() => {
		if (data?.documents) {
			setAllDocuments((prev) => {
				if (offset === 0) return data.documents;
				const existingIds = new Set(prev.map((d) => d.id));
				const newDocs = data.documents.filter((d) => !existingIds.has(d.id));
				return [...prev, ...newDocs];
			});
		}
	}, [data, offset]);

	const dayGroups = useMemo(() => groupByDay(allDocuments), [allDocuments]);
	const total = data?.total ?? 0;
	const hasMore = offset + 50 < total;

	// Loading state
	if (isLoading && allDocuments.length === 0) {
		return (
			<div>
				<h2 style={{ fontSize: '1.5rem', fontWeight: 600, marginBottom: '1.5rem' }}>Timeline</h2>
				<SkeletonHeatmap />
				<SkeletonFeed />
			</div>
		);
	}

	// Empty state
	if (!isLoading && allDocuments.length === 0) {
		return (
			<div>
				<h2 style={{ fontSize: '1.5rem', fontWeight: 600, marginBottom: '1.5rem' }}>Timeline</h2>
				<div
					style={{
						display: 'flex',
						flexDirection: 'column',
						alignItems: 'center',
						justifyContent: 'center',
						padding: '4rem 2rem',
						backgroundColor: 'var(--bg-secondary)',
						border: '1px solid var(--border-default)',
						borderRadius: '0.75rem',
						textAlign: 'center',
					}}
				>
					<FileText size={48} style={{ color: 'var(--text-muted)', marginBottom: '1rem' }} />
					<p
						style={{
							fontSize: '1rem',
							color: 'var(--text-primary)',
							fontWeight: 500,
							marginBottom: '0.5rem',
						}}
					>
						No documents yet
					</p>
					<p
						style={{
							fontSize: '0.875rem',
							color: 'var(--text-muted)',
							marginBottom: '1.25rem',
						}}
					>
						Upload your first document to see your timeline.
					</p>
					<Link
						href="/upload"
						style={{
							display: 'inline-flex',
							alignItems: 'center',
							gap: '0.5rem',
							padding: '0.625rem 1.25rem',
							backgroundColor: 'var(--text-accent)',
							color: '#000',
							borderRadius: '0.5rem',
							fontWeight: 600,
							fontSize: '0.875rem',
							textDecoration: 'none',
						}}
					>
						<Upload size={16} />
						Upload
					</Link>
				</div>
			</div>
		);
	}

	return (
		<div>
			<h2 style={{ fontSize: '1.5rem', fontWeight: 600, marginBottom: '1.5rem' }}>Timeline</h2>

			{/* Activity Heatmap */}
			<ActivityHeatmap documents={allDocuments} />

			{/* Chronological Feed */}
			<div style={{ display: 'flex', flexDirection: 'column', gap: '2rem' }}>
				{dayGroups.map((group) => (
					<div key={group.dateKey}>
						{/* Day header */}
						<div
							style={{
								display: 'flex',
								alignItems: 'center',
								gap: '0.75rem',
								marginBottom: '1rem',
							}}
						>
							<span
								style={{
									fontSize: '0.9375rem',
									fontWeight: 600,
									color: 'var(--text-primary)',
									fontFamily: 'var(--font-sans)',
								}}
							>
								{formatDayHeader(group.dateKey)}
							</span>
							<span
								style={{
									fontSize: '0.6875rem',
									fontWeight: 600,
									color: 'var(--text-accent)',
									backgroundColor: 'rgba(200, 255, 0, 0.1)',
									padding: '0.125rem 0.5rem',
									borderRadius: '9999px',
									fontFamily: 'var(--font-mono)',
								}}
							>
								{group.documents.length}
							</span>
						</div>

						{/* Timeline entries */}
						<div
							style={{
								borderLeft: '2px solid var(--text-accent)',
								paddingLeft: '1.5rem',
								marginLeft: '0.5rem',
								display: 'flex',
								flexDirection: 'column',
								gap: '0.75rem',
							}}
						>
							{group.documents.map((doc) => {
								const color = getSourceColor(doc.source_type);
								const preview = doc.raw_content
									? doc.raw_content.slice(0, 100).replace(/\s+/g, ' ').trim()
									: '';

								return (
									<div
										key={doc.id}
										style={{
											position: 'relative',
											backgroundColor: 'var(--bg-secondary)',
											border: '1px solid var(--border-default)',
											borderRadius: '0.5rem',
											padding: '0.875rem 1rem',
										}}
									>
										{/* Timeline dot */}
										<div
											style={{
												position: 'absolute',
												left: '-1.5rem',
												top: '1rem',
												transform: 'translateX(-50%) translateX(-1px)',
												width: 8,
												height: 8,
												borderRadius: '50%',
												backgroundColor: color,
											}}
										/>

										{/* Title row */}
										<div
											style={{
												display: 'flex',
												alignItems: 'center',
												gap: '0.5rem',
												marginBottom: '0.375rem',
												flexWrap: 'wrap',
											}}
										>
											<span
												style={{
													fontSize: '0.875rem',
													fontWeight: 600,
													color: 'var(--text-primary)',
													fontFamily: 'var(--font-sans)',
												}}
											>
												{doc.title}
											</span>

											{/* Source type badge */}
											<span
												style={{
													fontSize: '0.6875rem',
													fontWeight: 500,
													color: color,
													backgroundColor: `${color}18`,
													padding: '0.0625rem 0.4375rem',
													borderRadius: '9999px',
													fontFamily: 'var(--font-mono)',
												}}
											>
												{doc.source_type}
											</span>

											{/* Time */}
											<span
												style={{
													fontSize: '0.75rem',
													color: 'var(--text-muted)',
													fontFamily: 'var(--font-mono)',
													marginLeft: 'auto',
												}}
											>
												{formatTime(doc.created_at)}
											</span>
										</div>

										{/* Content preview */}
										{preview && (
											<p
												style={{
													fontSize: '0.8125rem',
													color: 'var(--text-muted)',
													lineHeight: 1.5,
													overflow: 'hidden',
													textOverflow: 'ellipsis',
													whiteSpace: 'nowrap',
												}}
											>
												{preview}
												{doc.raw_content && doc.raw_content.length > 100 ? '\u2026' : ''}
											</p>
										)}
									</div>
								);
							})}
						</div>
					</div>
				))}
			</div>

			{/* Load more button */}
			{hasMore && (
				<div
					style={{
						display: 'flex',
						justifyContent: 'center',
						marginTop: '2rem',
					}}
				>
					<button
						type="button"
						onClick={() => setOffset((prev) => prev + 50)}
						disabled={isLoading}
						style={{
							padding: '0.625rem 1.5rem',
							backgroundColor: isLoading ? 'var(--bg-tertiary)' : 'var(--bg-secondary)',
							color: isLoading ? 'var(--text-muted)' : 'var(--text-primary)',
							border: '1px solid var(--border-default)',
							borderRadius: '0.5rem',
							fontWeight: 500,
							fontSize: '0.875rem',
							cursor: isLoading ? 'not-allowed' : 'pointer',
							fontFamily: 'var(--font-sans)',
						}}
					>
						{isLoading ? 'Loading\u2026' : 'Load more'}
					</button>
				</div>
			)}
		</div>
	);
}
