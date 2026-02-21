import type { ConversationTurn } from '../types/database.js';
import { DatabaseError, NotFoundError } from '../utils/errors.js';
import { logger } from '../utils/logger.js';
import { getSupabaseClient, isSupabaseConfigured } from './client.js';

export type { ConversationTurn } from '../types/database.js';

export interface CreateTurnInput {
	sessionId: string;
	role: 'user' | 'assistant' | 'system';
	content: string;
	embedding?: number[];
	turnIndex?: number;
	tokenCount?: number;
	metadata?: Record<string, unknown>;
}

export interface CreateTurnsInput {
	sessionId: string;
	turns: Array<{
		role: 'user' | 'assistant' | 'system';
		content: string;
		embedding?: number[];
		tokenCount?: number;
		metadata?: Record<string, unknown>;
	}>;
	startIndex?: number;
}

/**
 * Create a single conversation turn (message) within a session. If no turn index
 * is provided, the next sequential index is determined automatically.
 *
 * @param input - Turn creation data
 * @param input.sessionId - The UUID of the parent conversation session
 * @param input.role - The role of the message author ('user', 'assistant', or 'system')
 * @param input.content - The text content of the turn
 * @param input.embedding - Optional vector embedding for semantic search
 * @param input.turnIndex - Optional explicit turn index (auto-incremented if omitted)
 * @param input.tokenCount - Optional token count for the turn content
 * @param input.metadata - Optional metadata key-value pairs
 * @returns The newly created conversation turn record
 * @throws {DatabaseError} If Supabase is not configured or the insert fails
 */
export async function createTurn(input: CreateTurnInput): Promise<ConversationTurn> {
	if (!isSupabaseConfigured()) {
		throw new DatabaseError('Supabase not configured');
	}

	const client = getSupabaseClient();

	// Retry loop handles the race condition when turnIndex is auto-detected:
	// concurrent createTurn calls may read the same max turn_index and attempt
	// the same next value. On unique-violation (23505) we re-query and retry.
	const maxRetries = 3;
	for (let attempt = 0; attempt < maxRetries; attempt++) {
		let turnIndex = input.turnIndex;
		if (turnIndex === undefined) {
			const { data: lastTurn } = await client
				.from('conversation_turns')
				.select('turn_index')
				.eq('session_id', input.sessionId)
				.order('turn_index', { ascending: false })
				.limit(1)
				.maybeSingle();

			turnIndex = lastTurn ? lastTurn.turn_index + 1 : 0;
		}

		const { data, error } = await client
			.from('conversation_turns')
			.insert({
				session_id: input.sessionId,
				role: input.role,
				content: input.content,
				embedding: input.embedding || null,
				turn_index: turnIndex,
				token_count: input.tokenCount || null,
				metadata: input.metadata || {},
			})
			.select()
			.single();

		if (error) {
			// Retry on unique-violation only when auto-detecting turnIndex
			if (error.code === '23505' && input.turnIndex === undefined && attempt < maxRetries - 1) {
				logger.debug('Turn index conflict, retrying', {
					sessionId: input.sessionId,
					attempt: attempt + 1,
					turnIndex,
				});
				continue;
			}
			logger.error('Failed to create turn', { error: error.message });
			throw new DatabaseError('Failed to create conversation turn');
		}

		logger.debug('Created conversation turn', {
			id: data.id,
			sessionId: data.session_id,
			turnIndex: data.turn_index,
			role: data.role,
		});
		return data as ConversationTurn;
	}

	// Should be unreachable — all retries exhausted means the last attempt threw
	throw new DatabaseError('Failed to create conversation turn after retries');
}

/**
 * Create multiple conversation turns in a single batch insert. Turn indexes are
 * assigned sequentially starting from the provided start index or auto-detected
 * from the last existing turn in the session.
 *
 * @param input - Batch turn creation data
 * @param input.sessionId - The UUID of the parent conversation session
 * @param input.turns - Array of turn data (role, content, embedding, tokenCount, metadata)
 * @param input.startIndex - Optional starting turn index (auto-detected if omitted)
 * @returns The number of turns created
 * @throws {DatabaseError} If Supabase is not configured or the batch insert fails
 */
export async function createTurns(input: CreateTurnsInput): Promise<number> {
	if (!isSupabaseConfigured()) {
		throw new DatabaseError('Supabase not configured');
	}

	if (input.turns.length === 0) {
		return 0;
	}

	const client = getSupabaseClient();

	// Get the starting index
	let startIndex: number;
	if (input.startIndex !== undefined) {
		startIndex = input.startIndex;
	} else {
		const { data: lastTurn } = await client
			.from('conversation_turns')
			.select('turn_index')
			.eq('session_id', input.sessionId)
			.order('turn_index', { ascending: false })
			.limit(1)
			.maybeSingle();

		startIndex = lastTurn ? lastTurn.turn_index + 1 : 0;
	}

	// Prepare batch insert
	const turnRecords = input.turns.map((turn, i) => ({
		session_id: input.sessionId,
		role: turn.role,
		content: turn.content,
		embedding: turn.embedding || null,
		turn_index: startIndex + i,
		token_count: turn.tokenCount || null,
		metadata: turn.metadata || {},
	}));

	const { error } = await client.from('conversation_turns').insert(turnRecords);

	if (error) {
		logger.error('Failed to create turns', { error: error.message });
		throw new DatabaseError('Failed to create conversation turns');
	}

	logger.info('Created conversation turns', {
		sessionId: input.sessionId,
		count: turnRecords.length,
	});
	return turnRecords.length;
}

/**
 * Retrieve a conversation turn by its UUID.
 *
 * @param id - The UUID of the turn to retrieve
 * @returns The conversation turn record
 * @throws {NotFoundError} If no turn exists with the given ID
 * @throws {DatabaseError} If Supabase is not configured or the query fails
 */
export async function getTurn(id: string): Promise<ConversationTurn> {
	if (!isSupabaseConfigured()) {
		throw new DatabaseError('Supabase not configured');
	}

	const client = getSupabaseClient();

	const { data, error } = await client.from('conversation_turns').select('*').eq('id', id).single();

	if (error) {
		if (error.code === 'PGRST116') {
			throw new NotFoundError(`Turn not found: ${id}`);
		}
		logger.error('Failed to get turn', { error: error.message });
		throw new DatabaseError('Failed to get turn');
	}

	return data as ConversationTurn;
}

/**
 * Retrieve all turns for a conversation session with pagination and configurable
 * sort order.
 *
 * @param sessionId - The UUID of the conversation session
 * @param options - Pagination and ordering options
 * @param options.limit - Maximum number of turns to return (default: 100)
 * @param options.offset - Number of turns to skip for pagination (default: 0)
 * @param options.order - Sort order by turn index, 'asc' or 'desc' (default: 'asc')
 * @returns An object with the turns array and total count for pagination
 * @throws {DatabaseError} If Supabase is not configured or the query fails
 */
export async function getSessionTurns(
	sessionId: string,
	options: {
		limit?: number;
		offset?: number;
		order?: 'asc' | 'desc';
	} = {},
): Promise<{ turns: ConversationTurn[]; total: number }> {
	if (!isSupabaseConfigured()) {
		throw new DatabaseError('Supabase not configured');
	}

	const { limit = 100, offset = 0, order = 'asc' } = options;
	const client = getSupabaseClient();

	const { data, error, count } = await client
		.from('conversation_turns')
		.select('*', { count: 'exact' })
		.eq('session_id', sessionId)
		.order('turn_index', { ascending: order === 'asc' })
		.range(offset, offset + limit - 1);

	if (error) {
		logger.error('Failed to get session turns', { error: error.message });
		throw new DatabaseError('Failed to get session turns');
	}

	return {
		turns: data as ConversationTurn[],
		total: count || 0,
	};
}

/**
 * Get the most recent turns for a session in chronological order. Useful for
 * building a context window of recent conversation history.
 *
 * @param sessionId - The UUID of the conversation session
 * @param limit - Maximum number of recent turns to return (default: 10)
 * @returns An array of the most recent turns in chronological (ascending) order
 * @throws {DatabaseError} If Supabase is not configured or the query fails
 */
export async function getRecentTurns(sessionId: string, limit = 10): Promise<ConversationTurn[]> {
	if (!isSupabaseConfigured()) {
		throw new DatabaseError('Supabase not configured');
	}

	const client = getSupabaseClient();

	const { data, error } = await client
		.from('conversation_turns')
		.select('*')
		.eq('session_id', sessionId)
		.order('turn_index', { ascending: false })
		.limit(limit);

	if (error) {
		logger.error('Failed to get recent turns', { error: error.message });
		throw new DatabaseError('Failed to get recent turns');
	}

	// Return in chronological order
	return (data as ConversationTurn[]).reverse();
}

/**
 * Delete a single conversation turn by its UUID.
 *
 * @param id - The UUID of the turn to delete
 * @returns Resolves when the turn has been deleted
 * @throws {DatabaseError} If Supabase is not configured or the delete fails
 */
export async function deleteTurn(id: string): Promise<void> {
	if (!isSupabaseConfigured()) {
		throw new DatabaseError('Supabase not configured');
	}

	const client = getSupabaseClient();

	const { error } = await client.from('conversation_turns').delete().eq('id', id);

	if (error) {
		logger.error('Failed to delete turn', { error: error.message });
		throw new DatabaseError('Failed to delete turn');
	}

	logger.debug('Deleted conversation turn', { id });
}

/**
 * Delete all turns in a session that have a turn index greater than the specified
 * index. Useful for conversation rollback/undo operations.
 *
 * @param sessionId - The UUID of the conversation session
 * @param afterIndex - The turn index threshold; turns with index > this value are deleted
 * @returns The number of turns that were deleted
 * @throws {DatabaseError} If Supabase is not configured or the delete fails
 */
export async function deleteTurnsAfter(sessionId: string, afterIndex: number): Promise<number> {
	if (!isSupabaseConfigured()) {
		throw new DatabaseError('Supabase not configured');
	}

	const client = getSupabaseClient();

	const { data, error } = await client
		.from('conversation_turns')
		.delete()
		.eq('session_id', sessionId)
		.gt('turn_index', afterIndex)
		.select('id');

	if (error) {
		logger.error('Failed to delete turns', { error: error.message });
		throw new DatabaseError('Failed to delete turns');
	}

	const deletedCount = data?.length || 0;
	logger.info('Deleted turns after index', {
		sessionId,
		afterIndex,
		deletedCount,
	});
	return deletedCount;
}

/**
 * Update the vector embedding for a conversation turn. Typically called
 * asynchronously after turn creation when embeddings are generated in the background.
 *
 * @param id - The UUID of the turn to update
 * @param embedding - The vector embedding to set
 * @returns Resolves when the embedding has been updated
 * @throws {DatabaseError} If Supabase is not configured or the update fails
 */
export async function updateTurnEmbedding(id: string, embedding: number[]): Promise<void> {
	if (!isSupabaseConfigured()) {
		throw new DatabaseError('Supabase not configured');
	}

	const client = getSupabaseClient();

	const { error } = await client.from('conversation_turns').update({ embedding }).eq('id', id);

	if (error) {
		logger.error('Failed to update turn embedding', { error: error.message });
		throw new DatabaseError('Failed to update turn embedding');
	}

	logger.debug('Updated turn embedding', { id });
}

/**
 * Get the total number of turns in a conversation session.
 *
 * @param sessionId - The UUID of the conversation session
 * @returns The number of turns in the session
 * @throws {DatabaseError} If Supabase is not configured or the count query fails
 */
export async function getTurnCount(sessionId: string): Promise<number> {
	if (!isSupabaseConfigured()) {
		throw new DatabaseError('Supabase not configured');
	}

	const client = getSupabaseClient();

	const { count, error } = await client
		.from('conversation_turns')
		.select('*', { count: 'exact', head: true })
		.eq('session_id', sessionId);

	if (error) {
		logger.error('Failed to get turn count', { error: error.message });
		throw new DatabaseError('Failed to get turn count');
	}

	return count || 0;
}
