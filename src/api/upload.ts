import { Router, type Router as RouterType } from 'express';
import multer from 'multer';
import { createDocument } from '../db/documents.js';
import { isDatabaseConfigured } from '../db/pg-client.js';
import { smartChunk } from '../services/chunker.js';
import { embedAndStoreChunks } from '../services/embed-store.js';
import { generateEmbeddings, isOpenAIConfigured } from '../services/embeddings.js';
import { extractText, isSupportedType, validateFileType } from '../services/processor.js';
import { config } from '../utils/config.js';
import { UnsupportedFileTypeError, ValidationError } from '../utils/errors.js';
import { logger } from '../utils/logger.js';
import { bearerAuth } from './middleware/auth.js';
import { uploadLimiter } from './middleware/rateLimit.js';

// Max bytes accepted by the direct upload path, derived from config (not a
// hardcoded literal). Exported so the limit can be asserted in tests.
export const maxUploadBytes = config.MAX_SINGLE_FILE_SIZE_MB * 1024 * 1024;

const upload = multer({
	storage: multer.memoryStorage(),
	limits: { fileSize: maxUploadBytes },
	fileFilter: (_req, file, cb) => {
		if (isSupportedType(file.mimetype)) {
			cb(null, true);
		} else {
			cb(new UnsupportedFileTypeError(`Unsupported file type: ${file.mimetype}`));
		}
	},
});

export const uploadRouter: RouterType = Router();

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

			if (!isDatabaseConfigured()) {
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
						tags = req.body.tags
							.split(',')
							.map((t: string) => t.trim())
							.filter(Boolean);
					}
				} else if (Array.isArray(req.body.tags)) {
					tags = (req.body.tags as unknown[]).filter((t): t is string => typeof t === 'string');
				}
			}
			// Apply limits: truncate tag length and limit count
			tags = tags.slice(0, MAX_TAGS).map((t) => t.slice(0, MAX_TAG_LENGTH));

			// Sanitize filename for logging (remove special chars, truncate)
			const sanitizedFilename = originalname.replace(/[^\w.-]/g, '_').slice(0, 50);
			logger.info('Processing upload', {
				filename: sanitizedFilename,
				size: buffer.length,
				tagCount: tags.length,
			});

			// Extract text
			const content = await extractText(buffer, mimetype);

			// Create document
			const document = await createDocument({
				title,
				sourceType: 'file',
				rawContent: content,
				metadata: { originalName: sanitizedFilename, mimetype, size: buffer.length, tags },
			});

			// Chunk and embed (uses semantic or fixed chunking based on CHUNKING_MODE).
			// embedAndStoreChunks streams embed+insert in windows to bound memory.
			const chunks = await smartChunk(content, generateEmbeddings);
			await embedAndStoreChunks(document.id, chunks, generateEmbeddings);

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
	},
);
