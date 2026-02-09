/**
 * ProjectManager - Core main-process service for the directory browser.
 *
 * Loads a source directory, builds a hierarchical TreeFile[] tree,
 * reconciles each file's PipelineStatus by cross-referencing the output
 * directory (converted .md files) and upload manifest, and exposes
 * methods for refresh/convert/upload/retry.
 */
import { existsSync, readFileSync, readdirSync, statSync } from 'node:fs';
import { basename, extname, join, relative } from 'node:path';
import type { BrowserWindow } from 'electron';
import matter from 'gray-matter';
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

// Minimal interface for ManifestManager (loaded dynamically from scripts/cli/lib)
interface ManifestEntry {
	sourceHash: string;
	documentId: string;
	uploadedAt: string;
	markdownPath: string;
	chunksCreated?: number;
}

interface Manifest {
	getEntry(sourceHash: string): ManifestEntry | undefined;
}

interface OutputMapEntry {
	convertedPath: string;
	sourceHash: string;
}

/**
 * Dynamically load ManifestManager from the CLI lib.
 * esbuild bundles the require() at build time; this avoids
 * a static import that breaks tsc rootDir checks.
 */
function createManifest(outputDir: string): Manifest {
	// eslint-disable-next-line @typescript-eslint/no-require-imports
	const { ManifestManager } = require('../../../../scripts/cli/lib/manifest.js');
	return new ManifestManager(outputDir) as Manifest;
}

export class ProjectManager {
	/** Used by Phase 6 (file watching) to emit updates via webContents.send() */
	private window: BrowserWindow;
	private projectStore: ProjectStore;
	private sourceDir: string | null = null;
	private outputDir: string | null = null;
	private tree: TreeFile[] = [];
	private outputMap: Map<string, OutputMapEntry> = new Map();
	private manifest: Manifest | null = null;

	constructor(window: BrowserWindow) {
		this.window = window;
		this.projectStore = new ProjectStore();
	}

	// ---- Public API ----

	async loadProject(sourceDir: string, outputDir: string): Promise<ProjectState> {
		this.sourceDir = sourceDir;
		this.outputDir = outputDir;
		this.manifest = existsSync(outputDir) ? createManifest(outputDir) : null;

		this.tree = this.buildTree(sourceDir, sourceDir);
		this.reconcileStatus(this.tree);

		const stats = this.computeStats(this.tree);
		this.projectStore.setLastProject(sourceDir, outputDir);

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
		this.manifest = existsSync(this.outputDir) ? createManifest(this.outputDir) : null;

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
		this.sourceDir = null;
		this.outputDir = null;
		this.tree = [];
		this.outputMap = new Map();
		this.manifest = null;
	}

	// TODO: Phase 7
	async convertFiles(_relativePaths: string[]): Promise<void> {}

	// TODO: Phase 7
	async uploadConverted(): Promise<void> {}

	// TODO: Phase 7
	async retryErrors(_relativePaths: string[]): Promise<void> {}

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
					const dirStats = statSync(fullPath);
					const { sizeTier, sizeWarning } = classifyFileSize(dirStats.size, 'takeout');
					results.push({
						relativePath: relPath,
						name: entry.name,
						isDirectory: false,
						fileType: 'takeout',
						converterType: 'takeout',
						size: dirStats.size,
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
		// Try exact match on relative path
		const exact = this.outputMap.get(relativePath);
		if (exact) return exact;

		// Fall back to basename match (converters store varying path formats)
		const name = basename(relativePath);
		for (const [key, entry] of this.outputMap) {
			if (basename(key) === name) return entry;
		}

		return undefined;
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
