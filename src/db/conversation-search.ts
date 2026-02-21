import { DatabaseError } from '../utils/errors.js';
import { logger } from '../utils/logger.js';
import { getSupabaseClient, isSupabaseConfigured } from './client.js';

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
 * summaries using the `conversation_semantic_search` Supabase RPC.
 *
 * @param queryEmbedding - The vector embedding of the search query
 * @param options - Search configuration options
 * @param options.limit - Maximum number of results to return (default: 10)
 * @returns An array of conversation search results ranked by cosine similarity
 * @throws {DatabaseError} If Supabase is not configured or the search RPC fails
 */
export async function semanticConversationSearch(
	queryEmbedding: number[],
	options: {
		limit?: number;
	} = {},
): Promise<ConversationSearchResult[]> {
	if (!isSupabaseConfigured()) {
		throw new DatabaseError('Supabase not configured');
	}

	const { limit = 10 } = options;
	const client = getSupabaseClient();

	const { data, error } = await client.rpc('conversation_semantic_search', {
		query_embedding: queryEmbedding,
		match_count: limit,
	});

	if (error) {
		logger.error('Semantic conversation search failed', { error: error.message });
		throw new DatabaseError('Semantic conversation search failed');
	}

	logger.debug('Semantic conversation search completed', {
		resultCount: data?.length || 0,
	});

	return (data || []) as ConversationSearchResult[];
}

/**
 * Perform a hybrid search across conversation session summaries combining full-text
 * search and vector similarity using Reciprocal Rank Fusion (RRF) via the
 * `conversation_hybrid_search` Supabase RPC.
 *
 * @param queryText - The raw text query used for full-text search
 * @param queryEmbedding - The vector embedding of the query for semantic search
 * @param options - Search configuration options
 * @param options.limit - Maximum number of results to return (default: 10)
 * @param options.fullTextWeight - Weight applied to full-text search scores in RRF (default: 1.0)
 * @param options.semanticWeight - Weight applied to semantic search scores in RRF (default: 1.0)
 * @returns An array of conversation search results ranked by fused RRF score
 * @throws {DatabaseError} If Supabase is not configured or the search RPC fails
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
	if (!isSupabaseConfigured()) {
		throw new DatabaseError('Supabase not configured');
	}

	const { limit = 10, fullTextWeight = 1.0, semanticWeight = 1.0 } = options;
	const client = getSupabaseClient();

	const { data, error } = await client.rpc('conversation_hybrid_search', {
		query_text: queryText,
		query_embedding: queryEmbedding,
		match_count: limit,
		full_text_weight: fullTextWeight,
		semantic_weight: semanticWeight,
		rrf_k: 60,
	});

	if (error) {
		logger.error('Hybrid conversation search failed', { error: error.message });
		throw new DatabaseError('Hybrid conversation search failed');
	}

	logger.debug('Hybrid conversation search completed', {
		queryTextLength: queryText.length,
		resultCount: data?.length || 0,
	});

	return (data || []) as ConversationSearchResult[];
}

/**
 * Search within individual conversation turns (messages) using hybrid full-text
 * and semantic search via the `conversation_turn_search` Supabase RPC.
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
 * @throws {DatabaseError} If Supabase is not configured or the search RPC fails
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
	if (!isSupabaseConfigured()) {
		throw new DatabaseError('Supabase not configured');
	}

	const { limit = 20, sessionId, fullTextWeight = 1.0, semanticWeight = 1.0 } = options;
	const client = getSupabaseClient();

	const { data, error } = await client.rpc('conversation_turn_search', {
		query_text: queryText,
		query_embedding: queryEmbedding,
		match_count: limit,
		full_text_weight: fullTextWeight,
		semantic_weight: semanticWeight,
		rrf_k: 60,
		filter_session_id: sessionId || null,
	});

	if (error) {
		logger.error('Conversation turn search failed', { error: error.message });
		throw new DatabaseError('Conversation turn search failed');
	}

	logger.debug('Conversation turn search completed', {
		queryTextLength: queryText.length,
		resultCount: data?.length || 0,
		filteredBySession: !!sessionId,
	});

	return (data || []) as TurnSearchResult[];
}

/**
 * Retrieve recent conversation sessions ordered by last activity, without any
 * search ranking. Results are mapped to the search result format with a score of 0.
 *
 * @param options - Pagination options
 * @param options.limit - Maximum number of sessions to return (default: 20)
 * @param options.offset - Number of sessions to skip for pagination (default: 0)
 * @returns An object with the sessions array and total count for pagination
 * @throws {DatabaseError} If Supabase is not configured or the query fails
 */
export async function getRecentConversations(options: {
	limit?: number;
	offset?: number;
}): Promise<{
	sessions: ConversationSearchResult[];
	total: number;
}> {
	if (!isSupabaseConfigured()) {
		throw new DatabaseError('Supabase not configured');
	}

	const { limit = 20, offset = 0 } = options;
	const client = getSupabaseClient();

	const { data, error, count } = await client
		.from('conversation_sessions')
		.select('id, session_key, title, summary, turn_count, last_activity', { count: 'exact' })
		.order('last_activity', { ascending: false })
		.range(offset, offset + limit - 1);

	if (error) {
		logger.error('Failed to get recent conversations', { error: error.message });
		throw new DatabaseError('Failed to get recent conversations');
	}

	// Map to search result format with score = 0 (not from search)
	const sessions = (data || []).map((session) => ({
		session_id: session.id,
		session_key: session.session_key,
		title: session.title,
		summary: session.summary,
		turn_count: session.turn_count,
		last_activity: session.last_activity,
		score: 0,
	}));

	return {
		sessions,
		total: count || 0,
	};
}

/**
 * Retrieve a full conversation context including the session metadata and its
 * associated turns ordered by turn index. Returns `null` if the session does not exist.
 *
 * @param sessionId - The UUID of the conversation session
 * @param options - Options for limiting turn retrieval
 * @param options.maxTurns - Maximum number of turns to return (default: 50)
 * @returns The session with its turns, or `null` if the session is not found
 * @throws {DatabaseError} If Supabase is not configured or any query fails
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
	if (!isSupabaseConfigured()) {
		throw new DatabaseError('Supabase not configured');
	}

	const { maxTurns = 50 } = options;
	const client = getSupabaseClient();

	// Get session
	const { data: session, error: sessionError } = await client
		.from('conversation_sessions')
		.select('id, session_key, title, summary, turn_count, last_activity, created_at')
		.eq('id', sessionId)
		.maybeSingle();

	if (sessionError) {
		logger.error('Failed to get conversation session', { error: sessionError.message });
		throw new DatabaseError('Failed to get conversation');
	}

	if (!session) {
		return null;
	}

	// Get turns
	const { data: turns, error: turnsError } = await client
		.from('conversation_turns')
		.select('id, role, content, turn_index, created_at')
		.eq('session_id', sessionId)
		.order('turn_index', { ascending: true })
		.limit(maxTurns);

	if (turnsError) {
		logger.error('Failed to get conversation turns', { error: turnsError.message });
		throw new DatabaseError('Failed to get conversation turns');
	}

	return {
		session,
		turns: turns || [],
	};
}

/**
 * Gather aggregate statistics about conversation search readiness, including total
 * session and turn counts and how many have embeddings for search.
 *
 * @returns Statistics with total sessions/turns and counts of those with embeddings
 * @throws {DatabaseError} If Supabase is not configured or any of the underlying queries fail
 */
export async function getConversationSearchStats(): Promise<{
	totalSessions: number;
	sessionsWithSummary: number;
	totalTurns: number;
	turnsWithEmbedding: number;
}> {
	if (!isSupabaseConfigured()) {
		throw new DatabaseError('Supabase not configured');
	}

	const client = getSupabaseClient();

	// Get session counts
	const { count: totalSessions, error: totalSessionsError } = await client
		.from('conversation_sessions')
		.select('*', { count: 'exact', head: true });

	if (totalSessionsError) {
		logger.error('Failed to get conversation stats', { error: totalSessionsError.message });
		throw new DatabaseError('Failed to get conversation stats');
	}

	const { count: sessionsWithSummary, error: sessionsWithSummaryError } = await client
		.from('conversation_sessions')
		.select('*', { count: 'exact', head: true })
		.not('summary_embedding', 'is', null);

	if (sessionsWithSummaryError) {
		logger.error('Failed to get conversation stats', { error: sessionsWithSummaryError.message });
		throw new DatabaseError('Failed to get conversation stats');
	}

	// Get turn counts
	const { count: totalTurns, error: totalTurnsError } = await client
		.from('conversation_turns')
		.select('*', { count: 'exact', head: true });

	if (totalTurnsError) {
		logger.error('Failed to get conversation stats', { error: totalTurnsError.message });
		throw new DatabaseError('Failed to get conversation stats');
	}

	const { count: turnsWithEmbedding, error: turnsWithEmbeddingError } = await client
		.from('conversation_turns')
		.select('*', { count: 'exact', head: true })
		.not('embedding', 'is', null);

	if (turnsWithEmbeddingError) {
		logger.error('Failed to get conversation stats', { error: turnsWithEmbeddingError.message });
		throw new DatabaseError('Failed to get conversation stats');
	}

	return {
		totalSessions: totalSessions || 0,
		sessionsWithSummary: sessionsWithSummary || 0,
		totalTurns: totalTurns || 0,
		turnsWithEmbedding: turnsWithEmbedding || 0,
	};
}
