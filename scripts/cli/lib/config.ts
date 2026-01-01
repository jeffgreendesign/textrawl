/**
 * CLI configuration loading
 *
 * Loads environment variables from .env file for CLI context
 */

import { config as dotenvConfig } from 'dotenv';
import { resolve } from 'path';
import { existsSync } from 'fs';

/**
 * CLI configuration
 */
export interface CLIConfig {
  /** Supabase project URL */
  supabaseUrl: string;
  /** Supabase service key */
  supabaseServiceKey: string;
  /** Embedding provider: openai or ollama */
  embeddingProvider: 'openai' | 'ollama';
  /** OpenAI API key (if using OpenAI) */
  openaiApiKey?: string;
  /** Ollama base URL (if using Ollama) */
  ollamaBaseUrl?: string;
  /** Ollama model (if using Ollama) */
  ollamaModel?: string;
}

/**
 * Load CLI configuration from .env file
 */
export function loadCLIConfig(envPath: string = '.env'): CLIConfig {
  const resolvedPath = resolve(process.cwd(), envPath);

  if (!existsSync(resolvedPath)) {
    throw new Error(`Configuration file not found: ${resolvedPath}`);
  }

  // Load environment variables
  const result = dotenvConfig({ path: resolvedPath });
  if (result.error) {
    throw new Error(`Failed to load configuration: ${result.error.message}`);
  }

  // Validate required fields
  const supabaseUrl = process.env.SUPABASE_URL;
  const supabaseServiceKey = process.env.SUPABASE_SERVICE_KEY;

  if (!supabaseUrl) {
    throw new Error('SUPABASE_URL is required in .env file');
  }

  if (!supabaseServiceKey) {
    throw new Error('SUPABASE_SERVICE_KEY is required in .env file');
  }

  // Determine embedding provider
  const embeddingProvider = (process.env.EMBEDDING_PROVIDER || 'openai') as 'openai' | 'ollama';

  if (embeddingProvider === 'openai') {
    if (!process.env.OPENAI_API_KEY) {
      throw new Error('OPENAI_API_KEY is required when using OpenAI embeddings');
    }
  } else if (embeddingProvider === 'ollama') {
    if (!process.env.OLLAMA_BASE_URL) {
      throw new Error('OLLAMA_BASE_URL is required when using Ollama embeddings');
    }
  } else {
    throw new Error(`Invalid EMBEDDING_PROVIDER: ${embeddingProvider}. Must be 'openai' or 'ollama'`);
  }

  return {
    supabaseUrl,
    supabaseServiceKey,
    embeddingProvider,
    openaiApiKey: process.env.OPENAI_API_KEY,
    ollamaBaseUrl: process.env.OLLAMA_BASE_URL,
    ollamaModel: process.env.OLLAMA_MODEL || 'nomic-embed-text',
  };
}

/**
 * Check if upload is configured (has Supabase + embeddings)
 */
export function isUploadConfigured(config: CLIConfig): boolean {
  if (!config.supabaseUrl || !config.supabaseServiceKey) {
    return false;
  }

  if (config.embeddingProvider === 'openai' && !config.openaiApiKey) {
    return false;
  }

  if (config.embeddingProvider === 'ollama' && !config.ollamaBaseUrl) {
    return false;
  }

  return true;
}
