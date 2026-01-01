/**
 * Web UI Routes
 *
 * Handles file upload, conversion, and SSE streaming
 */

import { type Express, type Request, type Response } from 'express';
import { type Multer } from 'multer';
import { writeFileSync, mkdirSync, existsSync, rmSync } from 'fs';
import { join, extname, resolve, dirname } from 'path';
import { tmpdir } from 'os';
import { spawn, type ChildProcess } from 'child_process';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

// Store active SSE connections
const sseConnections = new Map<string, Response>();

// Store active conversions
const activeConversions = new Map<string, {
  process: ChildProcess;
  logs: string[];
  status: 'processing' | 'complete' | 'error';
  progress: number;
}>();

/**
 * Set up Express routes
 */
export function setupRoutes(app: Express, upload: Multer): void {
  // SSE endpoint for real-time logs
  app.get('/api/events/:jobId', (req: Request, res: Response) => {
    const { jobId } = req.params;

    // Set up SSE
    res.setHeader('Content-Type', 'text/event-stream');
    res.setHeader('Cache-Control', 'no-cache');
    res.setHeader('Connection', 'keep-alive');
    res.flushHeaders();

    // Store connection
    sseConnections.set(jobId, res);

    // Send existing logs if any
    const conversion = activeConversions.get(jobId);
    console.error(`[SSE] Client connected for job ${jobId}, found conversion: ${!!conversion}, logs: ${conversion?.logs?.length || 0}, status: ${conversion?.status}`);

    if (conversion) {
      // Send current progress first
      if (conversion.progress > 0) {
        console.error(`[SSE] Replaying progress: ${conversion.progress}%`);
        res.write(`data: ${JSON.stringify({ type: 'progress', value: conversion.progress })}\n\n`);
      }

      // Replay all logs
      console.error(`[SSE] Replaying ${conversion.logs.length} logs`);
      for (const log of conversion.logs) {
        res.write(`data: ${JSON.stringify({ type: 'log', message: log })}\n\n`);
      }

      // Send completion status if done
      if (conversion.status === 'complete') {
        console.error(`[SSE] Sending completion status`);
        res.write(`data: ${JSON.stringify({ type: 'complete', message: 'Conversion complete!' })}\n\n`);
      } else if (conversion.status === 'error') {
        console.error(`[SSE] Sending error status`);
        res.write(`data: ${JSON.stringify({ type: 'error', message: 'Conversion failed' })}\n\n`);
      }
    }

    // Clean up on disconnect
    req.on('close', () => {
      sseConnections.delete(jobId);
    });
  });

  // File upload and conversion endpoint
  app.post('/api/convert', upload.single('file'), async (req: Request, res: Response) => {
    try {
      if (!req.file) {
        return res.status(400).json({ error: 'No file provided' });
      }

      const { originalname, buffer, mimetype } = req.file;
      const outputDir = req.body.output || './converted';
      const autoUpload = req.body.autoUpload === 'true';
      const tags = req.body.tags ? req.body.tags.split(',').map((t: string) => t.trim()) : [];

      // Detect format from extension
      const ext = extname(originalname).toLowerCase();
      let converter: string | null = null;

      if (ext === '.mbox') {
        converter = 'mbox';
      } else if (ext === '.eml') {
        converter = 'eml';
      } else if (ext === '.zip') {
        converter = 'takeout';
      } else if (ext === '.html' || ext === '.htm') {
        converter = 'html';
      }

      if (!converter) {
        return res.status(400).json({ error: `Unsupported file type: ${ext}` });
      }

      // Generate job ID
      const jobId = `job-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;

      // Save file to temp location
      const tempDir = join(tmpdir(), `textrawl-${jobId}`);
      mkdirSync(tempDir, { recursive: true });
      const tempFile = join(tempDir, originalname);
      writeFileSync(tempFile, buffer);

      // Initialize conversion tracking
      activeConversions.set(jobId, {
        process: null as unknown as ChildProcess,
        logs: [],
        status: 'processing',
        progress: 0,
      });

      // Start conversion in background
      const converterPath = resolve(__dirname, '..', 'cli', 'converters', `${converter}.ts`);
      const args = [
        'tsx',
        converterPath,
        tempFile,
        '-o', outputDir,
        '-v',
      ];

      if (tags.length > 0) {
        args.push('-t', ...tags);
      }

      const child = spawn('npx', args, {
        cwd: process.cwd(),
        stdio: ['ignore', 'pipe', 'pipe'],
      });

      const conversion = activeConversions.get(jobId)!;
      conversion.process = child;

      // Stream stdout
      child.stdout?.on('data', (data: Buffer) => {
        const lines = data.toString().split('\n').filter(Boolean);
        for (const line of lines) {
          conversion.logs.push(line);
          sendSSE(jobId, { type: 'log', message: line });

          // Try to extract progress from output
          const progressMatch = line.match(/(\d+)%/);
          if (progressMatch) {
            conversion.progress = parseInt(progressMatch[1], 10);
            sendSSE(jobId, { type: 'progress', value: conversion.progress });
          }
        }
      });

      // Stream stderr (where all CLI output goes)
      child.stderr?.on('data', (data: Buffer) => {
        const lines = data.toString().split('\n').filter(Boolean);
        for (const line of lines) {
          conversion.logs.push(line);
          sendSSE(jobId, { type: 'log', message: line });

          // Extract progress from [PROGRESS] messages
          const progressMatch = line.match(/\[PROGRESS\]\s*(\d+)%/);
          if (progressMatch) {
            conversion.progress = parseInt(progressMatch[1], 10);
            sendSSE(jobId, { type: 'progress', value: conversion.progress });
          }
        }
      });

      // Handle completion
      child.on('exit', async (code) => {
        if (code === 0) {
          conversion.status = 'complete';
          conversion.progress = 100;
          sendSSE(jobId, { type: 'complete', message: 'Conversion complete!' });

          // Auto-upload if requested
          if (autoUpload) {
            await runUpload(jobId, outputDir, tags);
          }
        } else {
          conversion.status = 'error';
          sendSSE(jobId, { type: 'error', message: `Conversion failed with code ${code}` });
        }

        // Clean up temp file after a delay
        setTimeout(() => {
          try {
            rmSync(tempDir, { recursive: true, force: true });
          } catch {
            // Ignore cleanup errors
          }
        }, 60000); // Keep for 1 minute for debugging
      });

      // Return job ID immediately
      res.json({
        jobId,
        format: converter,
        filename: originalname,
        outputDir,
      });
    } catch (error) {
      console.error('Conversion error:', error);
      res.status(500).json({ error: String(error) });
    }
  });

  // Upload endpoint (for manual upload after conversion)
  app.post('/api/upload', async (req: Request, res: Response) => {
    try {
      const { directory, tags } = req.body;

      if (!directory) {
        return res.status(400).json({ error: 'No directory specified' });
      }

      const jobId = `upload-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;

      await runUpload(jobId, directory, tags || []);

      res.json({ jobId });
    } catch (error) {
      console.error('Upload error:', error);
      res.status(500).json({ error: String(error) });
    }
  });

  // Status endpoint
  app.get('/api/status/:jobId', (req: Request, res: Response) => {
    const { jobId } = req.params;
    const conversion = activeConversions.get(jobId);

    if (!conversion) {
      return res.status(404).json({ error: 'Job not found' });
    }

    res.json({
      status: conversion.status,
      progress: conversion.progress,
      logCount: conversion.logs.length,
    });
  });

  // Get logs endpoint
  app.get('/api/logs/:jobId', (req: Request, res: Response) => {
    const { jobId } = req.params;
    const conversion = activeConversions.get(jobId);

    if (!conversion) {
      return res.status(404).json({ error: 'Job not found' });
    }

    res.json({
      logs: conversion.logs,
      status: conversion.status,
    });
  });
}

/**
 * Send SSE message to connected client
 */
function sendSSE(jobId: string, data: object): void {
  const connection = sseConnections.get(jobId);
  if (connection) {
    connection.write(`data: ${JSON.stringify(data)}\n\n`);
  } else {
    // Log dropped messages for debugging
    const dataObj = data as { type?: string };
    if (dataObj.type !== 'log') {
      console.error(`[SSE] No connection for ${jobId}, dropped:`, dataObj.type);
    }
  }
}

/**
 * Run upload process
 */
async function runUpload(jobId: string, directory: string, tags: string[]): Promise<void> {
  const uploadPath = resolve(__dirname, '..', 'cli', 'upload.ts');
  const args = [
    'tsx',
    uploadPath,
    directory,
    '-v',
  ];

  if (tags.length > 0) {
    args.push('-t', ...tags);
  }

  const child = spawn('npx', args, {
    cwd: process.cwd(),
    stdio: ['ignore', 'pipe', 'pipe'],
  });

  child.stdout?.on('data', (data: Buffer) => {
    const lines = data.toString().split('\n').filter(Boolean);
    for (const line of lines) {
      sendSSE(jobId, { type: 'log', message: `[UPLOAD] ${line}` });
    }
  });

  child.stderr?.on('data', (data: Buffer) => {
    const lines = data.toString().split('\n').filter(Boolean);
    for (const line of lines) {
      sendSSE(jobId, { type: 'log', message: `[UPLOAD] ${line}` });
    }
  });

  child.on('exit', (code) => {
    if (code === 0) {
      sendSSE(jobId, { type: 'upload_complete', message: 'Upload complete!' });
    } else {
      sendSSE(jobId, { type: 'upload_error', message: `Upload failed with code ${code}` });
    }
  });
}
