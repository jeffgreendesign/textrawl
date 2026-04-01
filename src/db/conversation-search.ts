import { DatabaseError } from '../utils/errors.js';
import { logger } from '../utils/logger.js';
import { isDatabaseConfigured, pgQuery, queryCount, queryOne } from './pg-client.js';

/**
 * Conversation search result from session summaries
 */
export interface ConversationSearchResult {
	session_id: string;
	session_key: string | null;
	title: string | null;
	summary: string | null;
	turn_count: number;
	last_activity: string;
	score: number;
}

/**
 * Turn search result from conversation turns
 */
export interface TurnSearchResult {
	turn_id: string;
	session_id: string;
	role: string;
	content: string;
	turn_index: number;
	created_at: string;
	score: number;
}

/**
 * Perform a pure semantic (vector similarity) search across conversation session
 * summaries using the `conversation_semantic_search` database function.
 *
 * @param queryEmbedding - The vector embedding of the search query
 * @param options - Search configuration options
 * @param options.limit - Maximum number of results to return (default: 10)
 * @returns An array of conversation search results ranked by cosine similarity
 * @throws {DatabaseError} If the database is not configured or the search fails
 */
export async function semanticConversationSearch(
	queryEmbedding: number[],
	options: {
		limit?: number;
	} = {},
): Promise<ConversationSearchResult[]> {
	if (!isDatabaseConfigured()) {
		throw new DatabaseError('Database not configured');
	}

	const { limit = 10 } = options;

	try {
		const { rows } = await pgQuery<ConversationSearchResult>(
			'SELECT * FROM conversation_semantic_search($1::vector, $2)',
			[JSON.stringify(queryEmbedding), limit],
		);

		logger.debug('Semantic conversation search completed', {
			resultCount: rows.length,
		});

		return rows;
	} catch (err) {
		const message = err instanceof Error ? err.message : String(err);
		logger.error('Semantic conversation search failed', { error: message });
		throw new DatabaseError('Semantic conversation search failed');
	}
}

/**
 * Perform a hybrid search across conversation session summaries combining full-text
 * search and vector similarity using Reciprocal Rank Fusion (RRF) via the
 * `conversation_hybrid_search` database function.
 *
 * @param queryText - The raw text query used for full-text search
 * @param queryEmbedding - The vector embedding of the query for semantic search
 * @param options - Search configuration options
 * @param options.limit - Maximum number of results to return (default: 10)
 * @param options.fullTextWeight - Weight applied to full-text search scores in RRF (default: 1.0)
 * @param options.semanticWeight - Weight applied to semantic search scores in RRF (default: 1.0)
 * @returns An array of conversation search results ranked by fused RRF score
 * @throws {DatabaseError} If the database is not configured or the search fails
 */
export async function hybridConversationSearch(
	queryText: string,
	queryEmbedding: number[],
	options: {
		limit?: number;
		fullTextWeight?: number;
		semanticWeight?: number;
	} = {},
): Promise<ConversationSearchResult[]> {
	if (!isDatabaseConfigured()) {
		throw new DatabaseError('Database not configured');
	}

	const { limit = 10, fullTextWeight = 1.0, semanticWeight = 1.0 } = options;

	try {
		const { rows } = await pgQuery<ConversationSearchResult>(
			'SELECT * FROM conversation_hybrid_search($1, $2::vector, $3, $4, $5, $6)',
			[queryText, JSON.stringify(queryEmbedding), limit, fullTextWeight, semanticWeight, 60],
		);

		logger.debug('Hybrid conversation search completed', {
			queryTextLength: queryText.length,
			resultCount: rows.length,
		});

		return rows;
	} catch (err) {
		const message = err instanceof Error ? err.message : String(err);
		logger.error('Hybrid conversation search failed', { error: message });
		throw new DatabaseError('Hybrid conversation search failed');
	}
}

/**
 * Search within individual conversation turns (messages) using hybrid full-text
 * and semantic search via the `conversation_turn_search` database function.
 * Optionally filter to a specific session.
 *
 * @param queryText - The raw text query used for full-text search
 * @param queryEmbedding - The vector embedding of the query for semantic search
 * @param options - Search configuration options
 * @param options.limit - Maximum number of results to return (default: 20)
 * @param options.sessionId - Optional session UUID to restrict search to a single conversation
 * @param options.fullTextWeight - Weight applied to full-text search scores in RRF (default: 1.0)
 * @param options.semanticWeight - Weight applied to semantic search scores in RRF (default: 1.0)
 * @returns An array of turn search results ranked by fused RRF score
 * @throws {DatabaseError} If the database is not configured or the search fails
 */
export async function searchConversationTurns(
	queryText: string,
	queryEmbedding: number[],
	options: {
		limit?: number;
		sessionId?: string;
		fullTextWeight?: number;
		semanticWeight?: number;
	} = {},
): Promise<TurnSearchResult[]> {
	if (!isDatabaseConfigured()) {
		throw new DatabaseError('Database not configured');
	}

	const { limit = 20, sessionId, fullTextWeight = 1.0, semanticWeight = 1.0 } = options;

	try {
		const { rows } = await pgQuery<TurnSearchResult>(
			'SELECT * FROM conversation_turn_search($1, $2::vector, $3, $4, $5, $6, $7)',
			[
				queryText,
				JSON.stringify(queryEmbedding),
				limit,
				fullTextWeight,
				semanticWeight,
				60,
				sessionId || null,
			],
		);

		logger.debug('Conversation turn search completed', {
			queryTextLength: queryText.length,
			resultCount: rows.length,
			filteredBySession: !!sessionId,
		});

		return rows;
	} catch (err) {
		const message = err instanceof Error ? err.message : String(err);
		logger.error('Conversation turn search failed', { error: message });
		throw new DatabaseError('Conversation turn search failed');
	}
}

/**
 * Retrieve recent conversation sessions ordered by last activity, without any
 * search ranking. Results are mapped to the search result format with a score of 0.
 *
 * @param options - Pagination options
 * @param options.limit - Maximum number of sessions to return (default: 20)
 * @param options.offset - Number of sessions to skip for pagination (default: 0)
 * @returns An object with the sessions array and total count for pagination
 * @throws {DatabaseError} If the database is not configured or the query fails
 */
export async function getRecentConversations(options: {
	limit?: number;
	offset?: number;
}): Promise<{
	sessions: ConversationSearchResult[];
	total: number;
}> {
	if (!isDatabaseConfigured()) {
		throw new DatabaseError('Database not configured');
	}

	const { limit = 20, offset = 0 } = options;

	try {
		const [{ rows }, total] = await Promise.all([
			pgQuery<{
				id: string;
				session_key: string | null;
				title: string | null;
				summary: string | null;
				turn_count: number;
				last_activity: string;
			}>(
				`SELECT id, session_key, title, summary, turn_count, last_activity
				FROM conversation_sessions
				ORDER BY last_activity DESC
				LIMIT $1 OFFSET $2`,
				[limit, offset],
			),
			queryCount('SELECT count(*) FROM conversation_sessions'),
		]);

		const sessions = rows.map((session) => ({
			session_id: session.id,
			session_key: session.session_key,
			title: session.title,
			summary: session.summary,
			turn_count: session.turn_count,
			last_activity: session.last_activity,
			score: 0,
		}));

		return { sessions, total };
	} catch (err) {
		if (err instanceof DatabaseError) throw err;
		const message = err instanceof Error ? err.message : String(err);
		logger.error('Failed to get recent conversations', { error: message });
		throw new DatabaseError('Failed to get recent conversations');
	}
}

/**
 * Retrieve a full conversation context including the session metadata and its
 * associated turns ordered by turn index. Returns `null` if the session does not exist.
 *
 * @param sessionId - The UUID of the conversation session
 * @param options - Options for limiting turn retrieval
 * @param options.maxTurns - Maximum number of turns to return (default: 50)
 * @returns The session with its turns, or `null` if the session is not found
 * @throws {DatabaseError} If the database is not configured or any query fails
 */
export async function getConversationWithTurns(
	sessionId: string,
	options: {
		maxTurns?: number;
	} = {},
): Promise<{
	session: {
		id: string;
		session_key: string | null;
		title: string | null;
		summary: string | null;
		turn_count: number;
		last_activity: string;
		created_at: string;
	};
	turns: Array<{
		id: string;
		role: string;
		content: string;
		turn_index: number;
		created_at: string;
	}>;
} | null> {
	if (!isDatabaseConfigured()) {
		throw new DatabaseError('Database not configured');
	}

	const { maxTurns = 50 } = options;

	try {
		// Get session
		const session = await queryOne<{
			id: string;
			session_key: string | null;
			title: string | null;
			summary: string | null;
			turn_count: number;
			last_activity: string;
			created_at: string;
		}>(
			`SELECT id, session_key, title, summary, turn_count, last_activity, created_at
			FROM conversation_sessions
			WHERE id = $1`,
			[sessionId],
		);

		if (!session) {
			return null;
		}

		// Get turns
		const { rows: turns } = await pgQuery<{
			id: string;
			role: string;
			content: string;
			turn_index: number;
			created_at: string;
		}>(
			`SELECT id, role, content, turn_index, created_at
			FROM conversation_turns
			WHERE session_id = $1
			ORDER BY turn_index ASC
			LIMIT $2`,
			[sessionId, maxTurns],
		);

		return { session, turns };
	} catch (err) {
		if (err instanceof DatabaseError) throw err;
		const message = err instanceof Error ? err.message : String(err);
		logger.error('Failed to get conversation with turns', { error: message });
		throw new DatabaseError('Failed to get conversation');
	}
}

/**
 * Gather aggregate statistics about conversation search readiness, including total
 * session and turn counts and how many have embeddings for search.
 *
 * @returns Statistics with total sessions/turns and counts of those with embeddings
 * @throws {DatabaseError} If the database is not configured or any of the underlying queries fail
 */
export async function getConversationSearchStats(): Promise<{
	totalSessions: number;
	sessionsWithSummary: number;
	totalTurns: number;
	turnsWithEmbedding: number;
}> {
	if (!isDatabaseConfigured()) {
		throw new DatabaseError('Database not configured');
	}

	try {
		const [totalSessions, sessionsWithSummary, totalTurns, turnsWithEmbedding] = await Promise.all([
			queryCount('SELECT count(*) FROM conversation_sessions'),
			queryCount('SELECT count(*) FROM conversation_sessions WHERE summary_embedding IS NOT NULL'),
			queryCount('SELECT count(*) FROM conversation_turns'),
			queryCount('SELECT count(*) FROM conversation_turns WHERE embedding IS NOT NULL'),
		]);

		return { totalSessions, sessionsWithSummary, totalTurns, turnsWithEmbedding };
	} catch (err) {
		if (err instanceof DatabaseError) throw err;
		const message = err instanceof Error ? err.message : String(err);
		logger.error('Failed to get conversation stats', { error: message });
		throw new DatabaseError('Failed to get conversation stats');
	}
}
