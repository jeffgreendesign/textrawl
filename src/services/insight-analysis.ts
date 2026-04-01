import { randomUUID } from 'node:crypto';
import Anthropic from '@anthropic-ai/sdk';
import {
	type CreateInsightInput,
	createInsights,
	setInsightQueueProcessing,
} from '../db/insights.js';
import { isDatabaseConfigured, pgQuery, queryOne } from '../db/pg-client.js';
import type { SearchResult } from '../types/database.js';
import { config } from '../utils/config.js';
import { logger } from '../utils/logger.js';
import { generateEmbedding, isEmbeddingsConfigured } from './embeddings.js';

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

interface ChunkWithContext {
	id: string;
	document_id: string;
	document_title: string;
	content: string;
	source_type: string;
	content_type: string | null;
	embedding: number[];
	created_at: string;
}

interface ConnectionPair {
	a: ChunkWithContext;
	b: ChunkWithContext;
	similarity: number;
}

interface LLMInsight {
	type: 'cross_source' | 'theme_cluster' | 'entity_bridge' | 'temporal_pattern' | 'outlier';
	title: string;
	summary: string;
	entities: string[];
}

// ---------------------------------------------------------------------------
// Configuration
// ---------------------------------------------------------------------------

/** Minimum cosine similarity to consider two chunks "connected" */
const CONNECTION_THRESHOLD = 0.78;

/** Maximum pairs to send to LLM for synthesis */
const MAX_PAIRS_FOR_LLM = 15;

/** Minimum similarity gap between a chunk and its nearest neighbor to flag as outlier */
const OUTLIER_MAX_SIMILARITY = 0.65;

// ---------------------------------------------------------------------------
// Core analysis pipeline
// ---------------------------------------------------------------------------

/**
 * Run a full insight scan on recently inserted chunks.
 *
 * Steps:
 *   1. Fetch recent chunks (since last scan)
 *   2. For each, find nearest neighbors from OTHER documents/sources
 *   3. Identify cross-source connections (high similarity, different source)
 *   4. Identify outliers (low max similarity to anything)
 *   5. Send interesting pairs to LLM for natural-language insight synthesis
 *   6. Store insights with embeddings
 */
export async function runInsightScan(options?: {
	/** Override: analyze all chunks, not just recent */
	fullScan?: boolean;
	/** Max recent chunks to analyze (default 200) */
	maxChunks?: number;
}): Promise<{ insightsCreated: number; chunksAnalyzed: number; batchId: string }> {
	const batchId = randomUUID();
	const maxChunks = options?.maxChunks ?? 200;

	logger.info('Starting insight scan', { batchId, fullScan: options?.fullScan, maxChunks });

	if (!isDatabaseConfigured() || !isEmbeddingsConfigured()) {
		throw new Error('Supabase and embeddings must be configured for insight analysis');
	}

	try {
		await setInsightQueueProcessing(true);

		// 1. Fetch recent chunks with document context
		const recentChunks = await fetchRecentChunks(maxChunks, options?.fullScan);
		if (recentChunks.length === 0) {
			logger.info('No chunks to analyze');
			await setInsightQueueProcessing(false);
			return { insightsCreated: 0, chunksAnalyzed: 0, batchId };
		}

		logger.info('Fetched chunks for analysis', { count: recentChunks.length });

		// 2. Find cross-source connections
		const connections = await findCrossSourceConnections(recentChunks);
		logger.info('Found cross-source connections', { count: connections.length });

		// 3. Find outliers
		const outliers = await findOutliers(recentChunks);
		logger.info('Found outliers', { count: outliers.length });

		// 4. Synthesize insights via LLM
		const insights: CreateInsightInput[] = [];

		if (connections.length > 0 || outliers.length > 0) {
			const llmInsights = await synthesizeInsights(connections, outliers);

			// 5. Generate embeddings for insights and store
			for (const insight of llmInsights) {
				const embedding = await generateEmbedding(`${insight.title} ${insight.summary}`);

				// Build evidence from the pairs that contributed to this insight
				const evidence = buildEvidence(insight, connections, outliers);

				insights.push({
					insightType: insight.type,
					title: insight.title,
					summary: insight.summary,
					evidence,
					entities: insight.entities,
					embedding,
					batchId,
				});
			}
		}

		// 6. Store insights
		if (insights.length > 0) {
			await createInsights(insights);
		}

		await setInsightQueueProcessing(false);

		logger.info('Insight scan complete', {
			batchId,
			chunksAnalyzed: recentChunks.length,
			insightsCreated: insights.length,
		});

		return {
			insightsCreated: insights.length,
			chunksAnalyzed: recentChunks.length,
			batchId,
		};
	} catch (error) {
		await setInsightQueueProcessing(false);
		logger.error('Insight scan failed', {
			error: error instanceof Error ? error.message : String(error),
		});
		throw error;
	}
}

// ---------------------------------------------------------------------------
// Data fetching
// ---------------------------------------------------------------------------

async function fetchRecentChunks(limit: number, fullScan?: boolean): Promise<ChunkWithContext[]> {
	const conditions = ['c.embedding IS NOT NULL'];
	const params: unknown[] = [];
	let paramIdx = 1;

	if (!fullScan) {
		const queue = await queryOne<{ last_scan_at: string | null }>(
			'SELECT last_scan_at FROM insight_queue WHERE id = 1',
		);
		if (queue?.last_scan_at) {
			conditions.push(`c.created_at > $${paramIdx}`);
			params.push(queue.last_scan_at);
			paramIdx++;
		}
	}

	params.push(limit);
	const sql = `
		SELECT c.id, c.document_id, c.content, c.embedding, c.created_at, c.metadata,
			d.title AS document_title, d.source_type, d.metadata AS document_metadata
		FROM chunks c
		JOIN documents d ON c.document_id = d.id
		WHERE ${conditions.join(' AND ')}
		ORDER BY c.created_at DESC
		LIMIT $${paramIdx}
	`;

	try {
		const { rows } = await pgQuery<Record<string, unknown>>(sql, params);
		return rows.map((row) => {
			const docMeta = (row.document_metadata ?? {}) as Record<string, unknown>;
			return {
				id: row.id as string,
				document_id: row.document_id as string,
				document_title: (row.document_title ?? 'Untitled') as string,
				content: row.content as string,
				source_type: (row.source_type ?? 'note') as string,
				content_type: (docMeta?.content_type as string) ?? null,
				embedding: row.embedding as number[],
				created_at: row.created_at as string,
			};
		});
	} catch (error) {
		logger.error('Failed to fetch chunks for analysis', {
			error: error instanceof Error ? error.message : String(error),
		});
		throw new Error('Failed to fetch chunks');
	}
}

// ---------------------------------------------------------------------------
// Connection detection
// ---------------------------------------------------------------------------

function cosineSimilarity(a: number[], b: number[]): number {
	let dot = 0;
	let normA = 0;
	let normB = 0;
	for (let i = 0; i < a.length; i++) {
		dot += a[i] * b[i];
		normA += a[i] * a[i];
		normB += b[i] * b[i];
	}
	return dot / (Math.sqrt(normA) * Math.sqrt(normB));
}

async function findCrossSourceConnections(chunks: ChunkWithContext[]): Promise<ConnectionPair[]> {
	const connections: ConnectionPair[] = [];

	// For each recent chunk, find similar chunks from DIFFERENT documents
	// Use the DB for efficiency on large datasets

	for (const chunk of chunks) {
		if (!chunk.embedding) continue;

		// Semantic search for nearest neighbors (excluding same document)
		let matches: SearchResult[];
		try {
			const result = await pgQuery<SearchResult>('SELECT * FROM semantic_search($1::vector, $2)', [
				JSON.stringify(chunk.embedding),
				5,
			]);
			matches = result.rows;
		} catch (error) {
			logger.error('Semantic search failed during insight scan', {
				error: error instanceof Error ? error.message : String(error),
			});
			continue;
		}

		for (const match of matches) {
			// Skip same document
			if (match.document_id === chunk.document_id) continue;

			const similarity = match.score ?? 0;
			if (similarity >= CONNECTION_THRESHOLD) {
				connections.push({
					a: chunk,
					b: {
						id: match.chunk_id,
						document_id: match.document_id,
						document_title: match.document_title,
						content: match.content,
						source_type: match.source_type,
						content_type: (match.document_metadata?.content_type as string) ?? null,
						embedding: [],
						created_at: '',
					},
					similarity,
				});
			}
		}
	}

	// Deduplicate (A→B and B→A)
	const seen = new Set<string>();
	return connections.filter((c) => {
		const key = [c.a.id, c.b.id].sort().join(':');
		if (seen.has(key)) return false;
		seen.add(key);
		return true;
	});
}

async function findOutliers(chunks: ChunkWithContext[]): Promise<ChunkWithContext[]> {
	const outliers: ChunkWithContext[] = [];

	for (const chunk of chunks) {
		if (!chunk.embedding) continue;

		let searchResults: SearchResult[];
		try {
			const result = await pgQuery<SearchResult>('SELECT * FROM semantic_search($1::vector, $2)', [
				JSON.stringify(chunk.embedding),
				3,
			]);
			searchResults = result.rows;
		} catch {
			continue;
		}

		// Filter out same-document matches
		const otherDocMatches = searchResults.filter((m) => m.document_id !== chunk.document_id);

		// If best match from another document is low similarity, it's an outlier
		const bestScore = otherDocMatches[0]?.score ?? 0;
		if (bestScore < OUTLIER_MAX_SIMILARITY) {
			outliers.push(chunk);
		}
	}

	return outliers;
}

// ---------------------------------------------------------------------------
// LLM synthesis
// ---------------------------------------------------------------------------

const INSIGHT_SYNTHESIS_PROMPT = `You are analyzing a personal knowledge base to find interesting, non-obvious insights.

You will be given two types of data:
1. CONNECTIONS: Pairs of text chunks from different documents/sources that are semantically similar
2. OUTLIERS: Chunks that are unlike anything else in the knowledge base

For each meaningful pattern you find, produce an insight. Focus on:
- Unexpected connections between different parts of someone's life (e.g., a work email echoes a personal interest)
- Recurring themes the person may not have noticed
- Entities (people, places, concepts) that bridge different contexts
- Topics that reappear across time periods
- Unique or unusual content that stands out

Respond with a JSON array of insights:
[
  {
    "type": "cross_source" | "theme_cluster" | "entity_bridge" | "temporal_pattern" | "outlier",
    "title": "Short descriptive title (max 100 chars)",
    "summary": "2-3 sentence explanation of what's interesting and why it matters",
    "entities": ["entity names mentioned"]
  }
]

Rules:
- Only produce insights that are genuinely interesting or surprising
- Don't state obvious things (e.g., "you sent emails about work")
- Be specific — reference actual content, not vague patterns
- If nothing interesting exists, return an empty array []
- Maximum 10 insights per analysis
- Write in second person ("You mentioned...", "Your emails show...")`;

async function synthesizeInsights(
	connections: ConnectionPair[],
	outliers: ChunkWithContext[],
): Promise<LLMInsight[]> {
	if (!config.ANTHROPIC_API_KEY) {
		// Fall back to rule-based insights without LLM
		return generateRuleBasedInsights(connections, outliers);
	}

	const anthropic = new Anthropic({ apiKey: config.ANTHROPIC_API_KEY });

	// Build context for the LLM
	const parts: string[] = [];

	if (connections.length > 0) {
		parts.push('## CONNECTIONS\n');
		const topConnections = connections
			.sort((a, b) => b.similarity - a.similarity)
			.slice(0, MAX_PAIRS_FOR_LLM);

		for (const conn of topConnections) {
			parts.push(`### Similarity: ${conn.similarity.toFixed(3)}`);
			parts.push(
				`**Document A:** "${conn.a.document_title}" (${conn.a.source_type}${conn.a.content_type ? `/${conn.a.content_type}` : ''})`,
			);
			parts.push(`> ${conn.a.content.slice(0, 500)}\n`);
			parts.push(
				`**Document B:** "${conn.b.document_title}" (${conn.b.source_type}${conn.b.content_type ? `/${conn.b.content_type}` : ''})`,
			);
			parts.push(`> ${conn.b.content.slice(0, 500)}\n---\n`);
		}
	}

	if (outliers.length > 0) {
		parts.push('## OUTLIERS\n');
		for (const outlier of outliers.slice(0, 10)) {
			parts.push(
				`**"${outlier.document_title}"** (${outlier.source_type}${outlier.content_type ? `/${outlier.content_type}` : ''})`,
			);
			parts.push(`> ${outlier.content.slice(0, 500)}\n---\n`);
		}
	}

	try {
		const response = await anthropic.messages.create({
			model: config.INSIGHT_MODEL,
			max_tokens: 2000,
			system: INSIGHT_SYNTHESIS_PROMPT,
			messages: [{ role: 'user', content: parts.join('\n') }],
		});

		const text = response.content
			.filter((b): b is Anthropic.TextBlock => b.type === 'text')
			.map((b) => b.text)
			.join('');

		// Parse JSON from response
		const jsonMatch = text.match(/\[[\s\S]*\]/);
		if (!jsonMatch) {
			logger.error('LLM insight response did not contain JSON array');
			return generateRuleBasedInsights(connections, outliers);
		}

		const parsed = JSON.parse(jsonMatch[0]) as LLMInsight[];
		return parsed.filter((i) => i.type && i.title && i.summary && Array.isArray(i.entities));
	} catch (error) {
		logger.error('LLM insight synthesis failed', {
			error: error instanceof Error ? error.message : String(error),
		});
		return generateRuleBasedInsights(connections, outliers);
	}
}

/** Fallback: generate basic insights without LLM */
function generateRuleBasedInsights(
	connections: ConnectionPair[],
	outliers: ChunkWithContext[],
): LLMInsight[] {
	const insights: LLMInsight[] = [];

	// Group connections by source type pairs
	const crossSourcePairs = connections.filter(
		(c) => c.a.source_type !== c.b.source_type || c.a.content_type !== c.b.content_type,
	);

	if (crossSourcePairs.length > 0) {
		const top = crossSourcePairs.sort((a, b) => b.similarity - a.similarity)[0];
		insights.push({
			type: 'cross_source',
			title: `Connection between "${top.a.document_title}" and "${top.b.document_title}"`,
			summary: `Found ${crossSourcePairs.length} cross-source connection(s). The strongest link (${(top.similarity * 100).toFixed(0)}% similarity) connects content from ${top.a.source_type} and ${top.b.source_type}.`,
			entities: [],
		});
	}

	// Same-source connections (theme clusters)
	const sameSourcePairs = connections.filter(
		(c) => c.a.source_type === c.b.source_type && c.a.document_id !== c.b.document_id,
	);

	if (sameSourcePairs.length >= 3) {
		insights.push({
			type: 'theme_cluster',
			title: `Recurring theme across ${sameSourcePairs.length} document pairs`,
			summary:
				'Multiple documents share similar content, suggesting a recurring theme or topic you revisit frequently.',
			entities: [],
		});
	}

	if (outliers.length > 0) {
		for (const outlier of outliers.slice(0, 3)) {
			insights.push({
				type: 'outlier',
				title: `Unique content: "${outlier.document_title}"`,
				summary:
					'This content is unlike anything else in your knowledge base. It may represent a unique interest, a one-time event, or a topic worth exploring further.',
				entities: [],
			});
		}
	}

	return insights;
}

// ---------------------------------------------------------------------------
// Evidence builder
// ---------------------------------------------------------------------------

function buildEvidence(
	insight: LLMInsight,
	connections: ConnectionPair[],
	outliers: ChunkWithContext[],
): CreateInsightInput['evidence'] {
	const evidence: CreateInsightInput['evidence'] = [];

	if (insight.type === 'outlier') {
		for (const o of outliers.slice(0, 3)) {
			evidence.push({
				chunkId: o.id,
				documentId: o.document_id,
				documentTitle: o.document_title,
				content: o.content.slice(0, 300),
				score: 0,
				sourceType: o.source_type,
			});
		}
	} else {
		// Use top connections as evidence
		const top = connections.sort((a, b) => b.similarity - a.similarity).slice(0, 5);

		for (const conn of top) {
			evidence.push({
				chunkId: conn.a.id,
				documentId: conn.a.document_id,
				documentTitle: conn.a.document_title,
				content: conn.a.content.slice(0, 300),
				score: conn.similarity,
				sourceType: conn.a.source_type,
			});
			evidence.push({
				chunkId: conn.b.id,
				documentId: conn.b.document_id,
				documentTitle: conn.b.document_title,
				content: conn.b.content.slice(0, 300),
				score: conn.similarity,
				sourceType: conn.b.source_type,
			});
		}
	}

	return evidence;
}
