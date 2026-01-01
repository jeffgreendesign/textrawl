import { z } from 'zod';
import { logger } from './logger.js';

/**
 * Environment configuration schema with validation
 */
const envSchema = z.object({
  // Server
  PORT: z
    .string()
    .default('3000')
    .transform((val) => parseInt(val, 10)),
  NODE_ENV: z
    .enum(['development', 'production', 'test'])
    .default('development'),
  LOG_LEVEL: z.enum(['debug', 'info', 'warn', 'error']).default('info'),

  // Authentication
  API_BEARER_TOKEN: z
    .string()
    .min(32, 'API_BEARER_TOKEN must be at least 32 characters')
    .regex(/^[a-zA-Z0-9_-]+$/, 'API_BEARER_TOKEN must contain only alphanumeric characters, underscores, and hyphens')
    .optional(),

  // Supabase
  SUPABASE_URL: z.string().url().optional(),
  SUPABASE_SERVICE_KEY: z.string().optional(),

  // Embeddings
  EMBEDDING_PROVIDER: z.enum(['openai', 'ollama']).default('openai'),

  // OpenAI
  OPENAI_API_KEY: z.string().startsWith('sk-').optional(),

  // Ollama
  OLLAMA_BASE_URL: z.string().url().default('http://localhost:11434'),
  OLLAMA_MODEL: z.string().default('nomic-embed-text'),
});

export type Config = z.infer<typeof envSchema>;

let cachedConfig: Config | null = null;

/**
 * Load and validate configuration from environment variables.
 * In development mode, allows missing credentials for initial setup.
 */
export function loadConfig(): Config {
  if (cachedConfig) {
    return cachedConfig;
  }

  const result = envSchema.safeParse(process.env);

  if (!result.success) {
    logger.error('Configuration validation failed', {
      errors: result.error.format(),
    });
    process.exit(1);
  }

  cachedConfig = result.data;

  // Require token in production mode
  if (result.data.NODE_ENV === 'production' && !result.data.API_BEARER_TOKEN) {
    logger.error('API_BEARER_TOKEN is required in production mode');
    process.exit(1);
  }

  // Log warnings for missing optional config in development
  if (result.data.NODE_ENV === 'development') {
    if (!result.data.API_BEARER_TOKEN) {
      logger.warn('API_BEARER_TOKEN not set - auth will be disabled');
    }
    if (!result.data.SUPABASE_URL || !result.data.SUPABASE_SERVICE_KEY) {
      logger.warn('Supabase credentials not set - database features disabled');
    }
    if (result.data.EMBEDDING_PROVIDER === 'openai' && !result.data.OPENAI_API_KEY) {
      logger.warn('OPENAI_API_KEY not set - embeddings disabled');
    }
    if (result.data.EMBEDDING_PROVIDER === 'ollama') {
      logger.info(`Using Ollama embeddings: ${result.data.OLLAMA_MODEL} at ${result.data.OLLAMA_BASE_URL}`);
    }
  }

  return result.data;
}

export const config = loadConfig();
