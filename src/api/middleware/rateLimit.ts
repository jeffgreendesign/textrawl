import rateLimit from 'express-rate-limit';

export const apiLimiter = rateLimit({
  windowMs: 60 * 1000,
  max: 100,
  standardHeaders: true,
  legacyHeaders: false,
  message: { error: { message: 'Too many requests', code: 'RATE_LIMIT_ERROR' } },
});

export const uploadLimiter = rateLimit({
  windowMs: 60 * 1000,
  max: 10,
  standardHeaders: true,
  legacyHeaders: false,
  message: { error: { message: 'Upload rate limit exceeded', code: 'RATE_LIMIT_ERROR' } },
});

// Health endpoint rate limiter (more permissive but still prevents DoS)
export const healthLimiter = rateLimit({
  windowMs: 60 * 1000,
  max: 300, // Allow more requests for health checks (monitoring systems poll frequently)
  standardHeaders: true,
  legacyHeaders: false,
  message: { error: { message: 'Health check rate limit exceeded', code: 'RATE_LIMIT_ERROR' } },
});
