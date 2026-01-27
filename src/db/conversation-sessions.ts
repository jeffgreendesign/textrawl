import { DatabaseError, NotFoundError } from '../utils/errors.js';
import { logger } from '../utils/logger.js';
import { getSupabaseClient, isSupabaseConfigured } from './client.js';

/**
 * Conversation Session type definition
 */
export interface ConversationSession {
	id: string;
	session_key: string | null;
	title: string | null;
	summary: string | null;
	summary_embedding: number[] | null;
	metadata: Record<string, unknown>;
	turn_count: number;
	last_activity: string;
	created_at: string;
}

export interface CreateSessionInput {
	sessionKey?: string;
	title?: string;
	summary?: string;
	summaryEmbedding?: number[];
	metadata?: Record<string, unknown>;
}

export interface UpdateSessionInput {
	title?: string;
	summary?: string;
	summaryEmbedding?: number[];
	metadata?: Record<string, unknown>;
}

/**
 * Create a new conversation session
 */
export async function createSession(input: CreateSessionInput): Promise<ConversationSession> {
	if (!isSupabaseConfigured()) {
		throw new DatabaseError('Supabase not configured');
	}

	const client = getSupabaseClient();

	const { data, error } = await client
		.from('conversation_sessions')
		.insert({
			session_key: input.sessionKey || null,
			title: input.title || null,
			summary: input.summary || null,
			summary_embedding: input.summaryEmbedding || null,
			metadata: input.metadata || {},
		})
		.select()
		.single();

	if (error) {
		// Handle unique constraint violation (session key already exists)
		if (error.code === '23505') {
			logger.debug('Session key already exists, fetching existing', {
				sessionKey: input.sessionKey,
			});
			if (input.sessionKey) {
				return getSessionByKey(input.sessionKey);
			}
		}
		logger.error('Failed to create session', { error: error.message });
		throw new DatabaseError('Failed to create conversation session');
	}

	logger.info('Created conversation session', {
		id: data.id,
		sessionKey: data.session_key,
	});
	return data as ConversationSession;
}

/**
 * Get or create a session by key (upsert pattern)
 */
export async function getOrCreateSession(
	sessionKey: string,
	input?: Omit<CreateSessionInput, 'sessionKey'>,
): Promise<ConversationSession> {
	if (!isSupabaseConfigured()) {
		throw new DatabaseError('Supabase not configured');
	}

	const client = getSupabaseClient();

	const { data, error } = await client
		.from('conversation_sessions')
		.upsert(
			{
				session_key: sessionKey,
				title: input?.title || null,
				summary: input?.summary || null,
				summary_embedding: input?.summaryEmbedding || null,
				metadata: input?.metadata || {},
			},
			{
				onConflict: 'session_key',
				ignoreDuplicates: false,
			},
		)
		.select()
		.single();

	if (error) {
		logger.error('Failed to upsert session', { error: error.message });
		throw new DatabaseError('Failed to create or update session');
	}

	return data as ConversationSession;
}

/**
 * Get session by ID
 */
export async function getSession(id: string): Promise<ConversationSession> {
	if (!isSupabaseConfigured()) {
		throw new DatabaseError('Supabase not configured');
	}

	const client = getSupabaseClient();

	const { data, error } = await client
		.from('conversation_sessions')
		.select('*')
		.eq('id', id)
		.single();

	if (error) {
		if (error.code === 'PGRST116') {
			throw new NotFoundError(`Session not found: ${id}`);
		}
		logger.error('Failed to get session', { error: error.message });
		throw new DatabaseError('Failed to get session');
	}

	return data as ConversationSession;
}

/**
 * Get session by session key
 */
export async function getSessionByKey(sessionKey: string): Promise<ConversationSession> {
	if (!isSupabaseConfigured()) {
		throw new DatabaseError('Supabase not configured');
	}

	const client = getSupabaseClient();

	const { data, error } = await client
		.from('conversation_sessions')
		.select('*')
		.eq('session_key', sessionKey)
		.single();

	if (error) {
		if (error.code === 'PGRST116') {
			throw new NotFoundError(`Session not found: ${sessionKey}`);
		}
		logger.error('Failed to get session by key', { error: error.message });
		throw new DatabaseError('Failed to get session');
	}

	return data as ConversationSession;
}

/**
 * Find session by key (returns null if not found)
 */
export async function findSessionByKey(sessionKey: string): Promise<ConversationSession | null> {
	if (!isSupabaseConfigured()) {
		throw new DatabaseError('Supabase not configured');
	}

	const client = getSupabaseClient();

	const { data, error } = await client
		.from('conversation_sessions')
		.select('*')
		.eq('session_key', sessionKey)
		.maybeSingle();

	if (error) {
		logger.error('Failed to find session', { error: error.message });
		throw new DatabaseError('Failed to find session');
	}

	return data as ConversationSession | null;
}

/**
 * Update a session
 */
export async function updateSession(
	id: string,
	input: UpdateSessionInput,
): Promise<ConversationSession> {
	if (!isSupabaseConfigured()) {
		throw new DatabaseError('Supabase not configured');
	}

	const client = getSupabaseClient();

	const updates: Record<string, unknown> = {};
	if (input.title !== undefined) {
		updates.title = input.title;
	}
	if (input.summary !== undefined) {
		updates.summary = input.summary;
	}
	if (input.summaryEmbedding !== undefined) {
		updates.summary_embedding = input.summaryEmbedding;
	}
	if (input.metadata !== undefined) {
		updates.metadata = input.metadata;
	}

	if (Object.keys(updates).length === 0) {
		return getSession(id);
	}

	const { data, error } = await client
		.from('conversation_sessions')
		.update(updates)
		.eq('id', id)
		.select()
		.single();

	if (error) {
		if (error.code === 'PGRST116') {
			throw new NotFoundError(`Session not found: ${id}`);
		}
		logger.error('Failed to update session', { error: error.message });
		throw new DatabaseError('Failed to update session');
	}

	logger.info('Updated conversation session', { id, updates: Object.keys(updates) });
	return data as ConversationSession;
}

/**
 * Delete a session (cascades to turns)
 */
export async function deleteSession(id: string): Promise<void> {
	if (!isSupabaseConfigured()) {
		throw new DatabaseError('Supabase not configured');
	}

	const client = getSupabaseClient();

	const { error } = await client.from('conversation_sessions').delete().eq('id', id);

	if (error) {
		logger.error('Failed to delete session', { error: error.message });
		throw new DatabaseError('Failed to delete session');
	}

	logger.info('Deleted conversation session', { id });
}

/**
 * List recent sessions with pagination
 */
export async function listSessions(options: {
	limit?: number;
	offset?: number;
}): Promise<{ sessions: ConversationSession[]; total: number }> {
	if (!isSupabaseConfigured()) {
		throw new DatabaseError('Supabase not configured');
	}

	const { limit = 20, offset = 0 } = options;
	const client = getSupabaseClient();

	const { data, error, count } = await client
		.from('conversation_sessions')
		.select('*', { count: 'exact' })
		.order('last_activity', { ascending: false })
		.range(offset, offset + limit - 1);

	if (error) {
		logger.error('Failed to list sessions', { error: error.message });
		throw new DatabaseError('Failed to list sessions');
	}

	return {
		sessions: data as ConversationSession[],
		total: count || 0,
	};
}

/**
 * Get conversation stats
 */
export async function getConversationStats(): Promise<{
	totalSessions: number;
	totalTurns: number;
	oldestSession: string | null;
	newestSession: string | null;
}> {
	if (!isSupabaseConfigured()) {
		throw new DatabaseError('Supabase not configured');
	}

	const client = getSupabaseClient();

	// Get session count and date range
	const { data: sessions, error: sessionsError } = await client
		.from('conversation_sessions')
		.select('created_at')
		.order('created_at', { ascending: true });

	if (sessionsError) {
		logger.error('Failed to get session stats', { error: sessionsError.message });
		throw new DatabaseError('Failed to get conversation stats');
	}

	// Get total turn count
	const { count: turnCount, error: turnsError } = await client
		.from('conversation_turns')
		.select('*', { count: 'exact', head: true });

	if (turnsError) {
		logger.error('Failed to get turn stats', { error: turnsError.message });
		throw new DatabaseError('Failed to get conversation stats');
	}

	return {
		totalSessions: sessions?.length || 0,
		totalTurns: turnCount || 0,
		oldestSession: sessions?.[0]?.created_at || null,
		newestSession: sessions?.[sessions.length - 1]?.created_at || null,
	};
}
