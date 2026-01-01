import OpenAI from 'openai';
import { config } from '../utils/config.js';
import { logger } from '../utils/logger.js';
import { ExternalServiceError } from '../utils/errors.js';

// Provider-specific constants
const OPENAI_MODEL = 'text-embedding-3-small';
const OPENAI_DIMENSIONS = 1536;
const OPENAI_MAX_BATCH_SIZE = 2048;

const OLLAMA_DIMENSIONS = 1024; // nomic-embed-text, mxbai-embed-large
const OLLAMA_MAX_BATCH_SIZE = 100;

// Ollama API response type
interface OllamaEmbedResponse {
  embeddings?: number[][];
}

let openai: OpenAI | null = null;

/**
 * Get embedding dimensions for the configured provider
 */
export function getEmbeddingDimensions(): number {
  if (config.EMBEDDING_PROVIDER === 'ollama') {
    return OLLAMA_DIMENSIONS;
  }
  return OPENAI_DIMENSIONS;
}

/**
 * Get the OpenAI client instance (singleton pattern)
 */
function getOpenAIClient(): OpenAI {
  if (!config.OPENAI_API_KEY) {
    throw new ExternalServiceError(
      'OpenAI API key not configured. Set OPENAI_API_KEY.'
    );
  }

  if (!openai) {
    openai = new OpenAI({ apiKey: config.OPENAI_API_KEY });
    logger.info('OpenAI client initialized');
  }

  return openai;
}

/**
 * Check if embeddings are configured (either OpenAI or Ollama)
 */
export function isEmbeddingsConfigured(): boolean {
  if (config.EMBEDDING_PROVIDER === 'ollama') {
    return true; // Ollama just needs to be running
  }
  return !!config.OPENAI_API_KEY;
}

/**
 * Generate embedding using Ollama
 */
async function generateOllamaEmbedding(text: string): Promise<number[]> {
  const url = `${config.OLLAMA_BASE_URL}/api/embed`;

  try {
    const response = await fetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        model: config.OLLAMA_MODEL,
        input: text,
      }),
    });

    if (!response.ok) {
      const errorText = await response.text();
      throw new Error(`Ollama returned ${response.status}: ${errorText}`);
    }

    const data = (await response.json()) as OllamaEmbedResponse;

    // Ollama returns { embeddings: [[...]] } for single input
    if (data.embeddings && data.embeddings.length > 0) {
      return data.embeddings[0];
    }

    throw new Error('Invalid response format from Ollama');
  } catch (error) {
    if (error instanceof Error && error.message.includes('ECONNREFUSED')) {
      throw new ExternalServiceError(
        `Cannot connect to Ollama at ${config.OLLAMA_BASE_URL}. Is Ollama running?`
      );
    }
    throw new ExternalServiceError(
      `Ollama embedding failed: ${error instanceof Error ? error.message : String(error)}`
    );
  }
}

/**
 * Generate embeddings for multiple texts using Ollama
 */
async function generateOllamaEmbeddings(texts: string[]): Promise<number[][]> {
  const url = `${config.OLLAMA_BASE_URL}/api/embed`;

  const batches: string[][] = [];
  for (let i = 0; i < texts.length; i += OLLAMA_MAX_BATCH_SIZE) {
    batches.push(texts.slice(i, i + OLLAMA_MAX_BATCH_SIZE));
  }

  try {
    const allEmbeddings: number[][] = [];

    for (const batch of batches) {
      const response = await fetch(url, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          model: config.OLLAMA_MODEL,
          input: batch,
        }),
      });

      if (!response.ok) {
        const errorText = await response.text();
        throw new Error(`Ollama returned ${response.status}: ${errorText}`);
      }

      const data = (await response.json()) as OllamaEmbedResponse;

      if (data.embeddings) {
        allEmbeddings.push(...data.embeddings);
      } else {
        throw new Error('Invalid response format from Ollama');
      }
    }

    return allEmbeddings;
  } catch (error) {
    if (error instanceof Error && error.message.includes('ECONNREFUSED')) {
      throw new ExternalServiceError(
        `Cannot connect to Ollama at ${config.OLLAMA_BASE_URL}. Is Ollama running?`
      );
    }
    throw new ExternalServiceError(
      `Ollama batch embedding failed: ${error instanceof Error ? error.message : String(error)}`
    );
  }
}

/**
 * Generate embedding using OpenAI
 */
async function generateOpenAIEmbedding(text: string): Promise<number[]> {
  const client = getOpenAIClient();

  try {
    const response = await client.embeddings.create({
      model: OPENAI_MODEL,
      input: text,
      encoding_format: 'float',
    });

    return response.data[0].embedding;
  } catch (error) {
    throw new ExternalServiceError(
      `OpenAI embedding generation failed: ${error instanceof Error ? error.message : String(error)}`
    );
  }
}

/**
 * Generate embeddings for multiple texts using OpenAI
 */
async function generateOpenAIEmbeddings(texts: string[]): Promise<number[][]> {
  const client = getOpenAIClient();

  const batches: string[][] = [];
  for (let i = 0; i < texts.length; i += OPENAI_MAX_BATCH_SIZE) {
    batches.push(texts.slice(i, i + OPENAI_MAX_BATCH_SIZE));
  }

  try {
    const allEmbeddings: number[][] = [];

    for (const batch of batches) {
      const response = await client.embeddings.create({
        model: OPENAI_MODEL,
        input: batch,
        encoding_format: 'float',
      });

      const sortedData = response.data.sort((a, b) => a.index - b.index);
      allEmbeddings.push(...sortedData.map((item) => item.embedding));
    }

    return allEmbeddings;
  } catch (error) {
    throw new ExternalServiceError(
      `OpenAI batch embedding generation failed: ${error instanceof Error ? error.message : String(error)}`
    );
  }
}

/**
 * Generate embedding for a single text (uses configured provider)
 */
export async function generateEmbedding(text: string): Promise<number[]> {
  logger.debug('Generating embedding', {
    textLength: text.length,
    provider: config.EMBEDDING_PROVIDER,
  });

  if (config.EMBEDDING_PROVIDER === 'ollama') {
    return generateOllamaEmbedding(text);
  }

  return generateOpenAIEmbedding(text);
}

/**
 * Generate embeddings for multiple texts in batch (uses configured provider)
 */
export async function generateEmbeddings(texts: string[]): Promise<number[][]> {
  if (texts.length === 0) {
    return [];
  }

  logger.debug('Generating batch embeddings', {
    count: texts.length,
    provider: config.EMBEDDING_PROVIDER,
  });

  let embeddings: number[][];

  if (config.EMBEDDING_PROVIDER === 'ollama') {
    embeddings = await generateOllamaEmbeddings(texts);
  } else {
    embeddings = await generateOpenAIEmbeddings(texts);
  }

  logger.info('Generated batch embeddings', {
    count: texts.length,
    provider: config.EMBEDDING_PROVIDER,
  });

  return embeddings;
}

// Legacy export for backward compatibility
export function isOpenAIConfigured(): boolean {
  return isEmbeddingsConfigured();
}
