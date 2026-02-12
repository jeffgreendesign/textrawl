/**
 * Textrawl Desktop - Preload Script
 * Exposes safe APIs to the renderer process via contextBridge
 */
import { clipboard, contextBridge, ipcRenderer, webUtils } from 'electron';
import { IPC } from '../shared/ipc-channels.js';
import type {
	AppSettings,
	ConversionOptions,
	ConvertSelectedResult,
	LogEntry,
	ProgressUpdate,
	ProjectState,
	ProjectStats,
	RecentProject,
	ScannedFile,
	StatusReport,
	TreeFile,
	UploadOptions,
} from '../shared/types.js';

// API exposed to renderer
const electronAPI = {
	// Scan dropped files/folders
	scanPaths: (paths: string[]): Promise<ScannedFile[]> => {
		return ipcRenderer.invoke(IPC.SCAN_PATHS, paths);
	},

	// Start conversion
	startConversion: (
		files: ScannedFile[],
		options: ConversionOptions,
	): Promise<{ success: boolean; error?: string }> => {
		return ipcRenderer.invoke(IPC.CONVERT_START, files, options);
	},

	// Cancel conversion
	cancelConversion: (): Promise<{ success: boolean }> => {
		return ipcRenderer.invoke(IPC.CONVERT_CANCEL);
	},

	// Start upload
	startUpload: (options: UploadOptions): Promise<{ success: boolean; error?: string }> => {
		return ipcRenderer.invoke(IPC.UPLOAD_START, options);
	},

	// Select folder dialog
	selectFolder: (): Promise<string | null> => {
		return ipcRenderer.invoke(IPC.SELECT_FOLDER);
	},

	// Select files/folders dialog
	selectFiles: (): Promise<string[]> => {
		return ipcRenderer.invoke(IPC.SELECT_FILES);
	},

	// Settings
	loadSettings: (): Promise<AppSettings> => {
		return ipcRenderer.invoke(IPC.SETTINGS_LOAD);
	},

	saveSettings: (settings: AppSettings): Promise<{ success: boolean }> => {
		return ipcRenderer.invoke(IPC.SETTINGS_SAVE, settings);
	},

	// Recent projects
	getRecentProjects: (): Promise<RecentProject[]> => {
		return ipcRenderer.invoke(IPC.PROJECT_GET_RECENT);
	},

	removeRecentProject: (sourceDir: string): Promise<void> => {
		return ipcRenderer.invoke(IPC.PROJECT_REMOVE_RECENT, sourceDir);
	},

	// Project management
	loadProject: (sourceDir: string, outputDir: string): Promise<ProjectState | null> => {
		return ipcRenderer.invoke(IPC.PROJECT_LOAD, sourceDir, outputDir);
	},

	unloadProject: (): Promise<void> => {
		return ipcRenderer.invoke(IPC.PROJECT_UNLOAD);
	},

	getProjectTree: (): Promise<TreeFile[]> => {
		return ipcRenderer.invoke(IPC.PROJECT_GET_TREE);
	},

	refreshProject: (): Promise<ProjectState | null> => {
		return ipcRenderer.invoke(IPC.PROJECT_REFRESH);
	},

	convertFiles: (paths: string[]): Promise<void> => {
		return ipcRenderer.invoke(IPC.PROJECT_CONVERT, paths);
	},

	convertSelected: (paths: string[]): Promise<ConvertSelectedResult> => {
		return ipcRenderer.invoke(IPC.PROJECT_CONVERT_SELECTED, paths);
	},

	uploadConverted: (): Promise<void> => {
		return ipcRenderer.invoke(IPC.PROJECT_UPLOAD);
	},

	retryFiles: (paths: string[]): Promise<void> => {
		return ipcRenderer.invoke(IPC.PROJECT_RETRY, paths);
	},

	convertOversized: (paths: string[]): Promise<void> => {
		return ipcRenderer.invoke(IPC.PROJECT_CONVERT_OVERSIZED, paths);
	},

	dismissErrors: (): Promise<{ dismissed: number }> => {
		return ipcRenderer.invoke(IPC.PROJECT_DISMISS_ERRORS);
	},

	generateReport: (): Promise<StatusReport> => {
		return ipcRenderer.invoke(IPC.PROJECT_GENERATE_REPORT);
	},

	// Event listeners (main → renderer)
	onProgress: (callback: (update: ProgressUpdate) => void) => {
		const handler = (_event: Electron.IpcRendererEvent, update: ProgressUpdate) => {
			callback(update);
		};
		ipcRenderer.on(IPC.PROGRESS, handler);
		return () => ipcRenderer.removeListener(IPC.PROGRESS, handler);
	},

	onLog: (callback: (entry: LogEntry) => void) => {
		const handler = (_event: Electron.IpcRendererEvent, entry: LogEntry) => {
			callback(entry);
		};
		ipcRenderer.on(IPC.LOG, handler);
		return () => ipcRenderer.removeListener(IPC.LOG, handler);
	},

	onComplete: (
		callback: (data: {
			type: 'conversion' | 'upload';
			success: boolean;
			successCount?: number;
			errorCount?: number;
		}) => void,
	) => {
		const handler = (
			_event: Electron.IpcRendererEvent,
			data: {
				type: 'conversion' | 'upload';
				success: boolean;
				successCount?: number;
				errorCount?: number;
			},
		) => {
			callback(data);
		};
		ipcRenderer.on(IPC.COMPLETE, handler);
		return () => ipcRenderer.removeListener(IPC.COMPLETE, handler);
	},

	onError: (callback: (error: { message: string; details?: string }) => void) => {
		const handler = (
			_event: Electron.IpcRendererEvent,
			error: { message: string; details?: string },
		) => {
			callback(error);
		};
		ipcRenderer.on(IPC.ERROR, handler);
		return () => ipcRenderer.removeListener(IPC.ERROR, handler);
	},

	onFileUpdate: (callback: (files: TreeFile[]) => void) => {
		const handler = (_event: Electron.IpcRendererEvent, files: TreeFile[]) => {
			callback(files);
		};
		ipcRenderer.on(IPC.PROJECT_FILE_UPDATE, handler);
		return () => ipcRenderer.removeListener(IPC.PROJECT_FILE_UPDATE, handler);
	},

	onStatsUpdate: (callback: (stats: ProjectStats) => void) => {
		const handler = (_event: Electron.IpcRendererEvent, stats: ProjectStats) => {
			callback(stats);
		};
		ipcRenderer.on(IPC.PROJECT_STATS_UPDATE, handler);
		return () => ipcRenderer.removeListener(IPC.PROJECT_STATS_UPDATE, handler);
	},

	onTreeSync: (callback: (tree: TreeFile[]) => void) => {
		const handler = (_event: Electron.IpcRendererEvent, tree: TreeFile[]) => {
			callback(tree);
		};
		ipcRenderer.on(IPC.PROJECT_TREE_SYNC, handler);
		return () => ipcRenderer.removeListener(IPC.PROJECT_TREE_SYNC, handler);
	},

	// Copy text to clipboard
	copyToClipboard: (text: string): void => {
		clipboard.writeText(text);
	},

	// Get native file path from a File object (Electron 32+ replacement for File.path)
	getPathForFile: (file: File): string => {
		return webUtils.getPathForFile(file);
	},

	// Remove all listeners
	removeAllListeners: () => {
		ipcRenderer.removeAllListeners(IPC.PROGRESS);
		ipcRenderer.removeAllListeners(IPC.LOG);
		ipcRenderer.removeAllListeners(IPC.COMPLETE);
		ipcRenderer.removeAllListeners(IPC.ERROR);
		ipcRenderer.removeAllListeners(IPC.PROJECT_FILE_UPDATE);
		ipcRenderer.removeAllListeners(IPC.PROJECT_STATS_UPDATE);
		ipcRenderer.removeAllListeners(IPC.PROJECT_TREE_SYNC);
	},
};

// Expose to renderer
contextBridge.exposeInMainWorld('electronAPI', electronAPI);

// Type declaration for renderer
export type ElectronAPI = typeof electronAPI;
