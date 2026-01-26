import { DatabaseError, NotFoundError } from '../utils/errors.js';
import { logger } from '../utils/logger.js';
import { getSupabaseClient, isSupabaseConfigured } from './client.js';

/**
 * Conversation Turn type definition
 */
export interface ConversationTurn {
	id: string;
	session_id: string;
	role: 'user' | 'assistant' | 'system';
	content: string;
	embedding: number[] | null;
	turn_index: number;
	token_count: number | null;
	metadata: Record<string, unknown>;
	created_at: string;
}

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
 * Create a single conversation turn
 */
export async function createTurn(input: CreateTurnInput): Promise<ConversationTurn> {
	if (!isSupabaseConfigured()) {
		throw new DatabaseError('Supabase not configured');
	}

	const client = getSupabaseClient();

	// If no turn index provided, get the next one
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

/**
 * Create multiple conversation turns in batch
 */
export async function createTurns(input: CreateTurnsInput): Promise<ConversationTurn[]> {
	if (!isSupabaseConfigured()) {
		throw new DatabaseError('Supabase not configured');
	}

	if (input.turns.length === 0) {
		return [];
	}

	const client = getSupabaseClient();

	// Get the starting index
	let startIndex = input.startIndex;
	if (startIndex === undefined) {
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
		turn_index: startIndex! + i,
		token_count: turn.tokenCount || null,
		metadata: turn.metadata || {},
	}));

	const { data, error } = await client.from('conversation_turns').insert(turnRecords).select();

	if (error) {
		logger.error('Failed to create turns', { error: error.message });
		throw new DatabaseError('Failed to create conversation turns');
	}

	logger.info('Created conversation turns', {
		sessionId: input.sessionId,
		count: data.length,
	});
	return data as ConversationTurn[];
}

/**
 * Get turn by ID
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
 * Get all turns for a session in order
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
 * Get recent turns for a session (useful for context window)
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
 * Delete a turn by ID
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
 * Delete all turns after a specific index (for conversation rollback)
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
 * Update turn embedding (for async embedding generation)
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
 * Get turn count for a session
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
