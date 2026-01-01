import type { Request, Response, NextFunction } from 'express';
import { TextrawlError } from '../../utils/errors.js';
import { logger } from '../../utils/logger.js';

interface ErrorResponse {
  error: {
    message: string;
    code: string;
    statusCode: number;
  };
}

/**
 * Express error handling middleware
 */
export function errorHandler(
  err: Error,
  _req: Request,
  res: Response,
  _next: NextFunction
): void {
  // Log the error (never include stack traces in logs to prevent information leakage)
  logger.error('Request error', {
    name: err.name,
    message: err.message,
  });

  // Handle known errors
  if (err instanceof TextrawlError) {
    const response: ErrorResponse = {
      error: {
        message: err.message,
        code: err.code,
        statusCode: err.statusCode,
      },
    };
    res.status(err.statusCode).json(response);
    return;
  }

  // Handle unknown errors
  const response: ErrorResponse = {
    error: {
      message:
        process.env.NODE_ENV === 'production'
          ? 'Internal server error'
          : err.message,
      code: 'INTERNAL_ERROR',
      statusCode: 500,
    },
  };
  res.status(500).json(response);
}
