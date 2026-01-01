import { Router } from 'express';
import multer from 'multer';
import { bearerAuth } from './middleware/auth.js';
import { uploadLimiter } from './middleware/rateLimit.js';
import { extractText, isSupportedType, validateFileType } from '../services/processor.js';
import { createDocument } from '../db/documents.js';
import { createChunks } from '../db/chunks.js';
import { chunkText } from '../services/chunker.js';
import { generateEmbeddings, isOpenAIConfigured } from '../services/embeddings.js';
import { isSupabaseConfigured } from '../db/client.js';
import { logger } from '../utils/logger.js';
import { ValidationError } from '../utils/errors.js';

const upload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 10 * 1024 * 1024 }, // 10MB
  fileFilter: (_req, file, cb) => {
    if (isSupportedType(file.mimetype)) {
      cb(null, true);
    } else {
      cb(new ValidationError(`Unsupported file type: ${file.mimetype}`));
    }
  },
});

export const uploadRouter = Router();

uploadRouter.post(
  '/upload',
  bearerAuth,
  uploadLimiter,
  upload.single('file'),
  async (req, res, next) => {
    try {
      if (!req.file) {
        throw new ValidationError('No file provided');
      }

      if (!isSupabaseConfigured()) {
        res.status(503).json({ error: 'Database not configured' });
        return;
      }

      if (!isOpenAIConfigured()) {
        res.status(503).json({ error: 'OpenAI not configured' });
        return;
      }

      const { originalname, buffer, mimetype } = req.file;

      // Validate file content matches claimed MIME type (magic number check)
      const isValidType = await validateFileType(buffer, mimetype);
      if (!isValidType) {
        throw new ValidationError(`File content does not match claimed type: ${mimetype}`);
      }

      const title = (req.body.title as string) || originalname;

      // Parse tags from request body (supports JSON array or comma-separated string)
      // Security: Limit to 10 tags, 50 chars each to prevent metadata abuse
      const MAX_TAGS = 10;
      const MAX_TAG_LENGTH = 50;
      let tags: string[] = [];
      if (req.body.tags) {
        if (typeof req.body.tags === 'string') {
          try {
            // Try parsing as JSON array first
            const parsed = JSON.parse(req.body.tags);
            if (Array.isArray(parsed)) {
              tags = parsed.filter((t): t is string => typeof t === 'string');
            }
          } catch {
            // Fall back to comma-separated
            tags = req.body.tags.split(',').map((t: string) => t.trim()).filter(Boolean);
          }
        } else if (Array.isArray(req.body.tags)) {
          tags = (req.body.tags as unknown[]).filter((t): t is string => typeof t === 'string');
        }
      }
      // Apply limits: truncate tag length and limit count
      tags = tags.slice(0, MAX_TAGS).map(t => t.slice(0, MAX_TAG_LENGTH));

      // Sanitize filename for logging (remove special chars, truncate)
      const sanitizedFilename = originalname.replace(/[^\w.-]/g, '_').slice(0, 50);
      logger.info('Processing upload', { filename: sanitizedFilename, size: buffer.length, tagCount: tags.length });

      // Extract text
      const content = await extractText(buffer, mimetype);

      // Create document
      const document = await createDocument({
        title,
        sourceType: 'file',
        rawContent: content,
        metadata: { originalName: sanitizedFilename, mimetype, size: buffer.length, tags },
      });

      // Chunk and embed
      const chunks = chunkText(content);
      const embeddings = await generateEmbeddings(chunks.map((c) => c.content));

      await createChunks(
        chunks.map((chunk, i) => ({
          documentId: document.id,
          content: chunk.content,
          chunkIndex: chunk.index,
          startOffset: chunk.startOffset,
          endOffset: chunk.endOffset,
          embedding: embeddings[i],
        }))
      );

      res.json({
        success: true,
        documentId: document.id,
        title: document.title,
        tags,
        chunksCreated: chunks.length,
      });
    } catch (error) {
      next(error);
    }
  }
);
