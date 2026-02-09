/**
 * ProjectManager - Core main-process service for the directory browser.
 *
 * Loads a source directory, builds a hierarchical TreeFile[] tree,
 * reconciles each file's PipelineStatus by cross-referencing the output
 * directory (converted .md files) and upload manifest, and exposes
 * methods for refresh/convert/upload/retry.
 */
import { existsSync, readFileSync, readdirSync, statSync } from 'node:fs';
import { basename, extname, join, relative, sep } from 'node:path';
import type { BrowserWindow } from 'electron';
import matter from 'gray-matter';
import { IPC } from '../../shared/ipc-channels.js';
import type { ProjectState, ProjectStats, TreeFile } from '../../shared/types.js';
import {
	classifyFileSize,
	getBundleContentSize,
	isAppleMailBundle,
	isDriveExportFolder,
	isRtfdBundle,
	routeFile,
} from './file-router.js';
import { ProjectStore } from './project-store.js';

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

export class ProjectManager {
	private window: BrowserWindow;
	private projectStore: ProjectStore;
	private sourceDir: string | null = null;
	private outputDir: string | null = null;
	private tree: TreeFile[] = [];
	private outputMap: Map<string, OutputMapEntry> = new Map();
	private manifest: Manifest | null = null;

	// File watching
	private watcher: { close(): Promise<void> } | null = null;
	private paused = false;
	private pendingFlush = false;
	private updateTimer: ReturnType<typeof setTimeout> | null = null;

	constructor(window: BrowserWindow) {
		this.window = window;
		this.projectStore = new ProjectStore();
	}

	// ---- Public API ----

	async loadProject(sourceDir: string, outputDir: string): Promise<ProjectState> {
		this.sourceDir = sourceDir;
		this.outputDir = outputDir;
		this.manifest = existsSync(outputDir) ? new ManifestReader(outputDir) : null;

		this.tree = this.buildTree(sourceDir, sourceDir);
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
		this.manifest = null;
	}

	// TODO: Phase 7
	async convertFiles(relativePaths: string[]): Promise<void> {
		void relativePaths;
	}

	// TODO: Phase 7
	async uploadConverted(): Promise<void> {}

	// TODO: Phase 7
	async retryErrors(relativePaths: string[]): Promise<void> {
		void relativePaths;
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
		this.buildOutputMap();
		this.reconcileStatus(this.tree);
		this.scheduleFlush();
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
			.on('error', (err: Error) => {
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
			this.scheduleFlush();
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
			this.scheduleFlush();
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
			this.scheduleFlush();
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
		this.scheduleFlush();
	}

	private handleSourceAdd(absolutePath: string): void {
		if (!this.sourceDir) return;

		const relPath = relative(this.sourceDir, absolutePath);
		const { type, converterType } = routeFile(absolutePath);

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
		this.scheduleFlush();
	}

	private handleSourceChange(absolutePath: string): void {
		if (!this.sourceDir) return;

		const relPath = relative(this.sourceDir, absolutePath);
		const node = this.findNode(this.tree, relPath);
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
		this.scheduleFlush();
	}

	private handleSourceUnlink(absolutePath: string): void {
		if (!this.sourceDir) return;

		const relPath = relative(this.sourceDir, absolutePath);
		this.removeFromTree(this.tree, relPath);
		this.scheduleFlush();
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

				const node = this.findNode(this.tree, sourceFile);
				if (node) {
					this.reconcileFile(node);
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
			this.scheduleFlush();
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
				const node = this.findNode(this.tree, sourceFile);
				if (node) {
					this.reconcileFile(node);
					this.scheduleFlush();
				}
				break;
			}
		}
	}

	// ---- Private: tree mutation helpers ----

	private findNode(nodes: TreeFile[], relativePath: string): TreeFile | null {
		for (const node of nodes) {
			if (node.relativePath === relativePath) return node;
			if (node.isDirectory && node.children) {
				const found = this.findNode(node.children, relativePath);
				if (found) return found;
			}
		}
		return null;
	}

	private insertIntoTree(relativePath: string, node: TreeFile): void {
		const segments = relativePath.split(sep);

		if (segments.length === 1) {
			const idx = this.tree.findIndex((n) => n.relativePath === relativePath);
			if (idx >= 0) {
				this.tree[idx] = node;
			} else {
				this.tree.push(node);
			}
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
			}

			if (!dirNode.children) dirNode.children = [];
			currentLevel = dirNode.children;
		}

		const idx = currentLevel.findIndex((n) => n.relativePath === relativePath);
		if (idx >= 0) {
			currentLevel[idx] = node;
		} else {
			currentLevel.push(node);
		}
	}

	private removeFromTree(nodes: TreeFile[], targetPath: string): boolean {
		for (let i = nodes.length - 1; i >= 0; i--) {
			const node = nodes[i];
			if (node.relativePath === targetPath) {
				nodes.splice(i, 1);
				return true;
			}
			if (node.isDirectory && node.children) {
				const removed = this.removeFromTree(node.children, targetPath);
				if (removed) {
					// Prune empty directory (matches buildTree behavior)
					if (node.children.length === 0) {
						nodes.splice(i, 1);
					}
					return true;
				}
			}
		}
		return false;
	}

	// ---- Private: debouncing + IPC emit ----

	private scheduleFlush(): void {
		this.pendingFlush = true;
		if (!this.updateTimer) {
			this.updateTimer = setTimeout(() => this.flushUpdates(), 200);
		}
	}

	private flushUpdates(): void {
		this.updateTimer = null;
		if (!this.pendingFlush) return;
		this.pendingFlush = false;

		this.emitToRenderer(IPC.PROJECT_TREE_SYNC, this.tree);
		this.emitToRenderer(IPC.PROJECT_STATS_UPDATE, this.computeStats(this.tree));
	}

	private emitToRenderer(channel: string, data: unknown): void {
		if (!this.window.isDestroyed()) {
			this.window.webContents.send(channel, data);
		}
	}

	// ---- Private: tree building ----

	private buildTree(dir: string, baseDir: string): TreeFile[] {
		const results: TreeFile[] = [];

		let entries: ReturnType<typeof readdirSync>;
		try {
			entries = readdirSync(dir, { withFileTypes: true });
		} catch (err) {
			console.error(`[project-manager] Failed to read directory ${dir}:`, err);
			return results;
		}

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
				const children = this.buildTree(fullPath, baseDir);
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
				// Regular file — include ALL files (even unknown)
				const { type, converterType } = routeFile(fullPath);
				const fileStats = statSync(fullPath);
				const { sizeTier, sizeWarning } = classifyFileSize(fileStats.size, type);

				results.push({
					relativePath: relPath,
					name: entry.name,
					isDirectory: false,
					fileType: type,
					converterType,
					size: fileStats.size,
					sizeTier,
					sizeWarning,
					pipelineStatus: 'pending',
				});
			}
		}

		return results;
	}

	// ---- Private: status reconciliation ----

	private reconcileStatus(tree: TreeFile[]): void {
		this.buildOutputMap();

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
		const outputEntry = this.findOutputEntry(file.relativePath);
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

	private findOutputEntry(relativePath: string): OutputMapEntry | undefined {
		return this.outputMap.get(relativePath);
	}

	private buildOutputMap(): void {
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
