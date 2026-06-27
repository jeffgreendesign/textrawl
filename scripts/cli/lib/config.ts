/**
 * CLI configuration loading
 *
 * Loads environment variables from .env file for CLI context
 */

import { existsSync } from 'node:fs';
import { resolve } from 'node:path';
import { config as dotenvConfig } from 'dotenv';

/**
 * CLI configuration
 */
export interface CLIConfig {
	/** Neon PostgreSQL connection URL */
	databaseUrl: string;
	/** Embedding provider: openai, google, or ollama */
	embeddingProvider: 'openai' | 'google' | 'ollama';
	/** OpenAI API key (if using OpenAI) */
	openaiApiKey?: string;
	/** Google AI API key (if using Google) */
	googleApiKey?: string;
	/** Ollama base URL (if using Ollama) */
	ollamaBaseUrl?: string;
	/** Ollama model (if using Ollama) */
	ollamaModel?: string;
}

/**
 * Load CLI configuration from .env file
 */
export function loadCLIConfig(envPath = '.env'): CLIConfig {
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
	const databaseUrl = process.env.DATABASE_URL;

	if (!databaseUrl) {
		throw new Error('DATABASE_URL is required in .env file');
	}

	// Determine embedding provider
	const embeddingProvider = (process.env.EMBEDDING_PROVIDER || 'openai') as
		| 'openai'
		| 'google'
		| 'ollama';

	if (embeddingProvider === 'openai') {
		if (!process.env.OPENAI_API_KEY) {
			throw new Error('OPENAI_API_KEY is required when using OpenAI embeddings');
		}
	} else if (embeddingProvider === 'google') {
		if (!process.env.GOOGLE_AI_API_KEY) {
			throw new Error('GOOGLE_AI_API_KEY is required when using Google AI embeddings');
		}
	} else if (embeddingProvider === 'ollama') {
		if (!process.env.OLLAMA_BASE_URL) {
			throw new Error('OLLAMA_BASE_URL is required when using Ollama embeddings');
		}
	} else {
		throw new Error(
			`Invalid EMBEDDING_PROVIDER: ${embeddingProvider}. Must be 'openai', 'google', or 'ollama'`,
		);
	}

	return {
		databaseUrl,
		embeddingProvider,
		openaiApiKey: process.env.OPENAI_API_KEY,
		googleApiKey: process.env.GOOGLE_AI_API_KEY,
		ollamaBaseUrl: process.env.OLLAMA_BASE_URL,
		ollamaModel: process.env.OLLAMA_MODEL || 'nomic-embed-text',
	};
}

/**
 * Check if upload is configured (has database + embeddings)
 */
export function isUploadConfigured(config: CLIConfig): boolean {
	if (!config.databaseUrl) {
		return false;
	}

	if (config.embeddingProvider === 'openai' && !config.openaiApiKey) {
		return false;
	}

	if (config.embeddingProvider === 'google' && !config.googleApiKey) {
		return false;
	}

	if (config.embeddingProvider === 'ollama' && !config.ollamaBaseUrl) {
		return false;
	}

	return true;
}
