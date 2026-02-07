import OpenAI from 'openai';
import { config } from '../utils/config.js';
import { ExternalServiceError } from '../utils/errors.js';
import { logger } from '../utils/logger.js';

// Provider-specific constants
const OPENAI_MODEL = 'text-embedding-3-small';
const OPENAI_DIMENSIONS = 1536;
const OPENAI_MAX_BATCH_SIZE = 2048;
// OpenAI enforces a max of 300K tokens per embedding request.
// Use a conservative limit to stay safely under the cap.
const OPENAI_MAX_BATCH_TOKENS = 250_000;
// text-embedding-3-small accepts max 8191 tokens per input.
// Truncate at a conservative character limit (~4 chars/token).
const OPENAI_MAX_INPUT_CHARS = 8191 * 4;

const OLLAMA_MAX_BATCH_SIZE = 100;

// Ollama model context windows (max tokens per input)
// Used to truncate oversized inputs before sending to the API.
// Ollama silently truncates, so without this you lose data without warning.
const OLLAMA_MODEL_CONTEXT: Record<string, number> = {
	'nomic-embed-text-v2-moe': 8192,
	'nomic-embed-text': 8192,
	'mxbai-embed-large': 512,
	default: 2048,
};

// Ollama model dimensions mapping
// Models with different embedding dimensions need different database schemas
const OLLAMA_MODEL_DIMENSIONS: Record<string, number> = {
	// V2 MoE models (768 dimensions, Matryoshka support)
	'nomic-embed-text-v2-moe': 768,
	// V1 models (1024 dimensions)
	'nomic-embed-text': 1024,
	'nomic-embed-text:latest': 1024,
	'mxbai-embed-large': 1024,
	'mxbai-embed-large:latest': 1024,
	// Default for unknown models
	default: 1024,
};

/**
 * Get max input characters for an Ollama model (~4 chars/token)
 */
function getOllamaMaxInputChars(model: string): number {
	const baseModel = model.split(':')[0];
	const tokens =
		OLLAMA_MODEL_CONTEXT[model] ?? OLLAMA_MODEL_CONTEXT[baseModel] ?? OLLAMA_MODEL_CONTEXT.default;
	return tokens * 4;
}

/**
 * Get embedding dimensions for an Ollama model
 */
function getOllamaDimensions(model: string): number {
	// Check for exact match first
	if (model in OLLAMA_MODEL_DIMENSIONS) {
		return OLLAMA_MODEL_DIMENSIONS[model];
	}
	// Check for partial match (handles tags like :latest, :q4_0, etc.)
	const baseModel = model.split(':')[0];
	if (baseModel in OLLAMA_MODEL_DIMENSIONS) {
		return OLLAMA_MODEL_DIMENSIONS[baseModel];
	}
	// V2 MoE detection by pattern
	if (model.includes('v2-moe') || model.includes('v2_moe')) {
		return 768;
	}
	return OLLAMA_MODEL_DIMENSIONS.default;
}

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
		return getOllamaDimensions(config.OLLAMA_MODEL);
	}
	return OPENAI_DIMENSIONS;
}

/**
 * Get the OpenAI client instance (singleton pattern)
 */
function getOpenAIClient(): OpenAI {
	if (!config.OPENAI_API_KEY) {
		throw new ExternalServiceError('OpenAI API key not configured. Set OPENAI_API_KEY.');
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
	const maxChars = getOllamaMaxInputChars(config.OLLAMA_MODEL);
	const input = text.length > maxChars ? text.slice(0, maxChars) : text;

	try {
		const response = await fetch(url, {
			method: 'POST',
			headers: { 'Content-Type': 'application/json' },
			body: JSON.stringify({
				model: config.OLLAMA_MODEL,
				input,
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
				`Cannot connect to Ollama at ${config.OLLAMA_BASE_URL}. Is Ollama running?`,
			);
		}
		throw new ExternalServiceError(
			`Ollama embedding failed: ${error instanceof Error ? error.message : String(error)}`,
		);
	}
}

/**
 * Generate embeddings for multiple texts using Ollama
 */
async function generateOllamaEmbeddings(texts: string[]): Promise<number[][]> {
	const url = `${config.OLLAMA_BASE_URL}/api/embed`;
	const maxChars = getOllamaMaxInputChars(config.OLLAMA_MODEL);

	// Truncate oversized inputs before batching
	const safeTexts = texts.map((t) => (t.length > maxChars ? t.slice(0, maxChars) : t));

	const batches: string[][] = [];
	for (let i = 0; i < safeTexts.length; i += OLLAMA_MAX_BATCH_SIZE) {
		batches.push(safeTexts.slice(i, i + OLLAMA_MAX_BATCH_SIZE));
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
				`Cannot connect to Ollama at ${config.OLLAMA_BASE_URL}. Is Ollama running?`,
			);
		}
		throw new ExternalServiceError(
			`Ollama batch embedding failed: ${error instanceof Error ? error.message : String(error)}`,
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
			`OpenAI embedding generation failed: ${error instanceof Error ? error.message : String(error)}`,
		);
	}
}

/**
 * Generate embeddings for multiple texts using OpenAI
 */
async function generateOpenAIEmbeddings(texts: string[]): Promise<number[][]> {
	const client = getOpenAIClient();

	// Build batches respecting both item count and token limits.
	// Estimate tokens as text.length / 4 (conservative approximation).
	const batches: string[][] = [];
	let currentBatch: string[] = [];
	let currentTokens = 0;

	for (const rawText of texts) {
		// Truncate individual inputs that exceed the model's context window
		const text =
			rawText.length > OPENAI_MAX_INPUT_CHARS ? rawText.slice(0, OPENAI_MAX_INPUT_CHARS) : rawText;
		const estimatedTokens = Math.ceil(text.length / 4);

		if (
			currentBatch.length > 0 &&
			(currentBatch.length >= OPENAI_MAX_BATCH_SIZE ||
				currentTokens + estimatedTokens > OPENAI_MAX_BATCH_TOKENS)
		) {
			batches.push(currentBatch);
			currentBatch = [];
			currentTokens = 0;
		}

		currentBatch.push(text);
		currentTokens += estimatedTokens;
	}
	if (currentBatch.length > 0) {
		batches.push(currentBatch);
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
			`OpenAI batch embedding generation failed: ${error instanceof Error ? error.message : String(error)}`,
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
