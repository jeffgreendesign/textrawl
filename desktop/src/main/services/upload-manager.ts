/**
 * Upload Manager - Handle uploads to Supabase via CLI
 *
 * Uses runCliScript() for subprocess lifecycle (FD cleanup, timeout).
 */
import type { BrowserWindow } from 'electron';
import { IPC } from '../../shared/ipc-channels.js';
import type { LogEntry, UploadOptions } from '../../shared/types.js';
import { runCliScript } from '../utils/run-cli-script.js';
import type { SettingsStore } from './settings-store.js';

export class UploadManager {
	private window: BrowserWindow;
	private settingsStore: SettingsStore;
	private isRunning = false;
	private startedAt = 0;
	private errorCount = 0;
	private maxCurrent = 0;

	constructor(window: BrowserWindow, settingsStore: SettingsStore) {
		this.window = window;
		this.settingsStore = settingsStore;
	}

	/**
	 * Start upload of converted files to Supabase
	 */
	async startUpload(options: UploadOptions): Promise<{ success: boolean; error?: string }> {
		if (this.isRunning) {
			return { success: false, error: 'Upload already in progress' };
		}

		this.isRunning = true;

		try {
			await this.runUpload(options);

			this.emitToRenderer(IPC.COMPLETE, {
				type: 'upload',
				success: true,
			});

			return { success: true };
		} catch (error) {
			const errorMsg = error instanceof Error ? error.message : String(error);

			// The CLI exits with code 1 if *any* files failed, even if 99%
			// succeeded. Detect partial success from the summary line and
			// report it as a success with warnings rather than a hard error.
			if (this.isPartialSuccess(errorMsg)) {
				this.sendLog('warn', 'Upload completed with some errors (see log above)');
				this.emitToRenderer(IPC.COMPLETE, {
					type: 'upload',
					success: true,
				});
				return { success: true };
			}

			this.emitToRenderer(IPC.ERROR, {
				message: `Upload failed: ${this.summarizeError(errorMsg)}`,
				details: errorMsg,
			});

			return {
				success: false,
				error: errorMsg,
			};
		} finally {
			this.isRunning = false;
		}
	}

	/**
	 * Run the upload CLI script via shared runCliScript utility
	 */
	private async runUpload(options: UploadOptions): Promise<void> {
		this.startedAt = Date.now();
		this.errorCount = 0;
		this.maxCurrent = 0;
		this.sendLog('info', `Uploading files from ${options.directory}...`);

		// Inject credentials from settings store so the CLI child process
		// has SUPABASE_URL/SUPABASE_SERVICE_KEY without relying on .env
		const settings = this.settingsStore.get();
		const env: Record<string, string> = {
			// Give the upload process 8 GB heap and enable manual GC between batches
			NODE_OPTIONS: '--max-old-space-size=8192 --expose-gc',
		};
		if (settings.supabaseUrl) env.SUPABASE_URL = settings.supabaseUrl;
		if (settings.supabaseKey) env.SUPABASE_SERVICE_KEY = settings.supabaseKey;

		const args = [options.directory, '--auto-split', '--skip-large'];
		if (options.tags.length > 0) {
			args.push('-t', ...options.tags);
		}

		await runCliScript({
			scriptPath: 'scripts/cli/upload.ts',
			args,
			label: 'Upload',
			env,
			idleTimeout: 300_000, // 5 min idle — kill only if truly stuck, not for long-running jobs
			onProgress: ({ percent, current, total }) => {
				// Track highest `current` seen — the CLI emits progress.update(0, filename)
				// at the start of each file which would reset the count to 0.
				this.maxCurrent = Math.max(this.maxCurrent, current ?? 0);
				this.emitToRenderer(IPC.PROGRESS, {
					type: 'overall',
					data: {
						totalFiles: total ?? 0,
						completedFiles: this.maxCurrent,
						errorCount: this.errorCount,
						skippedCount: 0,
						percentComplete: percent,
						startedAt: this.startedAt,
						elapsedMs: Date.now() - this.startedAt,
					},
				});
			},
			onOutput: ({ text }) => {
				const isError = text.includes('[ERROR]') || text.includes('\u2717');
				if (isError) this.errorCount++;
				this.sendLog(isError ? 'error' : 'info', text);
			},
		});

		this.sendLog('info', 'Upload completed successfully');
	}

	/** Check if the CLI error output contains a successful upload summary. */
	private isPartialSuccess(msg: string): boolean {
		// Match "Files uploaded: N" where N > 0
		const match = msg.match(/Files uploaded:\s*(\d+)/);
		return match !== null && parseInt(match[1], 10) > 0;
	}

	/** Extract a short, human-readable reason from CLI error output. */
	private summarizeError(msg: string): string {
		// CLI format: "Upload exited with code N: <stderr tail>"
		const codeMatch = msg.match(/exited with code \d+:\s*(.*)/s);
		if (codeMatch) {
			const stderr = codeMatch[1].trim();
			// Find the last non-empty line (usually the most relevant error)
			const lines = stderr.split('\n').filter((l) => l.trim());
			const last = lines.at(-1)?.trim();
			if (last && last.length < 200) return last;
			return 'process exited with non-zero code';
		}
		return msg.length > 120 ? `${msg.slice(0, 120)}...` : msg;
	}

	/**
	 * Send log entry to renderer
	 */
	private sendLog(level: LogEntry['level'], message: string, details?: string): void {
		const entry: LogEntry = {
			id: `log-${Date.now()}-${Math.random().toString(36).slice(2, 9)}`,
			timestamp: new Date(),
			level,
			message,
			details,
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
