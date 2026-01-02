/**
 * Conversion Manager - Coordinate file conversions
 */
import { spawn } from 'child_process';
import { BrowserWindow } from 'electron';
import { resolve } from 'path';
import pLimit from 'p-limit';
import { IPC } from '../../shared/ipc-channels.js';
import type {
  ScannedFile,
  ConversionOptions,
  FileProgress,
  OverallProgress,
  LogEntry,
} from '../../shared/types.js';
import { getMboxPathFromBundle } from './file-router.js';
import { processDocument } from './document-processor.js';

// __dirname is available in CJS bundle

export class ConversionManager {
  private window: BrowserWindow;
  private isRunning = false;
  private shouldCancel = false;
  private totalFiles = 0;
  private completedFiles = 0;
  private errorCount = 0;

  constructor(window: BrowserWindow) {
    this.window = window;
  }

  /**
   * Start conversion of multiple files
   */
  async startConversion(
    files: ScannedFile[],
    options: ConversionOptions
  ): Promise<{ success: boolean; error?: string }> {
    if (this.isRunning) {
      return { success: false, error: 'Conversion already in progress' };
    }

    this.isRunning = true;
    this.shouldCancel = false;
    this.totalFiles = files.length;
    this.completedFiles = 0;
    this.errorCount = 0;

    // Concurrency limit
    const limit = pLimit(3);

    this.sendOverallProgress();

    try {
      const promises = files.map((file) =>
        limit(async () => {
          if (this.shouldCancel) return;
          await this.convertFile(file, options);
        })
      );

      await Promise.all(promises);

      // Send completion
      this.window.webContents.send(IPC.COMPLETE, {
        type: 'conversion',
        success: this.errorCount === 0,
      });

      return { success: true };
    } catch (error) {
      return {
        success: false,
        error: error instanceof Error ? error.message : String(error),
      };
    } finally {
      this.isRunning = false;
    }
  }

  /**
   * Cancel ongoing conversion
   */
  cancel(): void {
    this.shouldCancel = true;
  }

  /**
   * Convert a single file
   */
  private async convertFile(
    file: ScannedFile,
    options: ConversionOptions
  ): Promise<void> {
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
      this.sendFileProgress({
        fileId: file.id,
        fileName: file.name,
        status: 'error',
        progress: 0,
        error: error instanceof Error ? error.message : String(error),
      });
      this.sendOverallProgress();
    }
  }

  /**
   * Run document processor for supported file types
   */
  private async runDocumentProcessor(
    file: ScannedFile,
    options: ConversionOptions
  ): Promise<void> {
    this.sendLog('info', `Processing ${file.name}...`, undefined, file.id);

    const result = await processDocument(file.path, file.type, {
      outputDir: options.outputDir,
      tags: options.tags,
      dryRun: options.dryRun,
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
      this.sendLog('info', `Converted ${file.name}`, result.outputPath, file.id);
    } else {
      throw new Error(result.error || 'Unknown error');
    }
  }

  /**
   * Run CLI converter via subprocess
   */
  private async runCliConverter(
    file: ScannedFile,
    options: ConversionOptions
  ): Promise<void> {
    return new Promise((resolvePromise, reject) => {
      // Determine input path (handle mbox bundles)
      const inputPath =
        file.type === 'mbox-bundle' ? getMboxPathFromBundle(file.path) : file.path;

      // Find the converter script
      // Go up from dist/main to desktop, then up to textrawl project root
      // __dirname in bundled CJS is the directory of dist/main/index.js
      const projectRoot = resolve(__dirname, '..', '..', '..');
      const converterScript = resolve(
        projectRoot,
        'scripts',
        'cli',
        'converters',
        `${file.converterType}.ts`
      );

      this.sendLog('info', `Converting ${file.name} with ${file.converterType} converter...`, undefined, file.id);

      const args = [
        'tsx',
        converterScript,
        inputPath,
        '-o',
        options.outputDir,
      ];

      if (options.verbose) args.push('-v');
      if (options.dryRun) args.push('--dry-run');
      if (options.tags.length > 0) {
        args.push('-t', ...options.tags);
      }

      const child = spawn('npx', args, {
        cwd: projectRoot,
        stdio: ['ignore', 'pipe', 'pipe'],
        env: { ...process.env },
      });

      let stderr = '';
      let lastProgress = 0;

      child.stderr?.on('data', (data: Buffer) => {
        const output = data.toString();
        stderr += output;

        // Parse progress from [PROGRESS] lines
        const progressMatch = output.match(/\[PROGRESS\]\s*(\d+)%/);
        if (progressMatch) {
          const progress = parseInt(progressMatch[1], 10);
          if (progress > lastProgress) {
            lastProgress = progress;
            this.sendFileProgress({
              fileId: file.id,
              fileName: file.name,
              status: 'processing',
              progress,
            });
          }
        }

        // Log any non-progress output
        const lines = output.split('\n').filter(
          (line) => line.trim() && !line.includes('[PROGRESS]')
        );
        for (const line of lines) {
          this.sendLog('debug', line, undefined, file.id);
        }
      });

      child.stdout?.on('data', (data: Buffer) => {
        // Some converters may output to stdout
        const output = data.toString().trim();
        if (output) {
          this.sendLog('debug', output, undefined, file.id);
        }
      });

      child.on('exit', (code) => {
        if (code === 0) {
          this.sendFileProgress({
            fileId: file.id,
            fileName: file.name,
            status: 'complete',
            progress: 100,
            outputPath: options.outputDir,
            message: 'Converted successfully',
          });
          this.sendLog('info', `Converted ${file.name}`, undefined, file.id);
          resolvePromise();
        } else {
          reject(new Error(`Converter exited with code ${code}: ${stderr.slice(-500)}`));
        }
      });

      child.on('error', (error) => {
        reject(error);
      });
    });
  }

  /**
   * Send file progress update to renderer
   */
  private sendFileProgress(progress: FileProgress): void {
    this.window.webContents.send(IPC.PROGRESS, {
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
      percentComplete: this.totalFiles === 0 ? 100 : Math.round((this.completedFiles / this.totalFiles) * 100),
    };

    this.window.webContents.send(IPC.PROGRESS, {
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
    fileId?: string
  ): void {
    const entry: LogEntry = {
      id: `log-${Date.now()}-${Math.random().toString(36).slice(2, 9)}`,
      timestamp: new Date(),
      level,
      message,
      details,
      fileId,
    };

    this.window.webContents.send(IPC.LOG, entry);
  }
}
