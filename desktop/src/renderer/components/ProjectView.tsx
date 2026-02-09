import { useEffect, useRef, useState } from 'preact/hooks';
import type {
	LogEntry,
	PipelineStatus,
	ProjectState,
	ProjectStats,
	TreeFile,
} from '../../shared/types.js';
import { DirectoryTree } from './DirectoryTree.js';
import { ProjectActions } from './ProjectActions.js';
import { ProjectStats as ProjectStatsBar } from './ProjectStats.js';

interface ProjectViewProps {
	onBack: () => void;
	addLog: (level: LogEntry['level'], message: string, details?: string) => void;
}

function collectPaths(nodes: TreeFile[], status: PipelineStatus): string[] {
	const paths: string[] = [];
	for (const node of nodes) {
		if (node.isDirectory && node.children) {
			paths.push(...collectPaths(node.children, status));
		} else if (node.pipelineStatus === status) {
			paths.push(node.relativePath);
		}
	}
	return paths;
}

function basename(dir: string): string {
	const parts = dir.replace(/\\/g, '/').split('/');
	return parts[parts.length - 1] || dir;
}

export function ProjectView({ onBack, addLog }: ProjectViewProps) {
	const [projectState, setProjectState] = useState<ProjectState | null>(null);
	const [tree, setTree] = useState<TreeFile[]>([]);
	const [stats, setStats] = useState<ProjectStats | null>(null);
	const [selectedPaths, setSelectedPaths] = useState<Set<string>>(new Set());
	const [loading, setLoading] = useState(true);

	// Use refs so the init effect doesn't re-run when callbacks change
	const onBackRef = useRef(onBack);
	onBackRef.current = onBack;
	const addLogRef = useRef(addLog);
	addLogRef.current = addLog;

	// Prompt for directories and load project on mount
	useEffect(() => {
		let cancelled = false;

		const init = async () => {
			try {
				const sourceDir = await window.electronAPI.selectFolder();
				if (!sourceDir || cancelled) {
					onBackRef.current();
					return;
				}

				const outputDir = await window.electronAPI.selectFolder();
				if (!outputDir || cancelled) {
					onBackRef.current();
					return;
				}

				addLogRef.current('info', `Loading project: ${basename(sourceDir)}`);

				const state = await window.electronAPI.loadProject(sourceDir, outputDir);
				if (!state || cancelled) {
					addLogRef.current('error', 'Failed to load project');
					onBackRef.current();
					return;
				}

				setProjectState(state);
				setStats(state.stats);

				const projectTree = await window.electronAPI.getProjectTree();
				if (!cancelled) {
					setTree(projectTree);
					setLoading(false);
					addLogRef.current(
						'info',
						`Project loaded: ${state.stats.total} files (${state.stats.pending} pending)`,
					);
				}
			} catch (error) {
				if (!cancelled) {
					addLogRef.current('error', 'Failed to load project', String(error));
					onBackRef.current();
				}
			}
		};

		init();

		return () => {
			cancelled = true;
		};
	}, []);

	// Set up IPC event listeners
	useEffect(() => {
		const unsubFile = window.electronAPI.onFileUpdate((updatedFiles) => {
			setTree((prev) => applyFileUpdates(prev, updatedFiles));
		});

		const unsubTreeSync = window.electronAPI.onTreeSync((newTree) => {
			setTree(newTree);
		});

		const unsubStats = window.electronAPI.onStatsUpdate((updatedStats) => {
			setStats(updatedStats);
		});

		return () => {
			unsubFile();
			unsubTreeSync();
			unsubStats();
			window.electronAPI
				.unloadProject()
				.catch((err) => console.error('unloadProject failed:', err));
		};
	}, []);

	const handleRefresh = async () => {
		try {
			addLog('info', 'Refreshing project...');
			const state = await window.electronAPI.refreshProject();
			if (state) {
				setProjectState(state);
				setStats(state.stats);
			}
			const projectTree = await window.electronAPI.getProjectTree();
			setTree(projectTree);
			addLog('info', 'Project refreshed');
		} catch (error) {
			addLog('error', 'Failed to refresh project', String(error));
		}
	};

	const handleConvertAll = async () => {
		const paths = collectPaths(tree, 'pending');
		if (paths.length === 0) return;
		try {
			addLog('info', `Converting ${paths.length} pending file(s)...`);
			await window.electronAPI.convertFiles(paths);
		} catch (error) {
			addLog('error', 'Conversion failed', String(error));
		}
	};

	const handleConvertSelected = async () => {
		const paths = [...selectedPaths];
		if (paths.length === 0) return;
		try {
			addLog('info', `Converting ${paths.length} selected file(s)...`);
			await window.electronAPI.convertFiles(paths);
		} catch (error) {
			addLog('error', 'Conversion failed', String(error));
		}
	};

	const handleUpload = async () => {
		try {
			addLog('info', 'Uploading converted files...');
			await window.electronAPI.uploadConverted();
		} catch (error) {
			addLog('error', 'Upload failed', String(error));
		}
	};

	const handleRetry = async () => {
		const paths = collectPaths(tree, 'error');
		if (paths.length === 0) return;
		try {
			addLog('info', `Retrying ${paths.length} failed file(s)...`);
			await window.electronAPI.retryFiles(paths);
		} catch (error) {
			addLog('error', 'Retry failed', String(error));
		}
	};

	if (loading) {
		return (
			<div class="project-view">
				<div class="project-view__loading">Loading project...</div>
			</div>
		);
	}

	return (
		<div class="project-view">
			<div class="project-header">
				<span class="project-header__path" title={projectState?.sourceDir}>
					{projectState ? basename(projectState.sourceDir) : ''}
				</span>
				<div class="project-header__actions">
					<button type="button" class="btn-small" onClick={handleRefresh}>
						Refresh
					</button>
					<button type="button" class="btn-small" onClick={onBack}>
						Back
					</button>
				</div>
			</div>

			{stats && <ProjectStatsBar stats={stats} />}

			<DirectoryTree
				tree={tree}
				selectedPaths={selectedPaths}
				onSelectionChange={setSelectedPaths}
			/>

			{stats && (
				<ProjectActions
					stats={stats}
					selectedCount={selectedPaths.size}
					onConvertAll={handleConvertAll}
					onConvertSelected={handleConvertSelected}
					onUpload={handleUpload}
					onRetry={handleRetry}
				/>
			)}
		</div>
	);
}

/**
 * Apply file updates to the tree by matching relativePath.
 * The main process sends an array of updated TreeFile nodes.
 */
function applyFileUpdates(tree: TreeFile[], updates: TreeFile[]): TreeFile[] {
	const updateMap = new Map<string, TreeFile>();
	for (const u of updates) {
		updateMap.set(u.relativePath, u);
	}
	return updateTree(tree, updateMap);
}

function updateTree(nodes: TreeFile[], updateMap: Map<string, TreeFile>): TreeFile[] {
	return nodes.map((node) => {
		const update = updateMap.get(node.relativePath);
		if (update) return update;
		if (node.isDirectory && node.children) {
			return { ...node, children: updateTree(node.children, updateMap) };
		}
		return node;
	});
}
