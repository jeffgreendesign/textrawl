/**
 * Conversion Manager - Coordinate file conversions
 *
 * Uses runCliScript() for subprocess lifecycle (FD cleanup, abort, timeout).
 * In-process document conversion uses processDocument() directly.
 */
import type { BrowserWindow } from 'electron';
import pLimit from 'p-limit';
import { IPC } from '../../shared/ipc-channels.js';
import type {
	ConversionOptions,
	FileProgress,
	LogEntry,
	OverallProgress,
	ScannedFile,
} from '../../shared/types.js';
import { runCliScript } from '../utils/run-cli-script.js';
import { processDocument } from './document-processor.js';
import { getMboxPathFromBundle } from './file-router.js';

export class ConversionManager {
	private window: BrowserWindow;
	private isRunning = false;
	private shouldCancel = false;
	private abortController: AbortController | null = null;
	private totalFiles = 0;
	private completedFiles = 0;
	private errorCount = 0;
	private startedAt = 0;
	private fileErrors = new Map<string, string>();

	constructor(window: BrowserWindow) {
		this.window = window;
	}

	/**
	 * Start conversion of multiple files
	 */
	async startConversion(
		files: ScannedFile[],
		options: ConversionOptions,
	): Promise<{ success: boolean; error?: string; fileErrors?: Map<string, string> }> {
		if (this.isRunning) {
			return { success: false, error: 'Conversion already in progress' };
		}

		// Validate batch size for in-process files to prevent memory exhaustion
		// CLI converter types (mbox, takeout, etc.) spawn subprocesses and don't load into memory
		const inProcessFiles = files.filter((f) => f.converterType === 'processor');
		const inProcessBytes = inProcessFiles.reduce((sum, f) => sum + f.size, 0);
		const inProcessMB = inProcessBytes / (1024 * 1024);

		if (inProcessMB > 100) {
			return {
				success: false,
				error: `In-process files total ${inProcessMB.toFixed(1)}MB (exceeds 100MB limit). Process fewer document files at once.`,
			};
		}

		this.isRunning = true;
		this.shouldCancel = false;
		this.abortController = new AbortController();
		this.totalFiles = files.length;
		this.completedFiles = 0;
		this.errorCount = 0;
		this.startedAt = Date.now();
		this.fileErrors = new Map();

		// Concurrency limit
		const limit = pLimit(3);

		this.sendOverallProgress();

		try {
			const promises = files.map((file) =>
				limit(async () => {
					if (this.shouldCancel) return;
					await this.convertFile(file, options);
				}),
			);

			await Promise.all(promises);

			// Send completion - success if at least one file converted
			const successCount = this.completedFiles - this.errorCount;

			// Log a summary so successes are counted but not individually listed
			if (successCount > 0) {
				this.sendLog('info', `Converted ${successCount} file(s) successfully`);
			}

			this.emitToRenderer(IPC.COMPLETE, {
				type: 'conversion',
				success: successCount > 0,
				successCount,
				errorCount: this.errorCount,
			});

			return { success: true, fileErrors: this.fileErrors };
		} catch (error) {
			return {
				success: false,
				error: error instanceof Error ? error.message : String(error),
				fileErrors: this.fileErrors,
			};
		} finally {
			this.isRunning = false;
			this.abortController = null;
		}
	}

	/**
	 * Cancel ongoing conversion — kills running child processes
	 */
	cancel(): void {
		this.shouldCancel = true;
		this.abortController?.abort();
	}

	/**
	 * Convert a single file
	 */
	private async convertFile(file: ScannedFile, options: ConversionOptions): Promise<void> {
		// Send initial progress
		this.sendFileProgress({
			fileId: file.id,
			fileName: file.name,
			status: 'processing',
			progress: 0,
			message: 'Starting...',
		});

		try {
			if (file.converterType === 'processor') {
				// Use document processor directly
				await this.runDocumentProcessor(file, options);
			} else if (file.converterType) {
				// Use CLI converter via subprocess
				await this.runCliConverter(file, options);
			} else {
				this.sendFileProgress({
					fileId: file.id,
					fileName: file.name,
					status: 'skipped',
					progress: 100,
					message: 'Unsupported file type',
				});
			}

			this.completedFiles++;
			this.sendOverallProgress();
		} catch (error) {
			this.errorCount++;
			this.completedFiles++;
			const errorMsg = error instanceof Error ? error.message : String(error);
			this.fileErrors.set(file.id, errorMsg);
			this.sendFileProgress({
				fileId: file.id,
				fileName: file.name,
				status: 'error',
				progress: 0,
				error: errorMsg,
			});
			// Log the actual error so it appears in the log viewer
			this.sendLog(
				'error',
				`Failed: ${file.name} — ${this.summarizeError(errorMsg)}`,
				errorMsg,
				file.id,
			);
			this.sendOverallProgress();
		}
	}

	/**
	 * Run document processor for supported file types
	 */
	private async runDocumentProcessor(file: ScannedFile, options: ConversionOptions): Promise<void> {
		this.sendLog('info', `Processing ${file.name}...`, undefined, file.id);

		const result = await processDocument(file.path, file.type, {
			outputDir: options.outputDir,
			tags: options.tags,
			dryRun: options.dryRun,
			sourceIdentifier: file.id !== file.path ? file.id : undefined,
		});

		if (result.success) {
			this.sendFileProgress({
				fileId: file.id,
				fileName: file.name,
				status: 'complete',
				progress: 100,
				outputPath: result.outputPath,
				message: 'Converted successfully',
			});
			this.sendLog('debug', `Converted ${file.name}`, result.outputPath, file.id);
		} else {
			throw new Error(result.error || 'Unknown error');
		}
	}

	/**
	 * Run CLI converter via subprocess using shared runCliScript utility
	 */
	private async runCliConverter(file: ScannedFile, options: ConversionOptions): Promise<void> {
		const inputPath = file.type === 'mbox-bundle' ? getMboxPathFromBundle(file.path) : file.path;

		const args = [inputPath, '-o', options.outputDir];
		if (options.verbose) args.push('-v');
		if (options.dryRun) args.push('--dry-run');
		if (options.tags.length > 0) {
			args.push('-t', ...options.tags);
		}

		this.sendLog(
			'info',
			`Converting ${file.name} with ${file.converterType} converter...`,
			undefined,
			file.id,
		);

		let lastProgress = 0;
		let lastLoggedProgress = -10;

		await runCliScript({
			scriptPath: `scripts/cli/converters/${file.converterType}.ts`,
			args,
			label: 'Converter',
			mirrorStderr: true,
			signal: this.abortController?.signal,
			onProgress: ({ percent, current, total }) => {
				if (percent <= lastProgress) return;
				lastProgress = percent;

				let message = `${percent}%`;
				if (current !== null && total !== null) {
					message = `${current}/${total} items (${percent}%)`;
				}

				this.sendFileProgress({
					fileId: file.id,
					fileName: file.name,
					status: 'processing',
					progress: percent,
					message,
				});

				// Log progress milestones (every 10%)
				if (percent >= lastLoggedProgress + 10) {
					lastLoggedProgress = Math.floor(percent / 10) * 10;
					const logMsg =
						current !== null && total !== null
							? `Processing ${file.name}: ${current}/${total} (${percent}%)`
							: `Processing ${file.name}: ${percent}%`;
					this.sendLog('info', logMsg, undefined, file.id);
				}
			},
			onOutput: ({ text }) => {
				this.sendLog('debug', text, undefined, file.id);
			},
		});

		// Only reached on exit code 0
		this.sendFileProgress({
			fileId: file.id,
			fileName: file.name,
			status: 'complete',
			progress: 100,
			outputPath: options.outputDir,
			message: 'Converted successfully',
		});
		this.sendLog('debug', `Converted ${file.name}`, undefined, file.id);
	}

	/**
	 * Extract a short, readable reason from a converter error message.
	 */
	private summarizeError(msg: string): string {
		// CLI converter: "Converter exited with code N: <stderr tail>"
		const codeMatch = msg.match(/Converter exited with code (\d+)/);
		if (codeMatch) {
			// Try to find a meaningful last line from stderr
			const stderrPart = msg.slice(msg.indexOf(':') + 1).trim();
			const lines = stderrPart.split('\n').filter((l) => l.trim());
			const lastLine = lines.at(-1)?.trim();
			if (lastLine && lastLine.length < 200) {
				return lastLine;
			}
			return `converter exited with code ${codeMatch[1]}`;
		}
		// Truncate long messages
		return msg.length > 120 ? `${msg.slice(0, 120)}...` : msg;
	}

	/**
	 * Send file progress update to renderer (with destroyed-window guard)
	 */
	private sendFileProgress(progress: FileProgress): void {
		this.emitToRenderer(IPC.PROGRESS, {
			type: 'file',
			data: progress,
		});
	}

	/**
	 * Send overall progress update to renderer
	 */
	private sendOverallProgress(): void {
		const progress: OverallProgress = {
			totalFiles: this.totalFiles,
			completedFiles: this.completedFiles,
			errorCount: this.errorCount,
			skippedCount: 0,
			percentComplete:
				this.totalFiles === 0 ? 100 : Math.round((this.completedFiles / this.totalFiles) * 100),
			startedAt: this.startedAt,
			elapsedMs: Date.now() - this.startedAt,
		};

		this.emitToRenderer(IPC.PROGRESS, {
			type: 'overall',
			data: progress,
		});
	}

	/**
	 * Send log entry to renderer
	 */
	private sendLog(
		level: LogEntry['level'],
		message: string,
		details?: string,
		fileId?: string,
	): void {
		const entry: LogEntry = {
			id: `log-${Date.now()}-${Math.random().toString(36).slice(2, 9)}`,
			timestamp: new Date(),
			level,
			message,
			details,
			fileId,
		};

		this.emitToRenderer(IPC.LOG, entry);
	}

	/** Guard against sending IPC to a destroyed window. */
	private emitToRenderer(channel: string, data: unknown): void {
		if (!this.window.isDestroyed()) {
			this.window.webContents.send(channel, data);
		}
	}
}
