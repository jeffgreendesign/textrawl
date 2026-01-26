import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { z } from 'zod';
import { isSupabaseConfigured } from '../db/client.js';
import {
	getConversationSearchStats,
	getConversationWithTurns,
	hybridConversationSearch,
	searchConversationTurns,
} from '../db/conversation-search.js';
import {
	type ConversationSession,
	createSession,
	deleteSession,
	findSessionByKey,
	getOrCreateSession,
	getSession,
	listSessions,
	updateSession,
} from '../db/conversation-sessions.js';
import { createTurns, getRecentTurns, getSessionTurns } from '../db/conversation-turns.js';
import { generateEmbedding, isOpenAIConfigured } from '../services/embeddings.js';
import { config } from '../utils/config.js';
import { logger } from '../utils/logger.js';

/**
 * Check if compact response mode is enabled
 */
const isCompact = () => config.COMPACT_RESPONSES;

/**
 * JSON serialization - compact (no whitespace) or pretty-printed
 */
function toJSON(obj: unknown): string {
	return isCompact() ? JSON.stringify(obj) : JSON.stringify(obj, null, 2);
}

/**
 * Format UUID - truncated (8 chars) in compact mode, full in verbose mode
 */
function formatId(uuid: string): string {
	return isCompact() ? uuid.slice(0, 8) : uuid;
}

/**
 * Register all conversation-related MCP tools
 */
export function registerConversationTools(server: McpServer): void {
	// ============================================
	// Tool: save_conversation_context
	// ============================================
	server.tool(
		'save_conversation_context',
		{
			sessionKey: z
				.string()
				.min(1)
				.max(200)
				.optional()
				.describe('Optional session key to identify this conversation'),
			title: z.string().max(500).optional().describe('Title for this conversation'),
			summary: z.string().min(1).max(10000).describe('Summary of the conversation context to save'),
			recentTurns: z
				.array(
					z.object({
						role: z.enum(['user', 'assistant', 'system']),
						content: z.string().max(50000),
					}),
				)
				.max(50)
				.optional()
				.describe('Recent conversation turns to save'),
			embedTurns: z
				.boolean()
				.default(false)
				.describe(
					'Generate embeddings for individual turns (slower but enables turn-level search)',
				),
		},
		async ({ sessionKey, title, summary, recentTurns, embedTurns }) => {
			logger.info('save_conversation_context called', {
				sessionKey,
				title,
				summaryLength: summary.length,
				turnCount: recentTurns?.length || 0,
				embedTurns,
			});

			if (!isSupabaseConfigured()) {
				return {
					content: [
						{
							type: 'text' as const,
							text: toJSON({
								error: 'Database not configured',
								message: 'Set SUPABASE_URL and SUPABASE_SERVICE_KEY',
							}),
						},
					],
				};
			}

			if (!isOpenAIConfigured()) {
				return {
					content: [
						{
							type: 'text' as const,
							text: toJSON({
								error: 'Embedding not configured',
								message: 'Set OPENAI_API_KEY or configure Ollama',
							}),
						},
					],
				};
			}

			try {
				// Generate embedding for the summary
				const embedStart = Date.now();
				const summaryEmbedding = await generateEmbedding(summary);
				logger.debug('Summary embedding generated', {
					latencyMs: Date.now() - embedStart,
				});

				// Create or update session
				let session: ConversationSession;
				if (sessionKey) {
					session = await getOrCreateSession(sessionKey, {
						title,
						summary,
						summaryEmbedding,
					});

					// Update if session already existed
					if (session.summary !== summary) {
						session = await updateSession(session.id, {
							title,
							summary,
							summaryEmbedding,
						});
					}
				} else {
					session = await createSession({
						title,
						summary,
						summaryEmbedding,
					});
				}

				// Save turns if provided
				let savedTurns = 0;
				if (recentTurns && recentTurns.length > 0) {
					// Generate embeddings for turns if requested
					const turnsWithEmbeddings = await Promise.all(
						recentTurns.map(async (turn) => ({
							role: turn.role,
							content: turn.content,
							embedding: embedTurns ? await generateEmbedding(turn.content) : undefined,
						})),
					);

					const created = await createTurns({
						sessionId: session.id,
						turns: turnsWithEmbeddings,
					});
					savedTurns = created.length;
				}

				logger.info('Conversation context saved', {
					sessionId: session.id,
					sessionKey: session.session_key,
					savedTurns,
				});

				return {
					content: [
						{
							type: 'text' as const,
							text: toJSON(
								isCompact()
									? {
											ok: true,
											id: formatId(session.id),
											key: session.session_key,
											turns: savedTurns,
										}
									: {
											success: true,
											message: 'Conversation context saved',
											sessionId: formatId(session.id),
											sessionKey: session.session_key,
											title: session.title,
											turnsSaved: savedTurns,
										},
							),
						},
					],
				};
			} catch (error) {
				logger.error('save_conversation_context failed', {
					error: error instanceof Error ? error.message : String(error),
				});

				return {
					content: [
						{
							type: 'text' as const,
							text: toJSON({
								ok: false,
								error: error instanceof Error ? error.message : 'Unknown error',
							}),
						},
					],
				};
			}
		},
	);

	logger.debug('Registered tool: save_conversation_context');

	// ============================================
	// Tool: recall_conversation
	// ============================================
	server.tool(
		'recall_conversation',
		{
			query: z.string().min(1).max(1000).describe('What to search for in past conversations'),
			limit: z
				.number()
				.int()
				.min(1)
				.max(20)
				.default(5)
				.describe('Maximum number of conversations to return'),
			searchMode: z
				.enum(['summary', 'turns', 'both'])
				.default('summary')
				.describe('Search summaries only, individual turns, or both'),
			includeTranscript: z
				.boolean()
				.default(false)
				.describe('Include recent turns from matching conversations'),
			maxTurnsPerConversation: z
				.number()
				.int()
				.min(1)
				.max(50)
				.default(10)
				.describe('Max turns to include per conversation if includeTranscript is true'),
		},
		async ({ query, limit, searchMode, includeTranscript, maxTurnsPerConversation }) => {
			logger.info('recall_conversation called', {
				query,
				limit,
				searchMode,
				includeTranscript,
			});

			if (!isSupabaseConfigured()) {
				return {
					content: [
						{
							type: 'text' as const,
							text: toJSON({ error: 'Database not configured' }),
						},
					],
				};
			}

			if (!isOpenAIConfigured()) {
				return {
					content: [
						{
							type: 'text' as const,
							text: toJSON({ error: 'Embedding not configured' }),
						},
					],
				};
			}

			try {
				// Generate embedding for the query
				const embedStart = Date.now();
				const queryEmbedding = await generateEmbedding(query);
				logger.debug('Query embedding generated', {
					latencyMs: Date.now() - embedStart,
				});

				const results: Array<{
					session_id: string;
					session_key: string | null;
					title: string | null;
					summary: string | null;
					score: number;
					turns?: Array<{ role: string; content: string; turn_index: number }>;
					matchedTurns?: Array<{ content: string; role: string; score: number }>;
				}> = [];

				// Search summaries
				if (searchMode === 'summary' || searchMode === 'both') {
					const summaryResults = await hybridConversationSearch(query, queryEmbedding, {
						limit,
					});

					for (const result of summaryResults) {
						results.push({
							session_id: result.session_id,
							session_key: result.session_key,
							title: result.title,
							summary: result.summary,
							score: result.score,
						});
					}
				}

				// Search individual turns
				if (searchMode === 'turns' || searchMode === 'both') {
					const turnResults = await searchConversationTurns(query, queryEmbedding, {
						limit: limit * 3, // Get more to dedupe by session
					});

					// Group by session and add to results
					const sessionTurns = new Map<
						string,
						Array<{ content: string; role: string; score: number }>
					>();
					for (const turn of turnResults) {
						if (!sessionTurns.has(turn.session_id)) {
							sessionTurns.set(turn.session_id, []);
						}
						sessionTurns.get(turn.session_id)?.push({
							content: turn.content,
							role: turn.role,
							score: turn.score,
						});
					}

					// Merge with existing results or add new
					for (const [sessionId, turns] of sessionTurns) {
						const existing = results.find((r) => r.session_id === sessionId);
						if (existing) {
							existing.matchedTurns = turns;
							// Boost score if turns also matched
							existing.score = existing.score * 1.2;
						} else {
							// Need to fetch session info
							const session = await getSession(sessionId);
							results.push({
								session_id: sessionId,
								session_key: session.session_key,
								title: session.title,
								summary: session.summary,
								score: Math.max(...turns.map((t) => t.score)),
								matchedTurns: turns,
							});
						}
					}
				}

				// Sort by score and limit
				results.sort((a, b) => b.score - a.score);
				const limitedResults = results.slice(0, limit);

				// Include transcript if requested
				if (includeTranscript) {
					for (const result of limitedResults) {
						const turns = await getRecentTurns(result.session_id, maxTurnsPerConversation);
						result.turns = turns.map((t) => ({
							role: t.role,
							content: t.content,
							turn_index: t.turn_index,
						}));
					}
				}

				logger.info('recall_conversation completed', {
					resultCount: limitedResults.length,
				});

				// Format response
				const response = isCompact()
					? {
							n: limitedResults.length,
							c: limitedResults.map((r) => ({
								id: formatId(r.session_id),
								k: r.session_key,
								t: r.title,
								s: Math.round(r.score * 100) / 100,
								sum: r.summary?.slice(0, 200),
								turns: r.turns?.map((t) => ({ r: t.role[0], c: t.content })),
								matched: r.matchedTurns
									?.slice(0, 3)
									.map((t) => ({ r: t.role[0], c: t.content.slice(0, 100) })),
							})),
						}
					: {
							query,
							totalResults: limitedResults.length,
							conversations: limitedResults.map((r) => ({
								sessionId: formatId(r.session_id),
								sessionKey: r.session_key,
								title: r.title,
								summary: r.summary,
								score: Math.round(r.score * 100) / 100,
								turns: r.turns,
								matchedTurns: r.matchedTurns,
							})),
						};

				return {
					content: [
						{
							type: 'text' as const,
							text: toJSON(response),
						},
					],
				};
			} catch (error) {
				logger.error('recall_conversation failed', {
					error: error instanceof Error ? error.message : String(error),
				});

				return {
					content: [
						{
							type: 'text' as const,
							text: toJSON({
								ok: false,
								error: error instanceof Error ? error.message : 'Unknown error',
							}),
						},
					],
				};
			}
		},
	);

	logger.debug('Registered tool: recall_conversation');

	// ============================================
	// Tool: list_conversations
	// ============================================
	server.tool(
		'list_conversations',
		{
			limit: z
				.number()
				.int()
				.min(1)
				.max(50)
				.default(20)
				.describe('Maximum number of conversations to return'),
			offset: z.number().int().min(0).default(0).describe('Pagination offset'),
		},
		async ({ limit, offset }) => {
			logger.info('list_conversations called', { limit, offset });

			if (!isSupabaseConfigured()) {
				return {
					content: [
						{
							type: 'text' as const,
							text: toJSON({ error: 'Database not configured' }),
						},
					],
				};
			}

			try {
				const { sessions, total } = await listSessions({ limit, offset });

				const response = isCompact()
					? {
							n: total,
							c: sessions.map((s) => ({
								id: formatId(s.id),
								k: s.session_key,
								t: s.title,
								turns: s.turn_count,
								last: s.last_activity,
							})),
						}
					: {
							total,
							returned: sessions.length,
							offset,
							conversations: sessions.map((s) => ({
								sessionId: formatId(s.id),
								sessionKey: s.session_key,
								title: s.title,
								turnCount: s.turn_count,
								lastActivity: s.last_activity,
								createdAt: s.created_at,
							})),
						};

				return {
					content: [
						{
							type: 'text' as const,
							text: toJSON(response),
						},
					],
				};
			} catch (error) {
				logger.error('list_conversations failed', {
					error: error instanceof Error ? error.message : String(error),
				});

				return {
					content: [
						{
							type: 'text' as const,
							text: toJSON({
								ok: false,
								error: error instanceof Error ? error.message : 'Unknown error',
							}),
						},
					],
				};
			}
		},
	);

	logger.debug('Registered tool: list_conversations');

	// ============================================
	// Tool: get_conversation
	// ============================================
	server.tool(
		'get_conversation',
		{
			sessionId: z.string().optional().describe('Session ID to retrieve'),
			sessionKey: z.string().optional().describe('Session key to retrieve'),
			maxTurns: z.number().int().min(1).max(200).default(50).describe('Maximum turns to include'),
		},
		async ({ sessionId, sessionKey, maxTurns }) => {
			logger.info('get_conversation called', { sessionId, sessionKey, maxTurns });

			if (!sessionId && !sessionKey) {
				return {
					content: [
						{
							type: 'text' as const,
							text: toJSON({ error: 'Either sessionId or sessionKey is required' }),
						},
					],
				};
			}

			if (!isSupabaseConfigured()) {
				return {
					content: [
						{
							type: 'text' as const,
							text: toJSON({ error: 'Database not configured' }),
						},
					],
				};
			}

			try {
				// Resolve session ID from key if needed
				let resolvedSessionId = sessionId;
				if (!resolvedSessionId && sessionKey) {
					const session = await findSessionByKey(sessionKey);
					if (!session) {
						return {
							content: [
								{
									type: 'text' as const,
									text: toJSON(
										isCompact()
											? { found: false }
											: { found: false, message: `No conversation found with key: ${sessionKey}` },
									),
								},
							],
						};
					}
					resolvedSessionId = session.id;
				}

				if (!resolvedSessionId) {
					return {
						content: [
							{
								type: 'text' as const,
								text: toJSON({ error: 'No session ID resolved' }),
							},
						],
					};
				}

				const result = await getConversationWithTurns(resolvedSessionId, { maxTurns });

				if (!result) {
					return {
						content: [
							{
								type: 'text' as const,
								text: toJSON(
									isCompact()
										? { found: false }
										: {
												found: false,
												message: `No conversation found with ID: ${resolvedSessionId}`,
											},
								),
							},
						],
					};
				}

				const response = isCompact()
					? {
							id: formatId(result.session.id),
							k: result.session.session_key,
							t: result.session.title,
							sum: result.session.summary,
							n: result.session.turn_count,
							turns: result.turns.map((t) => ({
								r: t.role[0],
								c: t.content,
							})),
						}
					: {
							found: true,
							session: {
								id: formatId(result.session.id),
								sessionKey: result.session.session_key,
								title: result.session.title,
								summary: result.session.summary,
								turnCount: result.session.turn_count,
								lastActivity: result.session.last_activity,
								createdAt: result.session.created_at,
							},
							turns: result.turns.map((t) => ({
								role: t.role,
								content: t.content,
								turnIndex: t.turn_index,
								createdAt: t.created_at,
							})),
						};

				return {
					content: [
						{
							type: 'text' as const,
							text: toJSON(response),
						},
					],
				};
			} catch (error) {
				logger.error('get_conversation failed', {
					error: error instanceof Error ? error.message : String(error),
				});

				return {
					content: [
						{
							type: 'text' as const,
							text: toJSON({
								ok: false,
								error: error instanceof Error ? error.message : 'Unknown error',
							}),
						},
					],
				};
			}
		},
	);

	logger.debug('Registered tool: get_conversation');

	// ============================================
	// Tool: delete_conversation
	// ============================================
	server.tool(
		'delete_conversation',
		{
			sessionId: z.string().optional().describe('Session ID to delete'),
			sessionKey: z.string().optional().describe('Session key to delete'),
			confirm: z.boolean().describe('Must be true to confirm deletion'),
		},
		async ({ sessionId, sessionKey, confirm }) => {
			logger.info('delete_conversation called', { sessionId, sessionKey, confirm });

			if (!confirm) {
				return {
					content: [
						{
							type: 'text' as const,
							text: toJSON({ error: 'Set confirm=true to delete' }),
						},
					],
				};
			}

			if (!sessionId && !sessionKey) {
				return {
					content: [
						{
							type: 'text' as const,
							text: toJSON({ error: 'Either sessionId or sessionKey is required' }),
						},
					],
				};
			}

			if (!isSupabaseConfigured()) {
				return {
					content: [
						{
							type: 'text' as const,
							text: toJSON({ error: 'Database not configured' }),
						},
					],
				};
			}

			try {
				// Resolve session ID from key if needed
				let resolvedSessionId = sessionId;
				if (!resolvedSessionId && sessionKey) {
					const session = await findSessionByKey(sessionKey);
					if (!session) {
						return {
							content: [
								{
									type: 'text' as const,
									text: toJSON({ ok: false, error: 'Conversation not found' }),
								},
							],
						};
					}
					resolvedSessionId = session.id;
				}

				if (!resolvedSessionId) {
					return {
						content: [
							{
								type: 'text' as const,
								text: toJSON({ error: 'No session ID resolved' }),
							},
						],
					};
				}

				await deleteSession(resolvedSessionId);

				logger.info('Conversation deleted', { sessionId: resolvedSessionId });

				return {
					content: [
						{
							type: 'text' as const,
							text: toJSON(
								isCompact()
									? { ok: true }
									: {
											success: true,
											message: 'Conversation deleted',
											deletedSessionId: formatId(resolvedSessionId),
										},
							),
						},
					],
				};
			} catch (error) {
				logger.error('delete_conversation failed', {
					error: error instanceof Error ? error.message : String(error),
				});

				return {
					content: [
						{
							type: 'text' as const,
							text: toJSON({
								ok: false,
								error: error instanceof Error ? error.message : 'Unknown error',
							}),
						},
					],
				};
			}
		},
	);

	logger.debug('Registered tool: delete_conversation');

	// ============================================
	// Tool: conversation_stats
	// ============================================
	server.tool('conversation_stats', {}, async () => {
		logger.info('conversation_stats called');

		if (!isSupabaseConfigured()) {
			return {
				content: [
					{
						type: 'text' as const,
						text: toJSON({ error: 'Database not configured' }),
					},
				],
			};
		}

		try {
			const stats = await getConversationSearchStats();

			const response = isCompact()
				? {
						sess: stats.totalSessions,
						indexed: stats.sessionsWithSummary,
						turns: stats.totalTurns,
						turnIdx: stats.turnsWithEmbedding,
					}
				: {
						totalSessions: stats.totalSessions,
						sessionsWithSearchableIndex: stats.sessionsWithSummary,
						totalTurns: stats.totalTurns,
						turnsWithSearchableIndex: stats.turnsWithEmbedding,
					};

			return {
				content: [
					{
						type: 'text' as const,
						text: toJSON(response),
					},
				],
			};
		} catch (error) {
			logger.error('conversation_stats failed', {
				error: error instanceof Error ? error.message : String(error),
			});

			return {
				content: [
					{
						type: 'text' as const,
						text: toJSON({
							ok: false,
							error: error instanceof Error ? error.message : 'Unknown error',
						}),
					},
				],
			};
		}
	});

	logger.debug('Registered tool: conversation_stats');
}
