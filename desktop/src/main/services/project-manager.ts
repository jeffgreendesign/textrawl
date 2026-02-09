import { existsSync, readFileSync, readdirSync, statSync } from 'node:fs';
/**
 * ProjectManager - Core main-process service for the directory browser.
 *
 * Loads a source directory, builds a hierarchical TreeFile[] tree,
 * reconciles each file's PipelineStatus by cross-referencing the output
 * directory (converted .md files) and upload manifest, and exposes
 * methods for refresh/convert/upload/retry.
 *
 * Optimised for thousands of files:
 *  - Async tree building (fs/promises) to avoid blocking the main thread
 *  - Flat Map<string, TreeFile> index for O(1) node lookups
 *  - Incremental output-map updates (cached between reconciliations)
 *  - Dirty-set IPC: only changed nodes sent via PROJECT_FILE_UPDATE;
 *    full tree sync only for structural changes (add/remove)
 */
import { readFile, readdir, stat } from 'node:fs/promises';
import { basename, extname, join, relative, sep } from 'node:path';
import type { BrowserWindow } from 'electron';
import matter from 'gray-matter';
import { IPC } from '../../shared/ipc-channels.js';
import type {
	ConversionOptions,
	ProjectState,
	ProjectStats,
	ScannedFile,
	TreeFile,
	UploadOptions,
} from '../../shared/types.js';
import type { ConversionManager } from './conversion-manager.js';
import {
	classifyFileSize,
	getBundleContentSize,
	isAppleMailBundle,
	isDriveExportFolder,
	isRtfdBundle,
	routeFileByExt,
} from './file-router.js';
import { ProjectStore } from './project-store.js';
import type { SettingsStore } from './settings-store.js';
import type { UploadManager } from './upload-manager.js';

interface ManifestEntry {
	sourceHash: string;
	documentId: string;
	uploadedAt: string;
	markdownPath: string;
	chunksCreated?: number;
}

interface ManifestData {
	version: number;
	entries: Record<string, ManifestEntry>;
	updatedAt: string;
}

interface Manifest {
	getEntry(sourceHash: string): ManifestEntry | undefined;
}

interface OutputMapEntry {
	convertedPath: string;
	sourceHash: string;
}

/**
 * Lightweight read-only manifest reader.
 * Reads .manifest.json from the output directory and provides
 * entry lookups by source hash — no dependency on the CLI lib.
 */
class ManifestReader implements Manifest {
	private entries: Record<string, ManifestEntry> = {};

	constructor(outputDir: string) {
		const manifestPath = join(outputDir, '.manifest.json');
		try {
			const raw = readFileSync(manifestPath, 'utf-8');
			const data = JSON.parse(raw) as ManifestData;
			if (data.version === 1 && data.entries) {
				this.entries = data.entries;
			}
		} catch {
			// Missing or corrupt manifest — treat as empty
		}
	}

	getEntry(sourceHash: string): ManifestEntry | undefined {
		return this.entries[sourceHash];
	}
}

/**
 * Yield to the event loop so long-running async loops don't starve IPC/UI.
 */
function yieldToEventLoop(): Promise<void> {
	return new Promise((resolve) => setImmediate(resolve));
}

export class ProjectManager {
	private window: BrowserWindow;
	private projectStore: ProjectStore;
	private sourceDir: string | null = null;
	private outputDir: string | null = null;
	private tree: TreeFile[] = [];
	private outputMap: Map<string, OutputMapEntry> = new Map();
	private manifest: Manifest | null = null;

	/** Flat index: relativePath → TreeFile for O(1) lookups. */
	private nodeIndex: Map<string, TreeFile> = new Map();

	// File watching
	private watcher: { close(): Promise<void> } | null = null;
	private paused = false;
	private pendingFlush = false;
	/** Whether the pending flush requires a full tree sync (structural change). */
	private needsFullSync = false;
	/** Nodes whose status/fields changed since last flush. */
	private dirtyNodes: Set<string> = new Set();
	private updateTimer: ReturnType<typeof setTimeout> | null = null;

	constructor(
		window: BrowserWindow,
		private conversionManager: ConversionManager,
		private uploadManager: UploadManager,
		private settingsStore: SettingsStore,
	) {
		this.window = window;
		this.projectStore = new ProjectStore();
	}

	// ---- Public API ----

	async loadProject(sourceDir: string, outputDir: string): Promise<ProjectState> {
		this.sourceDir = sourceDir;
		this.outputDir = outputDir;
		this.manifest = existsSync(outputDir) ? new ManifestReader(outputDir) : null;

		this.tree = await this.buildTree(sourceDir, sourceDir);
		this.rebuildNodeIndex();
		await this.buildOutputMap();
		this.reconcileStatus(this.tree);

		const stats = this.computeStats(this.tree);
		this.projectStore.setLastProject(sourceDir, outputDir);

		await this.startWatching();

		return {
			sourceDir,
			outputDir,
			lastScanned: new Date().toISOString(),
			stats,
		};
	}

	getTree(): TreeFile[] {
		return this.tree;
	}

	async refresh(): Promise<ProjectState> {
		if (!this.sourceDir || !this.outputDir) {
			throw new Error('No project loaded');
		}

		// Reload manifest in case uploads happened externally
		this.manifest = existsSync(this.outputDir) ? new ManifestReader(this.outputDir) : null;
		await this.buildOutputMap();

		this.reconcileStatus(this.tree);
		const stats = this.computeStats(this.tree);

		return {
			sourceDir: this.sourceDir,
			outputDir: this.outputDir,
			lastScanned: new Date().toISOString(),
			stats,
		};
	}

	async unloadProject(): Promise<void> {
		await this.stopWatching();
		this.sourceDir = null;
		this.outputDir = null;
		this.tree = [];
		this.outputMap = new Map();
		this.nodeIndex = new Map();
		this.manifest = null;
	}

	async convertFiles(relativePaths: string[]): Promise<void> {
		if (!this.sourceDir || !this.outputDir) return;

		const files = this.findFiles(relativePaths);
		const convertible = files.filter(
			(f) => f.pipelineStatus === 'pending' && f.converterType !== null,
		);
		if (convertible.length === 0) return;

		const scannedFiles = convertible.map((f) => this.toScannedFile(f));
		const options: ConversionOptions = {
			outputDir: this.outputDir,
			tags: this.settingsStore.get().defaultTags,
			dryRun: false,
			verbose: false,
		};

		this.pauseWatching();
		try {
			await this.conversionManager.startConversion(scannedFiles, options);

			// Detect which files failed by checking for output .md files
			await this.buildOutputMap();
			for (const file of convertible) {
				if (!this.outputMap.has(file.relativePath)) {
					this.projectStore.setFileError(file.relativePath, 'Conversion failed');
				}
			}
		} finally {
			this.resumeWatching();
		}
	}

	async uploadConverted(): Promise<void> {
		if (!this.outputDir) return;

		const options: UploadOptions = {
			directory: this.outputDir,
			tags: this.settingsStore.get().defaultTags,
		};

		this.pauseWatching();
		try {
			await this.uploadManager.startUpload(options);
		} finally {
			this.resumeWatching();
		}
	}

	async retryErrors(relativePaths: string[]): Promise<void> {
		if (!this.sourceDir || !this.outputDir) return;

		for (const path of relativePaths) {
			this.projectStore.clearFileError(path);
		}

		// Re-reconcile to determine true status after clearing errors
		const files = this.findFiles(relativePaths);
		for (const file of files) {
			this.reconcileFile(file);
		}

		// Collect files that fell back to pending and need conversion
		const pendingPaths = files
			.filter((f) => f.pipelineStatus === 'pending')
			.map((f) => f.relativePath);

		if (pendingPaths.length > 0) {
			await this.convertFiles(pendingPaths);
		} else {
			this.scheduleFlush();
		}
	}

	/** Pause file watching during conversion/upload to avoid reacting to own writes. */
	pauseWatching(): void {
		this.paused = true;
	}

	/** Resume file watching after conversion/upload completes. Re-reconciles all files. */
	resumeWatching(): void {
		this.paused = false;
		if (this.outputDir && existsSync(this.outputDir)) {
			this.manifest = new ManifestReader(this.outputDir);
		}
		// Synchronous rebuild is acceptable here — output dir is typically small
		// relative to source, and this runs once after an explicit user action.
		this.buildOutputMapSync();
		this.reconcileStatus(this.tree);
		this.scheduleFlush(true);
	}

	// ---- Private: node index ----

	private rebuildNodeIndex(): void {
		this.nodeIndex = new Map();
		const walk = (nodes: TreeFile[]): void => {
			for (const node of nodes) {
				this.nodeIndex.set(node.relativePath, node);
				if (node.isDirectory && node.children) {
					walk(node.children);
				}
			}
		};
		walk(this.tree);
	}

	private indexNode(node: TreeFile): void {
		this.nodeIndex.set(node.relativePath, node);
	}

	private unindexNode(node: TreeFile): void {
		this.nodeIndex.delete(node.relativePath);
		if (node.isDirectory && node.children) {
			for (const child of node.children) {
				this.unindexNode(child);
			}
		}
	}

	// ---- Private: file watching ----

	private async startWatching(): Promise<void> {
		if (!this.sourceDir || !this.outputDir) return;

		const chokidar = await import('chokidar');
		const sourceDir = this.sourceDir;
		const outputDir = this.outputDir;

		const watcher = chokidar.watch([sourceDir, outputDir], {
			followSymlinks: false,
			ignored: (filePath: string) => {
				const name = basename(filePath);
				if (name === 'node_modules') return true;
				// Allow the watched roots themselves
				if (filePath === sourceDir || filePath === outputDir) return false;
				// Allow .manifest.json in output dir (gets special handling)
				if (name === '.manifest.json') return false;
				// Ignore other dotfiles
				return name.startsWith('.');
			},
			depth: 20,
			ignoreInitial: true,
			persistent: true,
			awaitWriteFinish: {
				stabilityThreshold: 2000,
				pollInterval: 100,
			},
		});

		watcher
			.on('add', (filePath: string) => this.handleAdd(filePath))
			.on('change', (filePath: string) => this.handleChange(filePath))
			.on('unlink', (filePath: string) => this.handleUnlink(filePath))
			.on('addDir', (filePath: string) => this.handleAddDir(filePath))
			.on('unlinkDir', (filePath: string) => this.handleUnlinkDir(filePath))
			.on('error', (err: unknown) => {
				console.error('[project-manager] Watcher error:', err);
			});

		this.watcher = watcher;
	}

	private async stopWatching(): Promise<void> {
		if (this.updateTimer) {
			clearTimeout(this.updateTimer);
			this.updateTimer = null;
		}
		this.pendingFlush = false;
		this.dirtyNodes.clear();
		this.needsFullSync = false;

		try {
			await this.watcher?.close();
		} catch (err) {
			console.error('[project-manager] Error closing watcher:', err);
		}
		this.watcher = null;
	}

	// ---- Private: watcher event handlers ----

	private handleAdd(absolutePath: string): void {
		if (this.paused || !this.sourceDir || !this.outputDir) return;

		if (absolutePath.startsWith(this.sourceDir + sep)) {
			this.handleSourceAdd(absolutePath);
		} else if (absolutePath.startsWith(this.outputDir + sep)) {
			this.handleOutputAdd(absolutePath);
		}
	}

	private handleChange(absolutePath: string): void {
		if (this.paused || !this.sourceDir || !this.outputDir) return;

		if (absolutePath.startsWith(this.sourceDir + sep)) {
			this.handleSourceChange(absolutePath);
		} else if (absolutePath.startsWith(this.outputDir + sep)) {
			this.handleOutputChange(absolutePath);
		}
	}

	private handleUnlink(absolutePath: string): void {
		if (this.paused || !this.sourceDir || !this.outputDir) return;

		if (absolutePath.startsWith(this.sourceDir + sep)) {
			this.handleSourceUnlink(absolutePath);
		} else if (absolutePath.startsWith(this.outputDir + sep)) {
			this.handleOutputUnlink(absolutePath);
		}
	}

	private handleAddDir(absolutePath: string): void {
		if (this.paused || !this.sourceDir) return;

		if (!absolutePath.startsWith(this.sourceDir + sep)) return;

		const relPath = relative(this.sourceDir, absolutePath);
		const dirName = basename(absolutePath);
		const ext = extname(dirName).toLowerCase();

		// Check for bundle types (same logic as buildTree)
		if (ext === '.mbox' && isAppleMailBundle(absolutePath)) {
			const contentSize = getBundleContentSize(absolutePath, 'mbox-bundle');
			const { sizeTier, sizeWarning } = classifyFileSize(contentSize, 'mbox-bundle');
			const node: TreeFile = {
				relativePath: relPath,
				name: dirName,
				isDirectory: false,
				fileType: 'mbox-bundle',
				converterType: 'mbox',
				size: contentSize,
				sizeTier,
				sizeWarning,
				pipelineStatus: 'pending',
			};
			this.reconcileFile(node);
			this.insertIntoTree(relPath, node);
			this.scheduleFlush(true);
			return;
		}

		if (isRtfdBundle(absolutePath)) {
			const contentSize = getBundleContentSize(absolutePath, 'rtfd');
			const { sizeTier, sizeWarning } = classifyFileSize(contentSize, 'rtfd');
			const node: TreeFile = {
				relativePath: relPath,
				name: dirName,
				isDirectory: false,
				fileType: 'rtfd',
				converterType: 'processor',
				size: contentSize,
				sizeTier,
				sizeWarning,
				pipelineStatus: 'pending',
			};
			this.reconcileFile(node);
			this.insertIntoTree(relPath, node);
			this.scheduleFlush(true);
			return;
		}

		if (isDriveExportFolder(absolutePath, dirName)) {
			let dirSize = 0;
			try {
				dirSize = getBundleContentSize(absolutePath, 'takeout');
			} catch {
				return;
			}
			const { sizeTier, sizeWarning } = classifyFileSize(dirSize, 'takeout');
			const node: TreeFile = {
				relativePath: relPath,
				name: dirName,
				isDirectory: false,
				fileType: 'takeout',
				converterType: 'takeout',
				size: dirSize,
				sizeTier,
				sizeWarning,
				pipelineStatus: 'pending',
			};
			this.reconcileFile(node);
			this.insertIntoTree(relPath, node);
			this.scheduleFlush(true);
			return;
		}

		// Regular directory — no-op. Children arrive via 'add' events,
		// and insertIntoTree creates intermediate directory nodes as needed.
	}

	private handleUnlinkDir(absolutePath: string): void {
		if (this.paused || !this.sourceDir) return;

		if (!absolutePath.startsWith(this.sourceDir + sep)) return;

		const relPath = relative(this.sourceDir, absolutePath);
		this.removeFromTree(this.tree, relPath);
		this.scheduleFlush(true);
	}

	private handleSourceAdd(absolutePath: string): void {
		if (!this.sourceDir) return;

		const relPath = relative(this.sourceDir, absolutePath);
		const { type, converterType } = routeFileByExt(absolutePath);

		let size: number;
		try {
			size = statSync(absolutePath).size;
		} catch {
			return; // File may have been deleted already
		}

		const { sizeTier, sizeWarning } = classifyFileSize(size, type);

		const node: TreeFile = {
			relativePath: relPath,
			name: basename(absolutePath),
			isDirectory: false,
			fileType: type,
			converterType,
			size,
			sizeTier,
			sizeWarning,
			pipelineStatus: 'pending',
		};

		this.reconcileFile(node);
		this.insertIntoTree(relPath, node);
		this.scheduleFlush(true);
	}

	private handleSourceChange(absolutePath: string): void {
		if (!this.sourceDir) return;

		const relPath = relative(this.sourceDir, absolutePath);
		const node = this.nodeIndex.get(relPath);
		if (!node || node.isDirectory) return;

		let newSize: number;
		try {
			newSize = statSync(absolutePath).size;
		} catch {
			return;
		}

		const { sizeTier, sizeWarning } = classifyFileSize(newSize, node.fileType);
		node.size = newSize;
		node.sizeTier = sizeTier;
		node.sizeWarning = sizeWarning;

		// Source content changed — conversion output is stale
		if (node.pipelineStatus === 'converted' || node.pipelineStatus === 'uploaded') {
			node.pipelineStatus = 'pending';
			node.convertedPath = undefined;
			node.documentId = undefined;
			node.uploadedAt = undefined;
		}

		this.reconcileFile(node);
		this.dirtyNodes.add(relPath);
		this.scheduleFlush();
	}

	private handleSourceUnlink(absolutePath: string): void {
		if (!this.sourceDir) return;

		const relPath = relative(this.sourceDir, absolutePath);
		this.removeFromTree(this.tree, relPath);
		this.scheduleFlush(true);
	}

	private handleOutputAdd(absolutePath: string): void {
		if (!this.outputDir) return;

		const filename = basename(absolutePath);
		if (extname(filename).toLowerCase() !== '.md') return;

		try {
			const raw = readFileSync(absolutePath, 'utf-8');
			const { data } = matter(raw);
			const sourceFile = data.source_file;
			const sourceHash = data.source_hash;

			if (typeof sourceFile === 'string' && typeof sourceHash === 'string') {
				this.outputMap.set(sourceFile, { convertedPath: filename, sourceHash });

				const node = this.nodeIndex.get(sourceFile);
				if (node) {
					this.reconcileFile(node);
					this.dirtyNodes.add(sourceFile);
					this.scheduleFlush();
				}
			}
		} catch {
			// Skip files that can't be parsed
		}
	}

	private handleOutputChange(absolutePath: string): void {
		if (!this.outputDir) return;

		const filename = basename(absolutePath);

		if (filename === '.manifest.json') {
			// Manifest updated — reload and re-reconcile all files
			this.manifest = new ManifestReader(this.outputDir);
			this.reconcileStatus(this.tree);
			this.scheduleFlush(true);
			return;
		}

		// A .md file changed — re-parse frontmatter
		if (extname(filename).toLowerCase() === '.md') {
			this.handleOutputAdd(absolutePath);
		}
	}

	private handleOutputUnlink(absolutePath: string): void {
		if (!this.outputDir) return;

		const filename = basename(absolutePath);
		if (extname(filename).toLowerCase() !== '.md') return;

		for (const [sourceFile, entry] of this.outputMap.entries()) {
			if (entry.convertedPath === filename) {
				this.outputMap.delete(sourceFile);
				const node = this.nodeIndex.get(sourceFile);
				if (node) {
					this.reconcileFile(node);
					this.dirtyNodes.add(sourceFile);
					this.scheduleFlush();
				}
				break;
			}
		}
	}

	// ---- Private: tree mutation helpers ----

	/** Bulk tree lookup — collects non-directory nodes matching any of the given paths. */
	private findFiles(relativePaths: string[]): TreeFile[] {
		const results: TreeFile[] = [];
		for (const p of relativePaths) {
			const node = this.nodeIndex.get(p);
			if (node && !node.isDirectory) {
				results.push(node);
			}
		}
		return results;
	}

	/** Map a TreeFile to a ScannedFile for ConversionManager. */
	private toScannedFile(file: TreeFile): ScannedFile {
		return {
			id: file.relativePath,
			path: join(this.sourceDir!, file.relativePath),
			name: file.name,
			type: file.fileType,
			converterType: file.converterType,
			size: file.size,
			isDirectory: file.isDirectory,
			sizeTier: file.sizeTier,
			sizeWarning: file.sizeWarning,
		};
	}

	private insertIntoTree(relativePath: string, node: TreeFile): void {
		const segments = relativePath.split(sep);

		if (segments.length === 1) {
			const idx = this.tree.findIndex((n) => n.relativePath === relativePath);
			if (idx >= 0) {
				this.unindexNode(this.tree[idx]);
				this.tree[idx] = node;
			} else {
				this.tree.push(node);
			}
			this.indexNode(node);
			return;
		}

		// Walk/create intermediate directory nodes
		let currentLevel = this.tree;
		for (let i = 0; i < segments.length - 1; i++) {
			const dirRelPath = segments.slice(0, i + 1).join(sep);
			let dirNode = currentLevel.find((n) => n.relativePath === dirRelPath && n.isDirectory);

			if (!dirNode) {
				dirNode = {
					relativePath: dirRelPath,
					name: segments[i],
					isDirectory: true,
					fileType: 'unknown',
					converterType: null,
					size: 0,
					sizeTier: 'normal',
					pipelineStatus: 'pending',
					children: [],
				};
				currentLevel.push(dirNode);
				this.indexNode(dirNode);
			}

			if (!dirNode.children) dirNode.children = [];
			currentLevel = dirNode.children;
		}

		const idx = currentLevel.findIndex((n) => n.relativePath === relativePath);
		if (idx >= 0) {
			this.unindexNode(currentLevel[idx]);
			currentLevel[idx] = node;
		} else {
			currentLevel.push(node);
		}
		this.indexNode(node);
	}

	private removeFromTree(nodes: TreeFile[], targetPath: string): boolean {
		for (let i = nodes.length - 1; i >= 0; i--) {
			const node = nodes[i];
			if (node.relativePath === targetPath) {
				this.unindexNode(node);
				nodes.splice(i, 1);
				return true;
			}
			if (node.isDirectory && node.children) {
				const removed = this.removeFromTree(node.children, targetPath);
				if (removed) {
					// Prune empty directory (matches buildTree behavior)
					if (node.children.length === 0) {
						this.unindexNode(node);
						nodes.splice(i, 1);
					}
					return true;
				}
			}
		}
		return false;
	}

	// ---- Private: debouncing + IPC emit ----

	private scheduleFlush(structural = false): void {
		this.pendingFlush = true;
		if (structural) this.needsFullSync = true;
		if (!this.updateTimer) {
			this.updateTimer = setTimeout(() => this.flushUpdates(), 200);
		}
	}

	private flushUpdates(): void {
		this.updateTimer = null;
		if (!this.pendingFlush) return;
		this.pendingFlush = false;

		const stats = this.computeStats(this.tree);

		if (this.needsFullSync) {
			// Structural change (add/remove) — send full tree
			this.emitToRenderer(IPC.PROJECT_TREE_SYNC, this.tree);
			this.needsFullSync = false;
		} else if (this.dirtyNodes.size > 0) {
			// Status-only changes — send just the changed nodes
			const updates: TreeFile[] = [];
			for (const relPath of this.dirtyNodes) {
				const node = this.nodeIndex.get(relPath);
				if (node) updates.push(node);
			}
			if (updates.length > 0) {
				this.emitToRenderer(IPC.PROJECT_FILE_UPDATE, updates);
			}
		}

		this.dirtyNodes.clear();
		this.emitToRenderer(IPC.PROJECT_STATS_UPDATE, stats);
	}

	private emitToRenderer(channel: string, data: unknown): void {
		if (!this.window.isDestroyed()) {
			this.window.webContents.send(channel, data);
		}
	}

	// ---- Private: tree building (async) ----

	private async buildTree(dir: string, baseDir: string): Promise<TreeFile[]> {
		const results: TreeFile[] = [];

		let entries: Awaited<ReturnType<typeof readdir>>;
		try {
			entries = await readdir(dir, { withFileTypes: true });
		} catch (err) {
			console.error(`[project-manager] Failed to read directory ${dir}:`, err);
			return results;
		}

		// Yield periodically to keep the main thread responsive
		let processed = 0;

		for (const entry of entries) {
			// Skip dotfiles and node_modules
			if (entry.name.startsWith('.') || entry.name === 'node_modules') {
				continue;
			}

			const fullPath = join(dir, entry.name);
			const relPath = relative(baseDir, fullPath);

			if (entry.isDirectory()) {
				const ext = extname(entry.name).toLowerCase();

				// Apple Mail .mbox bundle
				if (ext === '.mbox' && isAppleMailBundle(fullPath)) {
					const contentSize = getBundleContentSize(fullPath, 'mbox-bundle');
					const { sizeTier, sizeWarning } = classifyFileSize(contentSize, 'mbox-bundle');
					results.push({
						relativePath: relPath,
						name: entry.name,
						isDirectory: false, // treated as leaf
						fileType: 'mbox-bundle',
						converterType: 'mbox',
						size: contentSize,
						sizeTier,
						sizeWarning,
						pipelineStatus: 'pending',
					});
					continue;
				}

				// macOS RTFD bundle
				if (isRtfdBundle(fullPath)) {
					const contentSize = getBundleContentSize(fullPath, 'rtfd');
					const { sizeTier, sizeWarning } = classifyFileSize(contentSize, 'rtfd');
					results.push({
						relativePath: relPath,
						name: entry.name,
						isDirectory: false,
						fileType: 'rtfd',
						converterType: 'processor',
						size: contentSize,
						sizeTier,
						sizeWarning,
						pipelineStatus: 'pending',
					});
					continue;
				}

				// Google Drive export folder
				if (isDriveExportFolder(fullPath, entry.name)) {
					const contentSize = getBundleContentSize(fullPath, 'takeout');
					const { sizeTier, sizeWarning } = classifyFileSize(contentSize, 'takeout');
					results.push({
						relativePath: relPath,
						name: entry.name,
						isDirectory: false,
						fileType: 'takeout',
						converterType: 'takeout',
						size: contentSize,
						sizeTier,
						sizeWarning,
						pipelineStatus: 'pending',
					});
					continue;
				}

				// Regular directory — recurse
				const children = await this.buildTree(fullPath, baseDir);
				if (children.length > 0) {
					results.push({
						relativePath: relPath,
						name: entry.name,
						isDirectory: true,
						fileType: 'unknown',
						converterType: null,
						size: 0,
						sizeTier: 'normal',
						pipelineStatus: 'pending',
						children,
					});
				}
			} else {
				// Regular file — route by extension (no extra stat call)
				const { type, converterType } = routeFileByExt(fullPath);
				let fileSize: number;
				try {
					const fileStat = await stat(fullPath);
					fileSize = fileStat.size;
				} catch {
					continue; // File may have been deleted
				}
				const { sizeTier, sizeWarning } = classifyFileSize(fileSize, type);

				results.push({
					relativePath: relPath,
					name: entry.name,
					isDirectory: false,
					fileType: type,
					converterType,
					size: fileSize,
					sizeTier,
					sizeWarning,
					pipelineStatus: 'pending',
				});
			}

			processed++;
			if (processed % 100 === 0) {
				await yieldToEventLoop();
			}
		}

		return results;
	}

	// ---- Private: output map (async for initial load, sync for resume) ----

	private async buildOutputMap(): Promise<void> {
		this.outputMap = new Map();

		if (!this.outputDir || !existsSync(this.outputDir)) {
			return;
		}

		let dirEntries: string[];
		try {
			const direntries = await readdir(this.outputDir);
			dirEntries = direntries as string[];
		} catch {
			console.error(`[project-manager] Failed to read output directory: ${this.outputDir}`);
			return;
		}

		let processed = 0;
		for (const filename of dirEntries) {
			if (extname(filename).toLowerCase() !== '.md') {
				continue;
			}

			const fullPath = join(this.outputDir, filename);
			try {
				const raw = await readFile(fullPath, 'utf-8');
				const { data } = matter(raw);

				const sourceFile = data.source_file;
				const sourceHash = data.source_hash;
				if (typeof sourceFile === 'string' && typeof sourceHash === 'string') {
					this.outputMap.set(sourceFile, {
						convertedPath: filename,
						sourceHash,
					});
				}
			} catch {
				// Skip files that can't be parsed
			}

			processed++;
			if (processed % 50 === 0) {
				await yieldToEventLoop();
			}
		}
	}

	/** Synchronous variant for resumeWatching — output dir is typically small. */
	private buildOutputMapSync(): void {
		this.outputMap = new Map();

		if (!this.outputDir || !existsSync(this.outputDir)) {
			return;
		}

		let dirEntries: string[];
		try {
			dirEntries = readdirSync(this.outputDir) as string[];
		} catch {
			console.error(`[project-manager] Failed to read output directory: ${this.outputDir}`);
			return;
		}

		for (const filename of dirEntries) {
			if (extname(filename).toLowerCase() !== '.md') {
				continue;
			}

			const fullPath = join(this.outputDir, filename);
			try {
				const raw = readFileSync(fullPath, 'utf-8');
				const { data } = matter(raw);

				const sourceFile = data.source_file;
				const sourceHash = data.source_hash;
				if (typeof sourceFile === 'string' && typeof sourceHash === 'string') {
					this.outputMap.set(sourceFile, {
						convertedPath: filename,
						sourceHash,
					});
				}
			} catch {
				// Skip files that can't be parsed
			}
		}
	}

	// ---- Private: status reconciliation ----

	private reconcileStatus(tree: TreeFile[]): void {
		for (const node of tree) {
			if (node.isDirectory && node.children) {
				this.reconcileStatus(node.children);
				continue;
			}

			this.reconcileFile(node);
		}
	}

	private reconcileFile(file: TreeFile): void {
		// Reset optional fields before reconciling
		file.convertedPath = undefined;
		file.documentId = undefined;
		file.uploadedAt = undefined;
		file.error = undefined;
		file.lastProcessed = undefined;

		// 1. Error (highest priority)
		const fileError = this.projectStore.getFileError(file.relativePath);
		if (fileError) {
			file.pipelineStatus = 'error';
			file.error = fileError.error;
			file.lastProcessed = fileError.lastAttempt;
			return;
		}

		// 2-3. Check output map for converted/uploaded
		const outputEntry = this.outputMap.get(file.relativePath);
		if (outputEntry) {
			file.convertedPath = outputEntry.convertedPath;

			// 2. Uploaded (check manifest)
			if (this.manifest) {
				const manifestEntry = this.manifest.getEntry(outputEntry.sourceHash);
				if (manifestEntry) {
					file.pipelineStatus = 'uploaded';
					file.documentId = manifestEntry.documentId;
					file.uploadedAt = manifestEntry.uploadedAt;
					return;
				}
			}

			// 3. Converted but not uploaded
			file.pipelineStatus = 'converted';
			return;
		}

		// 4. Oversized
		if (file.sizeTier === 'large') {
			file.pipelineStatus = 'oversized';
			return;
		}

		// 5. Unsupported
		if (file.converterType === null && file.fileType === 'unknown') {
			file.pipelineStatus = 'unsupported';
			return;
		}

		// 6. Default
		file.pipelineStatus = 'pending';
	}

	// ---- Private: stats ----

	private computeStats(tree: TreeFile[]): ProjectStats {
		const stats: ProjectStats = {
			total: 0,
			pending: 0,
			converted: 0,
			uploaded: 0,
			errors: 0,
			oversized: 0,
			unsupported: 0,
		};

		this.accumulateStats(tree, stats);
		return stats;
	}

	private accumulateStats(tree: TreeFile[], stats: ProjectStats): void {
		for (const node of tree) {
			if (node.isDirectory && node.children) {
				this.accumulateStats(node.children, stats);
				continue;
			}

			stats.total++;

			switch (node.pipelineStatus) {
				case 'pending':
				case 'converting': // transient — count as pending
					stats.pending++;
					break;
				case 'converted':
					stats.converted++;
					break;
				case 'uploading': // transient — count as converted
					stats.converted++;
					break;
				case 'uploaded':
					stats.uploaded++;
					break;
				case 'error':
					stats.errors++;
					break;
				case 'oversized':
					stats.oversized++;
					break;
				case 'unsupported':
					stats.unsupported++;
					break;
			}
		}
	}
}
