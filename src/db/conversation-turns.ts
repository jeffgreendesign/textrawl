import type { ConversationTurn } from '../types/database.js';
import { DatabaseError, NotFoundError } from '../utils/errors.js';
import { logger } from '../utils/logger.js';
import {
	isDatabaseConfigured,
	pgQuery,
	queryCount,
	queryOne,
	queryOneOrThrow,
} from './pg-client.js';

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
 * @throws {DatabaseError} If the database is not configured or the insert fails
 */
export async function createTurn(input: CreateTurnInput): Promise<ConversationTurn> {
	if (!isDatabaseConfigured()) {
		throw new DatabaseError('Database not configured');
	}

	// Retry loop handles the race condition when turnIndex is auto-detected:
	// concurrent createTurn calls may read the same max turn_index and attempt
	// the same next value. On unique-violation (23505) we re-query and retry.
	const maxRetries = 3;
	for (let attempt = 0; attempt < maxRetries; attempt++) {
		let turnIndex = input.turnIndex;
		if (turnIndex === undefined) {
			const lastTurn = await queryOne<{ turn_index: number }>(
				'SELECT turn_index FROM conversation_turns WHERE session_id = $1 ORDER BY turn_index DESC LIMIT 1',
				[input.sessionId],
			);
			turnIndex = lastTurn ? lastTurn.turn_index + 1 : 0;
		}

		try {
			const data = await queryOneOrThrow<ConversationTurn>(
				`INSERT INTO conversation_turns (session_id, role, content, embedding, turn_index, token_count, metadata)
				 VALUES ($1, $2, $3, $4::vector, $5, $6, $7)
				 RETURNING *`,
				[
					input.sessionId,
					input.role,
					input.content,
					input.embedding ? JSON.stringify(input.embedding) : null,
					turnIndex,
					input.tokenCount || null,
					JSON.stringify(input.metadata || {}),
				],
			);

			logger.debug('Created conversation turn', {
				id: data.id,
				sessionId: data.session_id,
				turnIndex: data.turn_index,
				role: data.role,
			});
			return data;
		} catch (err: unknown) {
			// Retry on unique-violation only when auto-detecting turnIndex
			const isUniqueViolation =
				err instanceof Error && 'code' in err && (err as { code: string }).code === '23505';
			if (isUniqueViolation && input.turnIndex === undefined && attempt < maxRetries - 1) {
				logger.debug('Turn index conflict, retrying', {
					sessionId: input.sessionId,
					attempt: attempt + 1,
					turnIndex,
				});
				// Small backoff before retry to reduce collision likelihood
				await new Promise((r) => setTimeout(r, 10 * 2 ** attempt));
				continue;
			}
			if (err instanceof NotFoundError || err instanceof DatabaseError) {
				throw err;
			}
			logger.error('Failed to create turn', {
				error: err instanceof Error ? err.message : String(err),
			});
			throw new DatabaseError('Failed to create conversation turn');
		}
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
 * @throws {DatabaseError} If the database is not configured or the batch insert fails
 */
export async function createTurns(input: CreateTurnsInput): Promise<number> {
	if (!isDatabaseConfigured()) {
		throw new DatabaseError('Database not configured');
	}

	if (input.turns.length === 0) {
		return 0;
	}

	// Retry loop handles the race condition when startIndex is auto-detected:
	// concurrent createTurns calls may read the same max turn_index and attempt
	// overlapping ranges. On unique-violation (23505) we re-query and retry.
	const maxRetries = 3;
	for (let attempt = 0; attempt < maxRetries; attempt++) {
		let startIndex: number;
		if (input.startIndex !== undefined) {
			startIndex = input.startIndex;
		} else {
			const lastTurn = await queryOne<{ turn_index: number }>(
				'SELECT turn_index FROM conversation_turns WHERE session_id = $1 ORDER BY turn_index DESC LIMIT 1',
				[input.sessionId],
			);
			startIndex = lastTurn ? lastTurn.turn_index + 1 : 0;
		}

		// Build multi-row INSERT with parameterized values
		const params: unknown[] = [];
		const valueRows: string[] = [];
		let paramIndex = 1;

		for (let i = 0; i < input.turns.length; i++) {
			const turn = input.turns[i];
			valueRows.push(
				`($${paramIndex}, $${paramIndex + 1}, $${paramIndex + 2}, $${paramIndex + 3}::vector, $${paramIndex + 4}, $${paramIndex + 5}, $${paramIndex + 6})`,
			);
			params.push(
				input.sessionId,
				turn.role,
				turn.content,
				turn.embedding ? JSON.stringify(turn.embedding) : null,
				startIndex + i,
				turn.tokenCount || null,
				JSON.stringify(turn.metadata || {}),
			);
			paramIndex += 7;
		}

		try {
			await pgQuery(
				`INSERT INTO conversation_turns (session_id, role, content, embedding, turn_index, token_count, metadata)
				 VALUES ${valueRows.join(', ')}`,
				params,
			);

			logger.info('Created conversation turns', {
				sessionId: input.sessionId,
				count: input.turns.length,
			});
			return input.turns.length;
		} catch (err: unknown) {
			// Retry on unique-violation only when auto-detecting startIndex
			const isUniqueViolation =
				err instanceof Error && 'code' in err && (err as { code: string }).code === '23505';
			if (isUniqueViolation && input.startIndex === undefined && attempt < maxRetries - 1) {
				logger.debug('Turn index conflict in batch insert, retrying', {
					sessionId: input.sessionId,
					attempt: attempt + 1,
					startIndex,
				});
				// Small backoff before retry
				await new Promise((r) => setTimeout(r, 10 * 2 ** attempt));
				continue;
			}
			logger.error('Failed to create turns', {
				error: err instanceof Error ? err.message : String(err),
			});
			throw new DatabaseError('Failed to create conversation turns');
		}
	}

	// Should be unreachable — all retries exhausted means the last attempt threw
	throw new DatabaseError('Failed to create conversation turns after retries');
}

/**
 * Retrieve a conversation turn by its UUID.
 *
 * @param id - The UUID of the turn to retrieve
 * @returns The conversation turn record
 * @throws {NotFoundError} If no turn exists with the given ID
 * @throws {DatabaseError} If the database is not configured or the query fails
 */
export async function getTurn(id: string): Promise<ConversationTurn> {
	if (!isDatabaseConfigured()) {
		throw new DatabaseError('Database not configured');
	}

	try {
		return await queryOneOrThrow<ConversationTurn>(
			'SELECT * FROM conversation_turns WHERE id = $1',
			[id],
			`Turn not found: ${id}`,
		);
	} catch (err: unknown) {
		if (err instanceof NotFoundError) throw err;
		logger.error('Failed to get turn', {
			error: err instanceof Error ? err.message : String(err),
		});
		throw new DatabaseError('Failed to get turn');
	}
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
 * @throws {DatabaseError} If the database is not configured or the query fails
 */
export async function getSessionTurns(
	sessionId: string,
	options: {
		limit?: number;
		offset?: number;
		order?: 'asc' | 'desc';
	} = {},
): Promise<{ turns: ConversationTurn[]; total: number }> {
	if (!isDatabaseConfigured()) {
		throw new DatabaseError('Database not configured');
	}

	const { order = 'asc' } = options;
	const rawLimit = options.limit ?? 100;
	const rawOffset = options.offset ?? 0;
	const clampedLimit = Math.max(1, Number.isFinite(rawLimit) ? Math.floor(rawLimit) : 100);
	const clampedOffset = Math.max(0, Number.isFinite(rawOffset) ? Math.floor(rawOffset) : 0);
	const direction = order === 'desc' ? 'DESC' : 'ASC';

	try {
		const [{ rows }, total] = await Promise.all([
			pgQuery<ConversationTurn>(
				`SELECT * FROM conversation_turns WHERE session_id = $1 ORDER BY turn_index ${direction} LIMIT $2 OFFSET $3`,
				[sessionId, clampedLimit, clampedOffset],
			),
			queryCount('SELECT count(*) FROM conversation_turns WHERE session_id = $1', [sessionId]),
		]);

		return { turns: rows, total };
	} catch (err: unknown) {
		logger.error('Failed to get session turns', {
			error: err instanceof Error ? err.message : String(err),
		});
		throw new DatabaseError('Failed to get session turns');
	}
}

/**
 * Get the most recent turns for a session in chronological order. Useful for
 * building a context window of recent conversation history.
 *
 * @param sessionId - The UUID of the conversation session
 * @param limit - Maximum number of recent turns to return (default: 10)
 * @returns An array of the most recent turns in chronological (ascending) order
 * @throws {DatabaseError} If the database is not configured or the query fails
 */
export async function getRecentTurns(sessionId: string, limit = 10): Promise<ConversationTurn[]> {
	if (!isDatabaseConfigured()) {
		throw new DatabaseError('Database not configured');
	}

	const clampedLimit = Math.max(1, Number.isFinite(limit) ? Math.floor(limit) : 10);

	try {
		const { rows } = await pgQuery<ConversationTurn>(
			`SELECT * FROM (
				SELECT * FROM conversation_turns WHERE session_id = $1 ORDER BY turn_index DESC LIMIT $2
			 ) sub ORDER BY turn_index ASC`,
			[sessionId, clampedLimit],
		);

		return rows;
	} catch (err: unknown) {
		logger.error('Failed to get recent turns', {
			error: err instanceof Error ? err.message : String(err),
		});
		throw new DatabaseError('Failed to get recent turns');
	}
}

/**
 * Delete a single conversation turn by its UUID.
 *
 * @param id - The UUID of the turn to delete
 * @returns Resolves when the turn has been deleted
 * @throws {NotFoundError} If no turn exists with the given ID
 * @throws {DatabaseError} If the database is not configured or the delete fails
 */
export async function deleteTurn(id: string): Promise<void> {
	if (!isDatabaseConfigured()) {
		throw new DatabaseError('Database not configured');
	}

	try {
		const { rows } = await pgQuery<{ id: string }>(
			'DELETE FROM conversation_turns WHERE id = $1 RETURNING id',
			[id],
		);

		if (rows.length === 0) {
			throw new NotFoundError(`Conversation turn not found: ${id}`);
		}

		logger.debug('Deleted conversation turn', { id });
	} catch (err: unknown) {
		if (err instanceof NotFoundError) throw err;
		logger.error('Failed to delete turn', {
			error: err instanceof Error ? err.message : String(err),
		});
		throw new DatabaseError('Failed to delete turn');
	}
}

/**
 * Delete all turns in a session that have a turn index greater than the specified
 * index. Useful for conversation rollback/undo operations.
 *
 * @param sessionId - The UUID of the conversation session
 * @param afterIndex - The turn index threshold; turns with index > this value are deleted
 * @returns The number of turns that were deleted
 * @throws {DatabaseError} If the database is not configured or the delete fails
 */
export async function deleteTurnsAfter(sessionId: string, afterIndex: number): Promise<number> {
	if (!isDatabaseConfigured()) {
		throw new DatabaseError('Database not configured');
	}

	try {
		const { rows } = await pgQuery<{ id: string }>(
			'DELETE FROM conversation_turns WHERE session_id = $1 AND turn_index > $2 RETURNING id',
			[sessionId, afterIndex],
		);

		const deletedCount = rows.length;
		logger.info('Deleted turns after index', {
			sessionId,
			afterIndex,
			deletedCount,
		});
		return deletedCount;
	} catch (err: unknown) {
		logger.error('Failed to delete turns', {
			error: err instanceof Error ? err.message : String(err),
		});
		throw new DatabaseError('Failed to delete turns');
	}
}

/**
 * Update the vector embedding for a conversation turn. Typically called
 * asynchronously after turn creation when embeddings are generated in the background.
 *
 * @param id - The UUID of the turn to update
 * @param embedding - The vector embedding to set
 * @returns Resolves when the embedding has been updated
 * @throws {DatabaseError} If the database is not configured or the update fails
 */
export async function updateTurnEmbedding(id: string, embedding: number[]): Promise<void> {
	if (!isDatabaseConfigured()) {
		throw new DatabaseError('Database not configured');
	}

	try {
		await pgQuery('UPDATE conversation_turns SET embedding = $1::vector WHERE id = $2', [
			JSON.stringify(embedding),
			id,
		]);

		logger.debug('Updated turn embedding', { id });
	} catch (err: unknown) {
		logger.error('Failed to update turn embedding', {
			error: err instanceof Error ? err.message : String(err),
		});
		throw new DatabaseError('Failed to update turn embedding');
	}
}

/**
 * Get the total number of turns in a conversation session.
 *
 * @param sessionId - The UUID of the conversation session
 * @returns The number of turns in the session
 * @throws {DatabaseError} If the database is not configured or the count query fails
 */
export async function getTurnCount(sessionId: string): Promise<number> {
	if (!isDatabaseConfigured()) {
		throw new DatabaseError('Database not configured');
	}

	try {
		return await queryCount('SELECT count(*) FROM conversation_turns WHERE session_id = $1', [
			sessionId,
		]);
	} catch (err: unknown) {
		logger.error('Failed to get turn count', {
			error: err instanceof Error ? err.message : String(err),
		});
		throw new DatabaseError('Failed to get turn count');
	}
}
