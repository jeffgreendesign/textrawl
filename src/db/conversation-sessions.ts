import type { ConversationSession } from '../types/database.js';
import { DatabaseError, NotFoundError } from '../utils/errors.js';
import { logger } from '../utils/logger.js';
import { getSupabaseClient, isSupabaseConfigured } from './client.js';

export type { ConversationSession } from '../types/database.js';

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
 * Create a new conversation session. If a session with the same session key
 * already exists (unique constraint violation), the existing session is returned.
 *
 * @param input - Session creation data
 * @param input.sessionKey - Optional unique key for the session (for idempotent lookups)
 * @param input.title - Optional human-readable title
 * @param input.summary - Optional conversation summary text
 * @param input.summaryEmbedding - Optional vector embedding of the summary
 * @param input.metadata - Optional metadata key-value pairs
 * @returns The newly created or existing conversation session
 * @throws {DatabaseError} If Supabase is not configured or the insert fails
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
 * Get or create a conversation session using an upsert on the session_key unique constraint.
 * If the session already exists, it is updated with the provided fields and returned.
 *
 * @param sessionKey - The unique session key to upsert on
 * @param input - Optional session data (title, summary, embedding, metadata) to set on create/update
 * @returns The existing or newly created conversation session
 * @throws {DatabaseError} If Supabase is not configured or the upsert fails
 */
export async function getOrCreateSession(
	sessionKey: string,
	input?: Omit<CreateSessionInput, 'sessionKey'>,
): Promise<ConversationSession> {
	if (!isSupabaseConfigured()) {
		throw new DatabaseError('Supabase not configured');
	}

	const client = getSupabaseClient();

	// Build the upsert payload dynamically — only include fields that were
	// explicitly provided so that Supabase's onConflict merge preserves
	// existing DB values for unspecified columns.
	const payload: Record<string, unknown> = { session_key: sessionKey };
	if (input?.title !== undefined) {
		payload.title = input.title;
	}
	if (input?.summary !== undefined) {
		payload.summary = input.summary;
	}
	if (input?.summaryEmbedding !== undefined) {
		payload.summary_embedding = input.summaryEmbedding;
	}
	if (input?.metadata !== undefined) {
		payload.metadata = input.metadata;
	}

	const { data, error } = await client
		.from('conversation_sessions')
		.upsert(payload, {
			onConflict: 'session_key',
			ignoreDuplicates: false,
		})
		.select()
		.single();

	if (error) {
		logger.error('Failed to upsert session', { error: error.message });
		throw new DatabaseError('Failed to create or update session');
	}

	return data as ConversationSession;
}

/**
 * Retrieve a conversation session by its UUID.
 *
 * @param id - The UUID of the session to retrieve
 * @returns The conversation session record
 * @throws {NotFoundError} If no session exists with the given ID
 * @throws {DatabaseError} If Supabase is not configured or the query fails
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
 * Retrieve a conversation session by its unique session key.
 *
 * @param sessionKey - The unique session key to look up
 * @returns The conversation session record
 * @throws {NotFoundError} If no session exists with the given key
 * @throws {DatabaseError} If Supabase is not configured or the query fails
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
 * Find a conversation session by its session key. Returns `null` if not found
 * rather than throwing an error.
 *
 * @param sessionKey - The unique session key to search for
 * @returns The conversation session, or `null` if not found
 * @throws {DatabaseError} If Supabase is not configured or the query fails
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
 * Update a conversation session's title, summary, embedding, and/or metadata.
 * If no fields are provided, the existing session is returned unchanged.
 *
 * @param id - The UUID of the session to update
 * @param input - Fields to update
 * @param input.title - New title for the session
 * @param input.summary - New summary text
 * @param input.summaryEmbedding - New vector embedding for the summary
 * @param input.metadata - New metadata key-value pairs
 * @returns The updated conversation session record
 * @throws {NotFoundError} If no session exists with the given ID
 * @throws {DatabaseError} If Supabase is not configured or the update fails
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
 * Delete a conversation session by ID. Deletion cascades to all associated
 * conversation turns via database foreign key constraints.
 *
 * @param id - The UUID of the session to delete
 * @returns Resolves when the session has been deleted
 * @throws {DatabaseError} If Supabase is not configured or the delete fails
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
 * List conversation sessions with pagination, ordered by most recent activity first.
 *
 * @param options - Pagination options
 * @param options.limit - Maximum number of sessions to return (default: 20)
 * @param options.offset - Number of sessions to skip for pagination (default: 0)
 * @returns An object with the matching sessions array and total count for pagination
 * @throws {DatabaseError} If Supabase is not configured or the query fails
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
 * Gather aggregate statistics about conversation sessions, including total session
 * and turn counts and the date range of stored sessions.
 *
 * @returns Conversation statistics with session/turn totals and date range
 * @throws {DatabaseError} If Supabase is not configured or any of the underlying queries fail
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

	// Use efficient count + limit-1 queries instead of fetching all rows
	const [sessionCountResult, turnCountResult, oldestResult, newestResult] = await Promise.all([
		client.from('conversation_sessions').select('*', { count: 'exact', head: true }),
		client.from('conversation_turns').select('*', { count: 'exact', head: true }),
		client
			.from('conversation_sessions')
			.select('created_at')
			.order('created_at', { ascending: true })
			.limit(1)
			.maybeSingle(),
		client
			.from('conversation_sessions')
			.select('created_at')
			.order('created_at', { ascending: false })
			.limit(1)
			.maybeSingle(),
	]);

	if (sessionCountResult.error) {
		logger.error('Failed to get session stats', { error: sessionCountResult.error.message });
		throw new DatabaseError('Failed to get conversation stats');
	}

	if (turnCountResult.error) {
		logger.error('Failed to get turn stats', { error: turnCountResult.error.message });
		throw new DatabaseError('Failed to get conversation stats');
	}

	return {
		totalSessions: sessionCountResult.count || 0,
		totalTurns: turnCountResult.count || 0,
		oldestSession: oldestResult.data?.created_at || null,
		newestSession: newestResult.data?.created_at || null,
	};
}
