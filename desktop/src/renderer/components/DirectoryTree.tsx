import { useState } from 'preact/hooks';
import type { PipelineStatus, TreeFile } from '../../shared/types';
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

function formatSize(bytes: number): string {
	if (bytes < 1024) return `${bytes} B`;
	if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(0)} KB`;
	return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

interface TreeNodeProps {
	node: TreeFile;
	depth: number;
	expandedPaths: Set<string>;
	selectedPaths: Set<string>;
	onToggleExpand: (path: string) => void;
	onToggleSelect: (path: string) => void;
}

function TreeNode({
	node,
	depth,
	expandedPaths,
	selectedPaths,
	onToggleExpand,
	onToggleSelect,
}: TreeNodeProps) {
	const isExpanded = expandedPaths.has(node.relativePath);
	const isSelected = selectedPaths.has(node.relativePath);
	const badge = STATUS_BADGES[node.pipelineStatus];
	const isAnimated = node.pipelineStatus === 'converting' || node.pipelineStatus === 'uploading';

	if (node.isDirectory) {
		const childCount = node.children?.length ?? 0;
		return (
			<>
				<div
					class={`tree-node tree-node--directory ${isSelected ? 'tree-node--selected' : ''}`}
					style={{ paddingLeft: `${depth * 20 + 8}px` }}
					role="button"
					tabIndex={0}
					onClick={() => onToggleExpand(node.relativePath)}
					onKeyDown={(e: KeyboardEvent) => {
						if (e.key === 'Enter' || e.key === ' ') {
							e.preventDefault();
							onToggleExpand(node.relativePath);
						}
					}}
				>
					<span class="tree-node__expander">{isExpanded ? '▾' : '▸'}</span>
					<span class="tree-node__icon">📁</span>
					<span class="tree-node__name">{node.name}</span>
					<span class="tree-node__count">{childCount}</span>
				</div>
				{isExpanded &&
					node.children?.map((child) => (
						<TreeNode
							key={child.relativePath}
							node={child}
							depth={depth + 1}
							expandedPaths={expandedPaths}
							selectedPaths={selectedPaths}
							onToggleExpand={onToggleExpand}
							onToggleSelect={onToggleSelect}
						/>
					))}
			</>
		);
	}

	const icon = FILE_ICONS[node.fileType] || FILE_ICONS.unknown;

	return (
		<div
			class={`tree-node ${isSelected ? 'tree-node--selected' : ''}`}
			style={{ paddingLeft: `${depth * 20 + 8}px` }}
			role="button"
			tabIndex={0}
			onClick={() => onToggleSelect(node.relativePath)}
			onKeyDown={(e: KeyboardEvent) => {
				if (e.key === 'Enter' || e.key === ' ') {
					e.preventDefault();
					onToggleSelect(node.relativePath);
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
}

export function DirectoryTree({ tree, selectedPaths, onSelectionChange }: DirectoryTreeProps) {
	const [expandedPaths, setExpandedPaths] = useState<Set<string>>(new Set());

	const handleToggleExpand = (path: string) => {
		setExpandedPaths((prev) => {
			const next = new Set(prev);
			if (next.has(path)) {
				next.delete(path);
			} else {
				next.add(path);
			}
			return next;
		});
	};

	const handleToggleSelect = (path: string) => {
		const next = new Set(selectedPaths);
		if (next.has(path)) {
			next.delete(path);
		} else {
			next.add(path);
		}
		onSelectionChange(next);
	};

	if (tree.length === 0) {
		return (
			<div class="directory-tree">
				<div class="directory-tree__empty">No files found</div>
			</div>
		);
	}

	return (
		<div class="directory-tree">
			{tree.map((node) => (
				<TreeNode
					key={node.relativePath}
					node={node}
					depth={0}
					expandedPaths={expandedPaths}
					selectedPaths={selectedPaths}
					onToggleExpand={handleToggleExpand}
					onToggleSelect={handleToggleSelect}
				/>
			))}
		</div>
	);
}
