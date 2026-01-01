import type { Request, Response, NextFunction } from 'express';
import { timingSafeEqual } from 'crypto';
import { config } from '../../utils/config.js';
import { logger } from '../../utils/logger.js';
import { AuthenticationError, AuthorizationError } from '../../utils/errors.js';

/**
 * Bearer token authentication middleware
 */
export function bearerAuth(req: Request, _res: Response, next: NextFunction): void {
  // Skip auth if not configured (development mode)
  if (!config.API_BEARER_TOKEN) {
    logger.debug('Auth skipped - no token configured');
    return next();
  }

  const authHeader = req.headers.authorization;

  if (!authHeader) {
    throw new AuthenticationError('Missing Authorization header');
  }

  const [scheme, token] = authHeader.split(' ');

  if (scheme !== 'Bearer' || !token) {
    throw new AuthenticationError('Invalid Authorization format. Use: Bearer <token>');
  }

  // Use timing-safe comparison to prevent timing attacks
  const tokenBuffer = Buffer.from(token);
  const expectedBuffer = Buffer.from(config.API_BEARER_TOKEN);
  if (tokenBuffer.length !== expectedBuffer.length ||
      !timingSafeEqual(tokenBuffer, expectedBuffer)) {
    logger.warn('Invalid bearer token attempt', { path: req.path });
    throw new AuthorizationError('Invalid token');
  }

  next();
}
