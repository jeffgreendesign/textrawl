import { useCallback, useEffect, useMemo, useRef, useState } from 'preact/hooks';
import type { DirectoryStats, PipelineStatus, TreeFile } from '../../shared/types.js';
import { FILE_ICONS } from './FileList.js';

interface DirectoryTreeProps {
	tree: TreeFile[];
	selectedPaths: Set<string>;
	onSelectionChange: (paths: Set<string>) => void;
	filterStatus?: PipelineStatus | null;
	isOperating?: boolean;
}

const STATUS_BADGES: Record<PipelineStatus, { icon: string; className: string }> = {
	pending: { icon: '○', className: 'tree-node__status--pending' },
	converting: { icon: '◐', className: 'tree-node__status--converting' },
	converted: { icon: '◑', className: 'tree-node__status--converted' },
	uploading: { icon: '◐', className: 'tree-node__status--uploading' },
	uploaded: { icon: '●', className: 'tree-node__status--uploaded' },
	error: { icon: '✗', className: 'tree-node__status--error' },
	oversized: { icon: '▲', className: 'tree-node__status--oversized' },
	unsupported: { icon: '−', className: 'tree-node__status--unsupported' },
};

/** Display constant matching MAX_RETRIES in project-store. */
const MAX_RETRIES_DISPLAY = 3;

const ROW_HEIGHT = 28;
const OVERSCAN = 5;

type CheckState = 'unchecked' | 'checked' | 'indeterminate';

/** Statuses that are actionable (can be converted, retried, or re-attempted). */
const ACTIONABLE_STATUSES = new Set<PipelineStatus>(['pending', 'error', 'oversized']);

/** Recursively collect all actionable file paths under a directory node. */
function collectActionablePaths(node: TreeFile): string[] {
	const paths: string[] = [];
	if (node.isDirectory && node.children) {
		for (const child of node.children) {
			paths.push(...collectActionablePaths(child));
		}
	} else if (node.converterType !== null && ACTIONABLE_STATUSES.has(node.pipelineStatus)) {
		paths.push(node.relativePath);
	}
	return paths;
}

function formatSize(bytes: number): string {
	if (bytes < 1024) return `${bytes} B`;
	if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(0)} KB`;
	return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

interface FlatRow {
	node: TreeFile;
	depth: number;
	isExpanded: boolean;
}

/** Map PipelineStatus to the corresponding DirectoryStats key */
const STATUS_TO_STATS_KEY: Record<PipelineStatus, keyof DirectoryStats | null> = {
	pending: 'pending',
	converting: 'pending',
	converted: 'converted',
	uploading: 'converted',
	uploaded: 'uploaded',
	error: 'errors',
	oversized: 'oversized',
	unsupported: 'unsupported',
};

/** Build a tooltip string from directory stats showing non-zero statuses */
function formatStatsTooltip(stats: DirectoryStats): string {
	const parts: string[] = [];
	if (stats.pending > 0) parts.push(`${stats.pending} pending`);
	if (stats.converted > 0) parts.push(`${stats.converted} converted`);
	if (stats.uploaded > 0) parts.push(`${stats.uploaded} uploaded`);
	if (stats.errors > 0) parts.push(`${stats.errors} errors`);
	if (stats.oversized > 0) parts.push(`${stats.oversized} oversized`);
	if (stats.unsupported > 0) parts.push(`${stats.unsupported} unsupported`);
	return parts.join(', ');
}

/**
 * Flatten tree into a list of visible rows, respecting expanded state and optional filter.
 */
function flattenTree(
	nodes: TreeFile[],
	expandedPaths: Set<string>,
	depth: number,
	filterStatus?: PipelineStatus | null,
): FlatRow[] {
	const rows: FlatRow[] = [];
	for (const node of nodes) {
		// When filtering, skip non-matching nodes
		if (filterStatus) {
			if (node.isDirectory) {
				// Check recursiveStats to avoid walking the whole subtree
				const statsKey = STATUS_TO_STATS_KEY[filterStatus];
				const count = statsKey && node.recursiveStats ? node.recursiveStats[statsKey] : 0;
				if (count === 0) continue;
			} else if (node.pipelineStatus !== filterStatus) {
				continue;
			}
		}

		const isExpanded = expandedPaths.has(node.relativePath);
		rows.push({ node, depth, isExpanded });
		if (node.isDirectory && isExpanded && node.children) {
			rows.push(...flattenTree(node.children, expandedPaths, depth + 1, filterStatus));
		}
	}
	return rows;
}

export function DirectoryTree({
	tree,
	selectedPaths,
	onSelectionChange,
	filterStatus,
	isOperating,
}: DirectoryTreeProps) {
	const [expandedPaths, setExpandedPaths] = useState<Set<string>>(new Set());
	const [scrollTop, setScrollTop] = useState(0);
	const containerRef = useRef<HTMLDivElement>(null);

	const flatRows = useMemo(
		() => flattenTree(tree, expandedPaths, 0, filterStatus),
		[tree, expandedPaths, filterStatus],
	);

	const containerHeight = 400; // matches CSS max-height
	const totalHeight = flatRows.length * ROW_HEIGHT;

	const startIndex = Math.max(0, Math.floor(scrollTop / ROW_HEIGHT) - OVERSCAN);
	const endIndex = Math.min(
		flatRows.length,
		Math.ceil((scrollTop + containerHeight) / ROW_HEIGHT) + OVERSCAN,
	);
	const visibleRows = flatRows.slice(startIndex, endIndex);
	const offsetTop = startIndex * ROW_HEIGHT;

	const handleScroll = useCallback(() => {
		if (containerRef.current) {
			setScrollTop(containerRef.current.scrollTop);
		}
	}, []);

	// Reset scroll when tree changes structurally
	// biome-ignore lint/correctness/useExhaustiveDependencies: tree identity change is the intended trigger
	useEffect(() => {
		setScrollTop(containerRef.current?.scrollTop ?? 0);
	}, [tree]);

	const handleToggleExpand = useCallback((path: string) => {
		setExpandedPaths((prev) => {
			const next = new Set(prev);
			if (next.has(path)) {
				next.delete(path);
			} else {
				next.add(path);
			}
			return next;
		});
	}, []);

	const handleToggleSelect = useCallback(
		(path: string) => {
			const next = new Set(selectedPaths);
			if (next.has(path)) {
				next.delete(path);
			} else {
				next.add(path);
			}
			onSelectionChange(next);
		},
		[selectedPaths, onSelectionChange],
	);

	/** O(n) bottom-up walk: compute convertible/selected counts for every directory. */
	const directoryCheckStates = useMemo(() => {
		const states = new Map<string, { convertible: number; selected: number }>();
		function walk(nodes: TreeFile[]): { convertible: number; selected: number } {
			let convertible = 0;
			let selected = 0;
			for (const node of nodes) {
				if (node.isDirectory && node.children) {
					const sub = walk(node.children);
					convertible += sub.convertible;
					selected += sub.selected;
					states.set(node.relativePath, {
						convertible: sub.convertible,
						selected: sub.selected,
					});
				} else if (node.converterType !== null && ACTIONABLE_STATUSES.has(node.pipelineStatus)) {
					convertible++;
					if (selectedPaths.has(node.relativePath)) selected++;
				}
			}
			return { convertible, selected };
		}
		walk(tree);
		return states;
	}, [tree, selectedPaths]);

	const handleToggleDirectorySelect = useCallback(
		(node: TreeFile) => {
			const convertible = collectActionablePaths(node);
			if (convertible.length === 0) return;
			const next = new Set(selectedPaths);
			const allSelected = convertible.every((p) => next.has(p));
			if (allSelected) {
				for (const p of convertible) next.delete(p);
			} else {
				for (const p of convertible) next.add(p);
			}
			onSelectionChange(next);
		},
		[selectedPaths, onSelectionChange],
	);

	if (tree.length === 0) {
		return (
			<div class="directory-tree">
				<div class="directory-tree__empty">No files found</div>
			</div>
		);
	}

	if (flatRows.length === 0 && filterStatus) {
		return (
			<div class="directory-tree">
				<div class="directory-tree__empty">No {filterStatus} files found</div>
			</div>
		);
	}

	return (
		<div
			class={`directory-tree${isOperating ? ' directory-tree--operating' : ''}`}
			ref={containerRef}
			onScroll={handleScroll}
			style={{ maxHeight: `${containerHeight}px`, overflowY: 'auto' }}
		>
			<div style={{ height: `${totalHeight}px`, position: 'relative' }}>
				<div style={{ position: 'absolute', top: `${offsetTop}px`, left: 0, right: 0 }}>
					{visibleRows.map((row) => {
						const { node, depth, isExpanded } = row;
						const isSelected = selectedPaths.has(node.relativePath);
						const badge = STATUS_BADGES[node.pipelineStatus];
						const isAnimated =
							node.pipelineStatus === 'converting' || node.pipelineStatus === 'uploading';

						if (node.isDirectory) {
							const dirState = directoryCheckStates.get(node.relativePath);
							const convertibleCount = dirState?.convertible ?? 0;
							const dirSelectedCount = dirState?.selected ?? 0;
							const checkState: CheckState =
								convertibleCount === 0
									? 'unchecked'
									: dirSelectedCount === convertibleCount
										? 'checked'
										: dirSelectedCount > 0
											? 'indeterminate'
											: 'unchecked';
							const hasConvertible = convertibleCount > 0;
							const tooltip = node.recursiveStats ? formatStatsTooltip(node.recursiveStats) : '';
							const countLabel =
								convertibleCount > 0
									? `${convertibleCount} actionable`
									: String(node.recursiveStats?.total ?? node.children?.length ?? 0);
							return (
								<div
									key={node.relativePath}
									class={`tree-node tree-node--directory ${checkState !== 'unchecked' ? 'tree-node--selected' : ''}`}
									style={{
										paddingLeft: `${depth * 20 + 8}px`,
										height: `${ROW_HEIGHT}px`,
									}}
									role="button"
									tabIndex={isOperating ? -1 : 0}
									onClick={() => !isOperating && handleToggleDirectorySelect(node)}
									onKeyDown={(e: KeyboardEvent) => {
										if (!isOperating && (e.key === 'Enter' || e.key === ' ')) {
											e.preventDefault();
											handleToggleDirectorySelect(node);
										}
									}}
								>
									{/* biome-ignore lint/a11y/useKeyWithClickEvents: keyboard handled on parent row */}
									<span
										class="tree-node__expander"
										onClick={(e: MouseEvent) => {
											e.stopPropagation();
											handleToggleExpand(node.relativePath);
										}}
									>
										{isExpanded ? '▾' : '▸'}
									</span>
									<span
										class={`tree-node__checkbox ${!hasConvertible ? 'tree-node__checkbox--disabled' : ''}`}
									>
										{checkState === 'checked' ? '☑' : checkState === 'indeterminate' ? '▣' : '☐'}
									</span>
									<span class="tree-node__icon">📁</span>
									<span class="tree-node__name">{node.name}</span>
									<span class="tree-node__count" title={tooltip}>
										{countLabel}
									</span>
								</div>
							);
						}

						const icon = FILE_ICONS[node.fileType] || FILE_ICONS.unknown;

						return (
							<div
								key={node.relativePath}
								class={`tree-node ${isSelected ? 'tree-node--selected' : ''}`}
								style={{
									paddingLeft: `${depth * 20 + 8}px`,
									height: `${ROW_HEIGHT}px`,
								}}
								role="button"
								tabIndex={isOperating ? -1 : 0}
								onClick={() => !isOperating && handleToggleSelect(node.relativePath)}
								onKeyDown={(e: KeyboardEvent) => {
									if (!isOperating && (e.key === 'Enter' || e.key === ' ')) {
										e.preventDefault();
										handleToggleSelect(node.relativePath);
									}
								}}
							>
								<span class="tree-node__expander" />
								<span class="tree-node__checkbox">{isSelected ? '☑' : '☐'}</span>
								<span class="tree-node__icon">{icon}</span>
								<span class="tree-node__name" title={node.relativePath}>
									{node.name}
								</span>
								<span class="tree-node__size">{formatSize(node.size)}</span>
								{node.pipelineStatus === 'error' &&
									node.retryCount !== undefined &&
									node.retryCount > 0 && (
										<span
											class="tree-node__retry-count"
											title={`${node.retryCount}/${MAX_RETRIES_DISPLAY} attempts`}
										>
											{node.retryCount >= MAX_RETRIES_DISPLAY
												? 'max retries'
												: `${node.retryCount}/${MAX_RETRIES_DISPLAY}`}
										</span>
									)}
								<span
									class={`tree-node__status ${badge.className} ${isAnimated ? 'tree-node__status--animated' : ''}`}
									title={node.error || node.pipelineStatus}
								>
									{isAnimated ? <span class="spinner" /> : badge.icon}
								</span>
							</div>
						);
					})}
				</div>
			</div>
		</div>
	);
}
