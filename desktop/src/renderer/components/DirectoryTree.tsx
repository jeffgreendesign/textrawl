import { useCallback, useEffect, useMemo, useRef, useState } from 'preact/hooks';
import type { PipelineStatus, TreeFile } from '../../shared/types.js';
import { FILE_ICONS } from './FileList.js';

interface DirectoryTreeProps {
	tree: TreeFile[];
	selectedPaths: Set<string>;
	onSelectionChange: (paths: Set<string>) => void;
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

const ROW_HEIGHT = 28;
const OVERSCAN = 5;

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

/**
 * Flatten tree into a list of visible rows, respecting expanded state.
 */
function flattenTree(nodes: TreeFile[], expandedPaths: Set<string>, depth: number): FlatRow[] {
	const rows: FlatRow[] = [];
	for (const node of nodes) {
		const isExpanded = expandedPaths.has(node.relativePath);
		rows.push({ node, depth, isExpanded });
		if (node.isDirectory && isExpanded && node.children) {
			rows.push(...flattenTree(node.children, expandedPaths, depth + 1));
		}
	}
	return rows;
}

export function DirectoryTree({ tree, selectedPaths, onSelectionChange }: DirectoryTreeProps) {
	const [expandedPaths, setExpandedPaths] = useState<Set<string>>(new Set());
	const [scrollTop, setScrollTop] = useState(0);
	const containerRef = useRef<HTMLDivElement>(null);

	const flatRows = useMemo(() => flattenTree(tree, expandedPaths, 0), [tree, expandedPaths]);

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

	if (tree.length === 0) {
		return (
			<div class="directory-tree">
				<div class="directory-tree__empty">No files found</div>
			</div>
		);
	}

	return (
		<div
			class="directory-tree"
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
							const childCount = node.children?.length ?? 0;
							return (
								<div
									key={node.relativePath}
									class={`tree-node tree-node--directory ${isSelected ? 'tree-node--selected' : ''}`}
									style={{
										paddingLeft: `${depth * 20 + 8}px`,
										height: `${ROW_HEIGHT}px`,
									}}
									role="button"
									tabIndex={0}
									onClick={() => handleToggleExpand(node.relativePath)}
									onKeyDown={(e: KeyboardEvent) => {
										if (e.key === 'Enter' || e.key === ' ') {
											e.preventDefault();
											handleToggleExpand(node.relativePath);
										}
									}}
								>
									<span class="tree-node__expander">{isExpanded ? '▾' : '▸'}</span>
									<span class="tree-node__icon">📁</span>
									<span class="tree-node__name">{node.name}</span>
									<span class="tree-node__count">{childCount}</span>
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
								tabIndex={0}
								onClick={() => handleToggleSelect(node.relativePath)}
								onKeyDown={(e: KeyboardEvent) => {
									if (e.key === 'Enter' || e.key === ' ') {
										e.preventDefault();
										handleToggleSelect(node.relativePath);
									}
								}}
							>
								<span class="tree-node__expander" />
								<span class="tree-node__icon">{icon}</span>
								<span class="tree-node__name" title={node.relativePath}>
									{node.name}
								</span>
								<span class="tree-node__size">{formatSize(node.size)}</span>
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
