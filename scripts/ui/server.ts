#!/usr/bin/env npx tsx
/**
 * Textrawl Converter Web UI Server
 *
 * Provides a drag-and-drop interface for converting files
 *
 * Usage:
 *   npm run ui
 *   npx tsx scripts/ui/server.ts
 */

import 'dotenv/config';
import express from 'express';
import { resolve, join, dirname } from 'path';
import { fileURLToPath } from 'url';
import multer from 'multer';
import { existsSync, mkdirSync } from 'fs';

import { setupRoutes } from './routes.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

const app = express();
const PORT = process.env.UI_PORT || 3001;

// Middleware
app.use(express.json());

// Serve static files
const publicDir = resolve(__dirname, 'public');
app.use(express.static(publicDir));

// File upload config
const upload = multer({
  storage: multer.memoryStorage(),
  limits: {
    fileSize: 500 * 1024 * 1024, // 500MB limit for large archives
  },
});

// Set up routes
setupRoutes(app, upload);

// Start server
app.listen(PORT, () => {
  console.error(`\n🚀 Textrawl Converter UI running at http://localhost:${PORT}\n`);
  console.error('Supported formats:');
  console.error('  • MBOX - Email archives');
  console.error('  • EML - Individual emails');
  console.error('  • ZIP - Google Takeout archives');
  console.error('  • HTML - Web pages\n');
});
