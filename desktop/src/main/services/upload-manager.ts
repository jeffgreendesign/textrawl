/**
 * Upload Manager - Handle uploads to Supabase via CLI
 */
import { spawn } from 'child_process';
import { BrowserWindow } from 'electron';
import { resolve } from 'path';
import { IPC } from '../../shared/ipc-channels.js';
import type { UploadOptions, LogEntry } from '../../shared/types.js';

// __dirname is available in CJS bundle

export class UploadManager {
  private window: BrowserWindow;
  private isRunning = false;

  constructor(window: BrowserWindow) {
    this.window = window;
  }

  /**
   * Start upload of converted files to Supabase
   */
  async startUpload(
    options: UploadOptions
  ): Promise<{ success: boolean; error?: string }> {
    if (this.isRunning) {
      return { success: false, error: 'Upload already in progress' };
    }

    this.isRunning = true;

    try {
      await this.runUpload(options);

      this.window.webContents.send(IPC.COMPLETE, {
        type: 'upload',
        success: true,
      });

      return { success: true };
    } catch (error) {
      this.window.webContents.send(IPC.ERROR, {
        message: 'Upload failed',
        details: error instanceof Error ? error.message : String(error),
      });

      return {
        success: false,
        error: error instanceof Error ? error.message : String(error),
      };
    } finally {
      this.isRunning = false;
    }
  }

  /**
   * Run the upload CLI script
   */
  private async runUpload(options: UploadOptions): Promise<void> {
    return new Promise((resolvePromise, reject) => {
      // Find the upload script
      // Go up from dist/main to desktop, then up to textrawl project root
      const projectRoot = resolve(__dirname, '..', '..', '..');
      const uploadScript = resolve(projectRoot, 'scripts', 'cli', 'upload.ts');

      this.sendLog('info', `Uploading files from ${options.directory}...`);

      const args = ['tsx', uploadScript, options.directory];

      if (options.tags.length > 0) {
        args.push('-t', ...options.tags);
      }

      const child = spawn('npx', args, {
        cwd: projectRoot,
        stdio: ['ignore', 'pipe', 'pipe'],
        env: { ...process.env },
      });

      let stderr = '';

      child.stderr?.on('data', (data: Buffer) => {
        const output = data.toString();
        stderr += output;

        // Parse progress from output (percentage-based, file counts unavailable from CLI)
        const progressMatch = output.match(/\[PROGRESS\]\s*(\d+)%/);
        if (progressMatch) {
          const progress = parseInt(progressMatch[1], 10);
          this.window.webContents.send(IPC.PROGRESS, {
            type: 'overall',
            data: {
              totalFiles: 0,
              completedFiles: 0,
              errorCount: 0,
              skippedCount: 0,
              percentComplete: progress,
            },
          });
        }

        // Log non-progress output
        const lines = output
          .split('\n')
          .filter((line) => line.trim() && !line.includes('[PROGRESS]'));
        for (const line of lines) {
          const level = line.includes('error') ? 'error' : 'info';
          this.sendLog(level as LogEntry['level'], line);
        }
      });

      child.stdout?.on('data', (data: Buffer) => {
        const output = data.toString().trim();
        if (output) {
          this.sendLog('info', output);
        }
      });

      child.on('exit', (code) => {
        if (code === 0) {
          this.sendLog('info', 'Upload completed successfully');
          resolvePromise();
        } else {
          reject(new Error(`Upload exited with code ${code}: ${stderr.slice(-500)}`));
        }
      });

      child.on('error', (error) => {
        reject(error);
      });
    });
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

    this.window.webContents.send(IPC.LOG, entry);
  }
}
