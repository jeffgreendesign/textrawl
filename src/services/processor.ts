import pdf from 'pdf-parse';
import mammoth from 'mammoth';
import { fileTypeFromBuffer } from 'file-type';
import { logger } from '../utils/logger.js';
import { ValidationError } from '../utils/errors.js';

const SUPPORTED_TYPES: Record<string, string> = {
  'application/pdf': 'pdf',
  'application/vnd.openxmlformats-officedocument.wordprocessingml.document': 'docx',
  'text/plain': 'txt',
  'text/markdown': 'md',
};

/**
 * Validate file content matches expected MIME type using magic numbers.
 * Text files have no magic numbers, so we allow them if claimed MIME is text/*.
 */
export async function validateFileType(buffer: Buffer, expectedMime: string): Promise<boolean> {
  const detected = await fileTypeFromBuffer(buffer);

  // Text files have no magic numbers - allow if claimed MIME is text/*
  if (!detected && expectedMime.startsWith('text/')) {
    return true;
  }

  // For binary files, verify the detected type matches
  if (detected) {
    return detected.mime === expectedMime;
  }

  return false;
}

export async function extractText(buffer: Buffer, mimetype: string): Promise<string> {
  const fileType = SUPPORTED_TYPES[mimetype];

  if (!fileType) {
    throw new ValidationError(`Unsupported file type: ${mimetype}. Supported: PDF, DOCX, TXT, MD`);
  }

  logger.debug('Extracting text', { mimetype, fileType, size: buffer.length });

  switch (fileType) {
    case 'pdf': {
      const data = await pdf(buffer);
      return data.text;
    }
    case 'docx': {
      const result = await mammoth.extractRawText({ buffer });
      return result.value;
    }
    case 'txt':
    case 'md':
      return buffer.toString('utf-8');
    default:
      throw new ValidationError(`Unsupported file type: ${mimetype}`);
  }
}

export function isSupportedType(mimetype: string): boolean {
  return mimetype in SUPPORTED_TYPES;
}
