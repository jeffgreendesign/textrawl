import type { ConversationSession } from '../types/database.js';
import { DatabaseError, NotFoundError } from '../utils/errors.js';
import { logger } from '../utils/logger.js';
import {
	isDatabaseConfigured,
	pgQuery,
	queryCount,
	queryOne,
	queryOneOrThrow,
} from './pg-client.js';

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
 * @throws {DatabaseError} If the database is not configured or the insert fails
 */
export async function createSession(input: CreateSessionInput): Promise<ConversationSession> {
	if (!isDatabaseConfigured()) {
		throw new DatabaseError('Database not configured');
	}

	try {
		const data = await queryOneOrThrow<ConversationSession>(
			`INSERT INTO conversation_sessions (session_key, title, summary, summary_embedding, metadata)
			 VALUES ($1, $2, $3, $4::vector, $5)
			 RETURNING *`,
			[
				input.sessionKey || null,
				input.title || null,
				input.summary || null,
				input.summaryEmbedding ? JSON.stringify(input.summaryEmbedding) : null,
				JSON.stringify(input.metadata || {}),
			],
		);

		logger.info('Created conversation session', {
			id: data.id,
			sessionKey: data.session_key,
		});
		return data;
	} catch (err: unknown) {
		// Handle unique constraint violation (session key already exists)
		if (err instanceof Error && 'code' in err && (err as { code: string }).code === '23505') {
			logger.debug('Session key already exists, fetching existing', {
				sessionKey: input.sessionKey,
			});
			if (input.sessionKey) {
				return getSessionByKey(input.sessionKey);
			}
		}
		if (err instanceof NotFoundError || err instanceof DatabaseError) {
			throw err;
		}
		logger.error('Failed to create session', {
			error: err instanceof Error ? err.message : String(err),
		});
		throw new DatabaseError('Failed to create conversation session');
	}
}

/**
 * Get or create a conversation session using an upsert on the session_key unique constraint.
 * If the session already exists, it is updated with the provided fields and returned.
 *
 * @param sessionKey - The unique session key to upsert on
 * @param input - Optional session data (title, summary, embedding, metadata) to set on create/update
 * @returns The existing or newly created conversation session
 * @throws {DatabaseError} If the database is not configured or the upsert fails
 */
export async function getOrCreateSession(
	sessionKey: string,
	input?: Omit<CreateSessionInput, 'sessionKey'>,
): Promise<ConversationSession> {
	if (!isDatabaseConfigured()) {
		throw new DatabaseError('Database not configured');
	}

	// Build dynamic SET clause — only update fields that were explicitly provided
	const setClauses: string[] = [];
	const params: unknown[] = [sessionKey];
	let paramIndex = 2;

	// Always include insert columns/values
	const insertCols = ['session_key'];
	const insertVals = ['$1'];

	if (input?.title !== undefined) {
		insertCols.push('title');
		insertVals.push(`$${paramIndex}`);
		setClauses.push(`title = $${paramIndex}`);
		params.push(input.title);
		paramIndex++;
	}
	if (input?.summary !== undefined) {
		insertCols.push('summary');
		insertVals.push(`$${paramIndex}`);
		setClauses.push(`summary = $${paramIndex}`);
		params.push(input.summary);
		paramIndex++;
	}
	if (input?.summaryEmbedding !== undefined) {
		insertCols.push('summary_embedding');
		insertVals.push(`$${paramIndex}::vector`);
		setClauses.push(`summary_embedding = $${paramIndex}::vector`);
		params.push(JSON.stringify(input.summaryEmbedding));
		paramIndex++;
	}
	if (input?.metadata !== undefined) {
		insertCols.push('metadata');
		insertVals.push(`$${paramIndex}`);
		setClauses.push(`metadata = $${paramIndex}`);
		params.push(JSON.stringify(input.metadata));
		paramIndex++;
	}

	const onConflict =
		setClauses.length > 0
			? `ON CONFLICT (session_key) DO UPDATE SET ${setClauses.join(', ')}`
			: 'ON CONFLICT (session_key) DO NOTHING';

	try {
		// When DO NOTHING fires, no row is returned by RETURNING, so fall back to a SELECT
		const sql = `INSERT INTO conversation_sessions (${insertCols.join(', ')})
			 VALUES (${insertVals.join(', ')})
			 ${onConflict}
			 RETURNING *`;

		const row = await queryOne<ConversationSession>(sql, params);
		if (row) {
			return row;
		}

		// DO NOTHING was triggered — fetch the existing row
		return await queryOneOrThrow<ConversationSession>(
			'SELECT * FROM conversation_sessions WHERE session_key = $1',
			[sessionKey],
			'Session',
		);
	} catch (err: unknown) {
		if (err instanceof NotFoundError || err instanceof DatabaseError) {
			throw err;
		}
		logger.error('Failed to upsert session', {
			error: err instanceof Error ? err.message : String(err),
		});
		throw new DatabaseError('Failed to create or update session');
	}
}

/**
 * Retrieve a conversation session by its UUID.
 *
 * @param id - The UUID of the session to retrieve
 * @returns The conversation session record
 * @throws {NotFoundError} If no session exists with the given ID
 * @throws {DatabaseError} If the database is not configured or the query fails
 */
export async function getSession(id: string): Promise<ConversationSession> {
	if (!isDatabaseConfigured()) {
		throw new DatabaseError('Database not configured');
	}

	try {
		return await queryOneOrThrow<ConversationSession>(
			'SELECT * FROM conversation_sessions WHERE id = $1',
			[id],
			`Session not found: ${id}`,
		);
	} catch (err: unknown) {
		if (err instanceof NotFoundError) throw err;
		logger.error('Failed to get session', {
			error: err instanceof Error ? err.message : String(err),
		});
		throw new DatabaseError('Failed to get session');
	}
}

/**
 * Retrieve a conversation session by its unique session key.
 *
 * @param sessionKey - The unique session key to look up
 * @returns The conversation session record
 * @throws {NotFoundError} If no session exists with the given key
 * @throws {DatabaseError} If the database is not configured or the query fails
 */
export async function getSessionByKey(sessionKey: string): Promise<ConversationSession> {
	if (!isDatabaseConfigured()) {
		throw new DatabaseError('Database not configured');
	}

	try {
		return await queryOneOrThrow<ConversationSession>(
			'SELECT * FROM conversation_sessions WHERE session_key = $1',
			[sessionKey],
			`Session not found: ${sessionKey}`,
		);
	} catch (err: unknown) {
		if (err instanceof NotFoundError) throw err;
		logger.error('Failed to get session by key', {
			error: err instanceof Error ? err.message : String(err),
		});
		throw new DatabaseError('Failed to get session');
	}
}

/**
 * Find a conversation session by its session key. Returns `null` if not found
 * rather than throwing an error.
 *
 * @param sessionKey - The unique session key to search for
 * @returns The conversation session, or `null` if not found
 * @throws {DatabaseError} If the database is not configured or the query fails
 */
export async function findSessionByKey(sessionKey: string): Promise<ConversationSession | null> {
	if (!isDatabaseConfigured()) {
		throw new DatabaseError('Database not configured');
	}

	try {
		return await queryOne<ConversationSession>(
			'SELECT * FROM conversation_sessions WHERE session_key = $1',
			[sessionKey],
		);
	} catch (err: unknown) {
		logger.error('Failed to find session', {
			error: err instanceof Error ? err.message : String(err),
		});
		throw new DatabaseError('Failed to find session');
	}
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
 * @throws {DatabaseError} If the database is not configured or the update fails
 */
export async function updateSession(
	id: string,
	input: UpdateSessionInput,
): Promise<ConversationSession> {
	if (!isDatabaseConfigured()) {
		throw new DatabaseError('Database not configured');
	}

	const setClauses: string[] = [];
	const params: unknown[] = [];
	let paramIndex = 1;

	if (input.title !== undefined) {
		setClauses.push(`title = $${paramIndex++}`);
		params.push(input.title);
	}
	if (input.summary !== undefined) {
		setClauses.push(`summary = $${paramIndex++}`);
		params.push(input.summary);
	}
	if (input.summaryEmbedding !== undefined) {
		setClauses.push(`summary_embedding = $${paramIndex++}::vector`);
		params.push(JSON.stringify(input.summaryEmbedding));
	}
	if (input.metadata !== undefined) {
		setClauses.push(`metadata = $${paramIndex++}`);
		params.push(JSON.stringify(input.metadata));
	}

	if (setClauses.length === 0) {
		return getSession(id);
	}

	params.push(id);

	try {
		const data = await queryOneOrThrow<ConversationSession>(
			`UPDATE conversation_sessions SET ${setClauses.join(', ')} WHERE id = $${paramIndex} RETURNING *`,
			params,
			`Session not found: ${id}`,
		);

		logger.info('Updated conversation session', { id, updates: Object.keys(input) });
		return data;
	} catch (err: unknown) {
		if (err instanceof NotFoundError) throw err;
		logger.error('Failed to update session', {
			error: err instanceof Error ? err.message : String(err),
		});
		throw new DatabaseError('Failed to update session');
	}
}

/**
 * Delete a conversation session by ID. Deletion cascades to all associated
 * conversation turns via database foreign key constraints.
 *
 * @param id - The UUID of the session to delete
 * @returns Resolves when the session has been deleted
 * @throws {DatabaseError} If the database is not configured or the delete fails
 */
export async function deleteSession(id: string): Promise<void> {
	if (!isDatabaseConfigured()) {
		throw new DatabaseError('Database not configured');
	}

	try {
		const { rows } = await pgQuery<{ id: string }>(
			'DELETE FROM conversation_sessions WHERE id = $1 RETURNING id',
			[id],
		);

		if (rows.length === 0) {
			throw new NotFoundError(`Conversation session not found: ${id}`);
		}

		logger.info('Deleted conversation session', { id });
	} catch (err: unknown) {
		if (err instanceof NotFoundError) throw err;
		logger.error('Failed to delete session', {
			error: err instanceof Error ? err.message : String(err),
		});
		throw new DatabaseError('Failed to delete session');
	}
}

/**
 * List conversation sessions with pagination, ordered by most recent activity first.
 *
 * @param options - Pagination options
 * @param options.limit - Maximum number of sessions to return (default: 20)
 * @param options.offset - Number of sessions to skip for pagination (default: 0)
 * @returns An object with the matching sessions array and total count for pagination
 * @throws {DatabaseError} If the database is not configured or the query fails
 */
export async function listSessions(options: {
	limit?: number;
	offset?: number;
}): Promise<{ sessions: ConversationSession[]; total: number }> {
	if (!isDatabaseConfigured()) {
		throw new DatabaseError('Database not configured');
	}

	const { limit = 20, offset = 0 } = options;

	try {
		const [{ rows }, total] = await Promise.all([
			pgQuery<ConversationSession>(
				'SELECT * FROM conversation_sessions ORDER BY last_activity DESC LIMIT $1 OFFSET $2',
				[limit, offset],
			),
			queryCount('SELECT count(*) FROM conversation_sessions'),
		]);

		return { sessions: rows, total };
	} catch (err: unknown) {
		logger.error('Failed to list sessions', {
			error: err instanceof Error ? err.message : String(err),
		});
		throw new DatabaseError('Failed to list sessions');
	}
}

/**
 * Gather aggregate statistics about conversation sessions, including total session
 * and turn counts and the date range of stored sessions.
 *
 * @returns Conversation statistics with session/turn totals and date range
 * @throws {DatabaseError} If the database is not configured or any of the underlying queries fail
 */
export async function getConversationStats(): Promise<{
	totalSessions: number;
	totalTurns: number;
	oldestSession: string | null;
	newestSession: string | null;
}> {
	if (!isDatabaseConfigured()) {
		throw new DatabaseError('Database not configured');
	}

	try {
		const [totalSessions, totalTurns, oldest, newest] = await Promise.all([
			queryCount('SELECT count(*) FROM conversation_sessions'),
			queryCount('SELECT count(*) FROM conversation_turns'),
			queryOne<{ created_at: string }>(
				'SELECT created_at FROM conversation_sessions ORDER BY created_at ASC LIMIT 1',
			),
			queryOne<{ created_at: string }>(
				'SELECT created_at FROM conversation_sessions ORDER BY created_at DESC LIMIT 1',
			),
		]);

		return {
			totalSessions,
			totalTurns,
			oldestSession: oldest?.created_at || null,
			newestSession: newest?.created_at || null,
		};
	} catch (err: unknown) {
		logger.error('Failed to get conversation stats', {
			error: err instanceof Error ? err.message : String(err),
		});
		throw new DatabaseError('Failed to get conversation stats');
	}
}
