import { useEffect, useRef, useState } from 'preact/hooks';
import type {
	LogEntry,
	OverallProgress,
	PipelineStatus,
	ProjectState,
	ProjectStats,
	RecentProject,
	StatusReport,
	TreeFile,
} from '../../shared/types.js';
import { DirectoryTree } from './DirectoryTree.js';
import { ProgressBar } from './ProgressBar.js';
import { ProjectActions } from './ProjectActions.js';
import { ProjectStats as ProjectStatsBar } from './ProjectStats.js';
import { StatusHelpPanel } from './StatusHelpPanel.js';

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

function formatRelativeTime(isoDate: string): string {
	const diff = Date.now() - new Date(isoDate).getTime();
	const minutes = Math.floor(diff / 60_000);
	if (minutes < 1) return 'just now';
	if (minutes < 60) return `${minutes}m ago`;
	const hours = Math.floor(minutes / 60);
	if (hours < 24) return `${hours}h ago`;
	const days = Math.floor(hours / 24);
	if (days < 30) return `${days}d ago`;
	return new Date(isoDate).toLocaleDateString();
}

type Phase = 'picking' | 'loading' | 'loaded';

export function ProjectView({ onBack, addLog }: ProjectViewProps) {
	const [phase, setPhase] = useState<Phase>('picking');
	const [recentProjects, setRecentProjects] = useState<RecentProject[]>([]);
	const [projectState, setProjectState] = useState<ProjectState | null>(null);
	const [tree, setTree] = useState<TreeFile[]>([]);
	const [stats, setStats] = useState<ProjectStats | null>(null);
	const [selectedPaths, setSelectedPaths] = useState<Set<string>>(new Set());

	// Filter and help panel state
	const [filterStatus, setFilterStatus] = useState<PipelineStatus | null>(null);
	const [helpStatus, setHelpStatus] = useState<PipelineStatus | null>(null);
	const [report, setReport] = useState<StatusReport | null>(null);

	// Operation progress state
	const [overallProgress, setOverallProgress] = useState<OverallProgress | null>(null);
	const [isConverting, setIsConverting] = useState(false);
	const [isUploading, setIsUploading] = useState(false);
	const isOperating = isConverting || isUploading;

	// Verbose toggle
	const [verboseEnabled, setVerboseEnabled] = useState(false);

	// Use refs so callbacks don't cause re-runs
	const addLogRef = useRef(addLog);
	addLogRef.current = addLog;

	// Load recent projects and settings on mount
	useEffect(() => {
		window.electronAPI.getRecentProjects().then(setRecentProjects);
		window.electronAPI.loadSettings().then((settings) => {
			setVerboseEnabled(settings.verboseLogging ?? false);
		});
	}, []);

	const openProject = async (sourceDir: string, outputDir: string) => {
		setPhase('loading');
		try {
			addLogRef.current('info', `Loading project: ${basename(sourceDir)}`);

			const state = await window.electronAPI.loadProject(sourceDir, outputDir);
			if (!state) {
				addLogRef.current('error', 'Failed to load project');
				setPhase('picking');
				return;
			}

			setProjectState(state);
			setStats(state.stats);

			const projectTree = await window.electronAPI.getProjectTree();
			setTree(projectTree);
			setPhase('loaded');
			addLogRef.current(
				'info',
				`Project loaded: ${state.stats.total} files (${state.stats.pending} pending)`,
			);
		} catch (error) {
			addLogRef.current('error', 'Failed to load project', String(error));
			setPhase('picking');
		}
	};

	const handleBrowse = async () => {
		const sourceDir = await window.electronAPI.selectFolder();
		if (!sourceDir) return;
		const outputDir = `${sourceDir}-converted`;
		await openProject(sourceDir, outputDir);
	};

	const handleSelectRecent = (project: RecentProject) => {
		openProject(project.sourceDir, project.outputDir);
	};

	const handleRemoveRecent = async (e: Event, sourceDir: string) => {
		e.stopPropagation();
		await window.electronAPI.removeRecentProject(sourceDir);
		setRecentProjects((prev) => prev.filter((p) => p.sourceDir !== sourceDir));
	};

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

		const unsubProgress = window.electronAPI.onProgress((update) => {
			if (update.type === 'overall') {
				setOverallProgress(update.data as OverallProgress);
			}
		});

		// Only clear progress on completion — operation state (isConverting/isUploading)
		// is managed by the finally blocks in each handler to prevent premature resets
		// when convertSelected runs multiple groups sequentially.
		const unsubComplete = window.electronAPI.onComplete(() => {
			setOverallProgress(null);
		});

		return () => {
			unsubFile();
			unsubTreeSync();
			unsubStats();
			unsubProgress();
			unsubComplete();
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
		if (paths.length === 0) {
			addLog('warn', 'No pending files found to convert');
			return;
		}
		setIsConverting(true);
		setOverallProgress(null);
		setSelectedPaths(new Set());
		try {
			addLog('info', `Converting ${paths.length} pending file(s)...`);
			await window.electronAPI.convertFiles(paths);
			addLog('info', 'Conversion finished');
		} catch (error) {
			addLog('error', 'Conversion failed', String(error));
		} finally {
			setIsConverting(false);
		}
	};

	const handleConvertSelected = async () => {
		const paths = [...selectedPaths];
		if (paths.length === 0) {
			addLog('warn', 'No files selected');
			return;
		}
		setIsConverting(true);
		setOverallProgress(null);
		setSelectedPaths(new Set());
		try {
			addLog('info', `Processing ${paths.length} selected file(s)...`);
			const result = await window.electronAPI.convertSelected(paths);

			const parts: string[] = [];
			if (result.pending > 0) parts.push(`${result.pending} converted`);
			if (result.retried > 0) parts.push(`${result.retried} retried`);
			if (result.oversized > 0) parts.push(`${result.oversized} oversized`);

			if (parts.length > 0) {
				addLog('info', `Done: ${parts.join(', ')}`);
			} else {
				addLog('warn', `No convertible files in selection (${result.skipped} skipped)`);
			}
		} catch (error) {
			addLog('error', 'Conversion failed', String(error));
		} finally {
			setIsConverting(false);
		}
	};

	const handleConvertOversized = async () => {
		const paths = collectPaths(tree, 'oversized');
		if (paths.length === 0) {
			addLog('warn', 'No oversized files found');
			return;
		}
		setIsConverting(true);
		setOverallProgress(null);
		setSelectedPaths(new Set());
		try {
			addLog('info', `Converting ${paths.length} oversized file(s)...`);
			await window.electronAPI.convertOversized(paths);
			addLog('info', 'Conversion finished');
		} catch (error) {
			addLog('error', 'Oversized conversion failed', String(error));
		} finally {
			setIsConverting(false);
		}
	};

	const handleUpload = async () => {
		setIsUploading(true);
		setOverallProgress(null);
		setSelectedPaths(new Set());
		try {
			addLog('info', 'Uploading converted files...');
			await window.electronAPI.uploadConverted();
			addLog('info', 'Upload finished');
		} catch (error) {
			addLog('error', 'Upload failed', String(error));
		} finally {
			setIsUploading(false);
		}
	};

	const handleRetry = async () => {
		const paths = collectPaths(tree, 'error');
		if (paths.length === 0) return;
		setIsConverting(true);
		setOverallProgress(null);
		setSelectedPaths(new Set());
		try {
			addLog('info', `Retrying ${paths.length} failed file(s)...`);
			await window.electronAPI.retryFiles(paths);
			addLog('info', 'Retry finished');
		} catch (error) {
			addLog('error', 'Retry failed', String(error));
		} finally {
			setIsConverting(false);
		}
	};

	const handleDismissErrors = async () => {
		try {
			const result = await window.electronAPI.dismissErrors();
			if (result.dismissed > 0) {
				addLog('info', `Dismissed ${result.dismissed} error(s) — files reset to their base status`);
			} else {
				addLog('info', 'No errors to dismiss');
			}
		} catch (error) {
			addLog('error', 'Failed to dismiss errors', String(error));
		}
	};

	const handleGenerateReport = async () => {
		try {
			const r = await window.electronAPI.generateReport();
			setReport(r);
			addLog(
				'info',
				`Report generated: ${r.totalOversized} oversized, ${r.totalUnsupported} unsupported`,
			);
		} catch (error) {
			addLog('error', 'Failed to generate report', String(error));
		}
	};

	const handleFilterClick = (status: PipelineStatus) => {
		setFilterStatus((prev) => (prev === status ? null : status));
	};

	const handleInfoClick = (status: PipelineStatus) => {
		setHelpStatus((prev) => (prev === status ? null : status));
		// Clear report when switching help status
		if (status !== helpStatus) setReport(null);
	};

	const handleToggleVerbose = async () => {
		const newValue = !verboseEnabled;
		try {
			const settings = await window.electronAPI.loadSettings();
			settings.verboseLogging = newValue;
			await window.electronAPI.saveSettings(settings);
			setVerboseEnabled(newValue);
			addLog('info', `Verbose logging ${newValue ? 'enabled' : 'disabled'}`);
		} catch (error) {
			addLog('error', 'Failed to update verbose setting', String(error));
		}
	};

	if (phase === 'picking') {
		return (
			<div class="project-view">
				<div class="project-picker">
					<div class="project-picker__header">
						<span>Open Project</span>
						<button type="button" class="btn-small" onClick={onBack}>
							Back
						</button>
					</div>
					{recentProjects.length > 0 && (
						<div class="project-picker__recent">
							<div class="project-picker__section-label">Recent</div>
							{recentProjects.map((project) => (
								<button
									type="button"
									key={project.sourceDir}
									class="project-picker__item"
									onClick={() => handleSelectRecent(project)}
								>
									<span class="project-picker__item-name">{basename(project.sourceDir)}</span>
									<span class="project-picker__item-path" title={project.sourceDir}>
										{project.sourceDir}
									</span>
									<span class="project-picker__item-time">
										{formatRelativeTime(project.lastOpened)}
									</span>
									<button
										type="button"
										class="project-picker__item-remove"
										onClick={(e) => handleRemoveRecent(e, project.sourceDir)}
										title="Remove from recent"
									>
										x
									</button>
								</button>
							))}
						</div>
					)}
					<button type="button" class="project-picker__browse" onClick={handleBrowse}>
						Browse...
					</button>
				</div>
			</div>
		);
	}

	if (phase === 'loading') {
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
					<button
						type="button"
						class={`btn-small ${verboseEnabled ? 'btn-small--active' : ''}`}
						onClick={handleToggleVerbose}
						title="Toggle verbose logging for conversions"
					>
						Verbose {verboseEnabled ? 'ON' : 'OFF'}
					</button>
					<button type="button" class="btn-small" onClick={handleRefresh}>
						Refresh
					</button>
					<button type="button" class="btn-small" onClick={onBack}>
						Back
					</button>
				</div>
			</div>

			{stats && (
				<ProjectStatsBar
					stats={stats}
					activeFilter={filterStatus}
					onFilterClick={handleFilterClick}
					onInfoClick={handleInfoClick}
				/>
			)}

			{helpStatus && (
				<StatusHelpPanel
					status={helpStatus}
					report={report}
					onClose={() => {
						setHelpStatus(null);
						setReport(null);
					}}
					onConvertOversized={handleConvertOversized}
					onGenerateReport={handleGenerateReport}
				/>
			)}

			{filterStatus && (
				<div class="filter-indicator">
					<span>Showing: {filterStatus} files</span>
					<button type="button" class="btn-small" onClick={() => setFilterStatus(null)}>
						Clear
					</button>
				</div>
			)}

			<DirectoryTree
				tree={tree}
				selectedPaths={selectedPaths}
				onSelectionChange={setSelectedPaths}
				filterStatus={filterStatus}
				isOperating={isOperating}
			/>

			{isOperating && overallProgress && (
				<ProgressBar progress={overallProgress} isConverting={isConverting} />
			)}

			{stats && (
				<ProjectActions
					stats={stats}
					selectedCount={selectedPaths.size}
					disabled={isOperating}
					onConvertAll={handleConvertAll}
					onConvertSelected={handleConvertSelected}
					onUpload={handleUpload}
					onRetry={handleRetry}
					onConvertOversized={handleConvertOversized}
					onDismissErrors={handleDismissErrors}
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
