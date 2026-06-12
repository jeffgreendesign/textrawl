import { GoogleGenerativeAI } from '@google/generative-ai';
import OpenAI from 'openai';
import { config } from '../utils/config.js';
import { ExternalServiceError } from '../utils/errors.js';
import { logger } from '../utils/logger.js';

// Provider-specific constants
const OPENAI_MODEL = 'text-embedding-3-small';
const OPENAI_DIMENSIONS = 1536;
const OPENAI_MAX_BATCH_SIZE = 2048;
// OpenAI enforces a max of 300K tokens per embedding request. The per-chunk token
// count is only ESTIMATED from character length (see OPENAI_EST_CHARS_PER_TOKEN), and
// dense content (JSON: timestamps, numbers, punctuation) tokenizes well above the
// estimate — a batch estimated at 250K was really >300K and got rejected. Keep a wide
// margin so the worst-case actual count stays under the hard cap.
const OPENAI_MAX_BATCH_TOKENS = 200_000;
// Conservative chars-per-token for batch sizing. English prose is ~4; dense JSON is
// ~3.3. Estimating low (3) over-counts tokens so batches split sooner and the real
// request stays under OpenAI's 300K limit.
const OPENAI_EST_CHARS_PER_TOKEN = 3;
// text-embedding-3-small accepts max 8191 tokens per input.
// Truncate at a conservative character limit (~4 chars/token).
const OPENAI_MAX_INPUT_CHARS = 8191 * 4;

const OLLAMA_MAX_BATCH_SIZE = 100;
// Aggregate token ceiling per request. Like OpenAI (see OPENAI_MAX_BATCH_TOKENS),
// item-count alone is not enough: 100 dense items can be a multi-million-char
// request that bloats memory and risks server limits. Split by tokens too.
const OLLAMA_MAX_BATCH_TOKENS = 200_000;
const OLLAMA_EST_CHARS_PER_TOKEN = 3;

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

// Google AI constants
const GOOGLE_DIMENSIONS = 3072;
const GOOGLE_MAX_BATCH_SIZE = 100;
const GOOGLE_MAX_INPUT_CHARS = 30_000; // gemini-embedding-2-preview: 8192 token context (~4 chars/token)
// Aggregate token ceiling per batchEmbedContents request (see OPENAI_MAX_BATCH_TOKENS).
const GOOGLE_MAX_BATCH_TOKENS = 200_000;
const GOOGLE_EST_CHARS_PER_TOKEN = 3;

/**
 * Group inputs into batches bounded by BOTH an item count and an aggregate
 * estimated-token ceiling (tokens ≈ chars / `charsPerToken`). Mirrors the
 * OpenAI batcher so every provider splits dense content before it exceeds a
 * per-request limit. Inputs are assumed already per-item truncated.
 */
export function buildTokenBoundedBatches(
	texts: string[],
	maxItems: number,
	maxTokens: number,
	charsPerToken: number,
): string[][] {
	const batches: string[][] = [];
	let current: string[] = [];
	let currentTokens = 0;

	for (const text of texts) {
		const estimatedTokens = Math.ceil(text.length / charsPerToken);
		if (
			current.length > 0 &&
			(current.length >= maxItems || currentTokens + estimatedTokens > maxTokens)
		) {
			batches.push(current);
			current = [];
			currentTokens = 0;
		}
		current.push(text);
		currentTokens += estimatedTokens;
	}
	if (current.length > 0) {
		batches.push(current);
	}
	return batches;
}

// Ollama API response type
interface OllamaEmbedResponse {
	embeddings?: number[][];
}

let openai: OpenAI | null = null;
let googleAI: GoogleGenerativeAI | null = null;

/**
 * Get embedding dimensions for the configured provider
 */
export function getEmbeddingDimensions(): number {
	if (config.EMBEDDING_PROVIDER === 'ollama') {
		return getOllamaDimensions(config.OLLAMA_MODEL);
	}
	if (config.EMBEDDING_PROVIDER === 'google') {
		return GOOGLE_DIMENSIONS;
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
 * Get the Google AI client instance (singleton pattern)
 */
function getGoogleClient(): GoogleGenerativeAI {
	if (!config.GOOGLE_AI_API_KEY) {
		throw new ExternalServiceError('Google AI API key not configured. Set GOOGLE_AI_API_KEY.');
	}

	if (!googleAI) {
		googleAI = new GoogleGenerativeAI(config.GOOGLE_AI_API_KEY);
		logger.info('Google AI client initialized');
	}

	return googleAI;
}

/**
 * Check if embeddings are configured (OpenAI, Ollama, or Google)
 */
export function isEmbeddingsConfigured(): boolean {
	if (config.EMBEDDING_PROVIDER === 'ollama') {
		return true; // Ollama just needs to be running
	}
	if (config.EMBEDDING_PROVIDER === 'google') {
		return !!config.GOOGLE_AI_API_KEY;
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

	const batches = buildTokenBoundedBatches(
		safeTexts,
		OLLAMA_MAX_BATCH_SIZE,
		OLLAMA_MAX_BATCH_TOKENS,
		OLLAMA_EST_CHARS_PER_TOKEN,
	);

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
	// Tokens are estimated from char length (OPENAI_EST_CHARS_PER_TOKEN).
	const batches: string[][] = [];
	let currentBatch: string[] = [];
	let currentTokens = 0;

	for (const rawText of texts) {
		// Truncate individual inputs that exceed the model's context window
		const text =
			rawText.length > OPENAI_MAX_INPUT_CHARS ? rawText.slice(0, OPENAI_MAX_INPUT_CHARS) : rawText;
		const estimatedTokens = Math.ceil(text.length / OPENAI_EST_CHARS_PER_TOKEN);

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
 * Generate embedding using Google AI
 */
async function generateGoogleEmbedding(text: string): Promise<number[]> {
	const client = getGoogleClient();
	const model = client.getGenerativeModel({ model: config.GOOGLE_EMBEDDING_MODEL });
	const input = text.length > GOOGLE_MAX_INPUT_CHARS ? text.slice(0, GOOGLE_MAX_INPUT_CHARS) : text;

	try {
		const result = await model.embedContent(input);
		return result.embedding.values;
	} catch (error) {
		throw new ExternalServiceError(
			`Google AI embedding failed: ${error instanceof Error ? error.message : String(error)}`,
		);
	}
}

/**
 * Generate embeddings for multiple texts using Google AI
 */
async function generateGoogleEmbeddings(texts: string[]): Promise<number[][]> {
	const client = getGoogleClient();
	const model = client.getGenerativeModel({ model: config.GOOGLE_EMBEDDING_MODEL });

	// Truncate oversized inputs
	const safeTexts = texts.map((t) =>
		t.length > GOOGLE_MAX_INPUT_CHARS ? t.slice(0, GOOGLE_MAX_INPUT_CHARS) : t,
	);

	const batches = buildTokenBoundedBatches(
		safeTexts,
		GOOGLE_MAX_BATCH_SIZE,
		GOOGLE_MAX_BATCH_TOKENS,
		GOOGLE_EST_CHARS_PER_TOKEN,
	);

	try {
		const allEmbeddings: number[][] = [];

		for (const batch of batches) {
			const result = await model.batchEmbedContents({
				requests: batch.map((text) => ({
					content: { role: 'user', parts: [{ text }] },
				})),
			});
			allEmbeddings.push(...result.embeddings.map((e) => e.values));
		}

		return allEmbeddings;
	} catch (error) {
		throw new ExternalServiceError(
			`Google AI batch embedding failed: ${error instanceof Error ? error.message : String(error)}`,
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
	if (config.EMBEDDING_PROVIDER === 'google') {
		return generateGoogleEmbedding(text);
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
	} else if (config.EMBEDDING_PROVIDER === 'google') {
		embeddings = await generateGoogleEmbeddings(texts);
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
