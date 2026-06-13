import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { z } from 'zod';
import {
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
import { createTurns, getRecentTurns } from '../db/conversation-turns.js';
import { isDatabaseConfigured } from '../db/pg-client.js';
import { generateEmbedding, isOpenAIConfigured } from '../services/embeddings.js';
import { configError, formatId, isCompact, toJSON, toolError } from '../utils/compact.js';
import { logger } from '../utils/logger.js';
import { confirmDestructive } from './lib/confirm.js';

/**
 * Register all conversation-related MCP tools
 */
export function registerConversationTools(server: McpServer): void {
	// ============================================
	// Tool: save_conversation_context
	// ============================================
	server.registerTool(
		'save_conversation_context',
		{
			title: 'Save Conversation',
			description:
				'Save a conversation summary and recent turns for later recall. Use a sessionKey to update an existing conversation. Turns can optionally be embedded for fine-grained search.',
			inputSchema: {
				sessionKey: z
					.string()
					.min(1)
					.max(200)
					.optional()
					.describe('Optional session key to identify this conversation'),
				title: z.string().max(500).optional().describe('Title for this conversation'),
				summary: z
					.string()
					.min(1)
					.max(10000)
					.describe('Summary of the conversation context to save'),
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
			annotations: {
				readOnlyHint: false,
				destructiveHint: false,
				idempotentHint: true,
				openWorldHint: false,
			},
		},
		async ({ sessionKey, title, summary, recentTurns, embedTurns }) => {
			logger.info('save_conversation_context called', {
				sessionKey,
				title,
				summaryLength: summary.length,
				turnCount: recentTurns?.length || 0,
				embedTurns,
			});

			if (!isDatabaseConfigured()) {
				return configError('Database', 'Set DATABASE_URL');
			}

			if (!isOpenAIConfigured()) {
				return configError('Embeddings', 'Set OPENAI_API_KEY or configure Ollama');
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

					savedTurns = await createTurns({
						sessionId: session.id,
						turns: turnsWithEmbeddings,
					});
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
				return toolError('save_conversation_context', error);
			}
		},
	);

	logger.debug('Registered tool: save_conversation_context');

	// ============================================
	// Tool: query_conversations
	// Consolidated: replaces recall_conversation, list_conversations, get_conversation
	// ============================================

	// --- query_conversations Output Schema ---
	const QueryConversationsOutputSchema = {
		mode: z.enum(['search', 'get', 'list']),
		// Search mode fields
		totalResults: z.number().optional(),
		conversations: z
			.array(
				z.object({
					sessionId: z.string(),
					sessionKey: z.string().nullable(),
					title: z.string().nullable(),
					summary: z.string().nullable(),
					score: z.number().optional(),
					turns: z
						.array(
							z.object({
								role: z.string(),
								content: z.string(),
								turnIndex: z.number(),
							}),
						)
						.optional(),
					matchedTurns: z
						.array(
							z.object({
								role: z.string(),
								content: z.string(),
								score: z.number(),
							}),
						)
						.optional(),
					// List mode fields on each conversation
					turnCount: z.number().optional(),
					lastActivity: z.string().nullable().optional(),
					createdAt: z.string().optional(),
				}),
			)
			.optional(),
		// Get mode fields
		found: z.boolean().optional(),
		session: z
			.object({
				id: z.string(),
				sessionKey: z.string().nullable(),
				title: z.string().nullable(),
				summary: z.string().nullable(),
				turnCount: z.number(),
				lastActivity: z.string().nullable(),
				createdAt: z.string(),
			})
			.optional(),
		turns: z
			.array(
				z.object({
					role: z.string(),
					content: z.string(),
					turnIndex: z.number(),
					createdAt: z.string(),
				}),
			)
			.optional(),
		message: z.string().optional(),
		// List mode fields
		total: z.number().optional(),
		returned: z.number().optional(),
		offset: z.number().optional(),
	};

	server.registerTool(
		'query_conversations',
		{
			title: 'Query Conversations',
			description:
				'Query past conversations. mode="search": semantic search across summaries/turns. mode="get": retrieve a specific conversation by ID or key. mode="list": list recent conversations with pagination.',
			inputSchema: {
				mode: z
					.enum(['search', 'get', 'list'])
					.describe(
						'Query mode. "search": search conversations by query. "get": retrieve a specific conversation. "list": list recent conversations.',
					),
				query: z
					.string()
					.min(1)
					.max(1000)
					.optional()
					.describe('Search query (required for mode="search")'),
				searchMode: z
					.enum(['summary', 'turns', 'both'])
					.default('summary')
					.describe('Search summaries, individual turns, or both (for mode="search")'),
				includeTranscript: z
					.boolean()
					.default(false)
					.describe('Include recent turns from matching conversations (for mode="search")'),
				maxTurnsPerConversation: z
					.number()
					.int()
					.min(1)
					.max(50)
					.default(10)
					.describe('Max turns per conversation if includeTranscript=true'),
				sessionId: z.string().optional().describe('Session ID to retrieve (for mode="get")'),
				sessionKey: z.string().optional().describe('Session key to retrieve (for mode="get")'),
				maxTurns: z
					.number()
					.int()
					.min(1)
					.max(200)
					.default(50)
					.describe('Maximum turns to include (for mode="get")'),
				limit: z.number().int().min(1).max(50).default(20).describe('Maximum results to return'),
				offset: z.number().int().min(0).default(0).describe('Pagination offset (for mode="list")'),
			},
			outputSchema: QueryConversationsOutputSchema,
			annotations: {
				readOnlyHint: true,
				destructiveHint: false,
				openWorldHint: false,
			},
		},
		async ({
			mode,
			query,
			searchMode,
			includeTranscript,
			maxTurnsPerConversation,
			sessionId,
			sessionKey,
			maxTurns,
			limit,
			offset,
		}) => {
			logger.info('query_conversations called', { mode, query, sessionId, sessionKey, limit });

			if (!isDatabaseConfigured()) {
				return configError('Database', 'Set DATABASE_URL');
			}

			try {
				switch (mode) {
					// --- Search mode (replaces recall_conversation) ---
					case 'search': {
						if (!query) {
							return toolError('query is required for mode="search"');
						}
						if (!isOpenAIConfigured()) {
							return configError('Embeddings', 'Set OPENAI_API_KEY or configure Ollama');
						}

						const queryEmbedding = await generateEmbedding(query);

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
								limit: limit * 3,
							});

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

							for (const [sid, turns] of sessionTurns) {
								const existing = results.find((r) => r.session_id === sid);
								if (existing) {
									existing.matchedTurns = turns;
									existing.score = existing.score * 1.2;
								} else {
									const session = await getSession(sid);
									results.push({
										session_id: sid,
										session_key: session.session_key,
										title: session.title,
										summary: session.summary,
										score: Math.max(...turns.map((t) => t.score)),
										matchedTurns: turns,
									});
								}
							}
						}

						results.sort((a, b) => b.score - a.score);
						const limitedResults = results.slice(0, limit);

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

						// Build structuredContent (always verbose, canonical keys)
						const structuredContent = {
							mode: 'search' as const,
							totalResults: limitedResults.length,
							conversations: limitedResults.map((r) => ({
								sessionId: r.session_id,
								sessionKey: r.session_key,
								title: r.title,
								summary: r.summary,
								score: Math.round(r.score * 100) / 100,
								turns: r.turns?.map((t) => ({
									role: t.role,
									content: t.content,
									turnIndex: t.turn_index,
								})),
								matchedTurns: r.matchedTurns,
							})),
						};

						// Build content text (compact or verbose)
						const text = isCompact()
							? JSON.stringify({
									n: limitedResults.length,
									c: limitedResults.map((r) => ({
										id: formatId(r.session_id),
										k: r.session_key,
										t: r.title,
										s: Math.round(r.score * 100) / 100,
										sum: r.summary?.slice(0, 200),
										turns: r.turns?.map((t) => ({
											r: t.role[0],
											c: t.content,
										})),
										matched: r.matchedTurns?.slice(0, 3).map((t) => ({
											r: t.role[0],
											c: t.content.slice(0, 100),
										})),
									})),
								})
							: JSON.stringify(structuredContent, null, 2);

						return {
							content: [{ type: 'text' as const, text }],
							structuredContent,
						};
					}

					// --- Get mode (replaces get_conversation) ---
					case 'get': {
						if (!sessionId && !sessionKey) {
							return toolError('Either sessionId or sessionKey is required for mode="get"');
						}

						let resolvedSessionId = sessionId;
						if (!resolvedSessionId && sessionKey) {
							const session = await findSessionByKey(sessionKey);
							if (!session) {
								const structuredContent = {
									mode: 'get' as const,
									found: false,
									message: `No conversation found with key: ${sessionKey}`,
								};
								const text = isCompact()
									? JSON.stringify({ found: false })
									: JSON.stringify(structuredContent, null, 2);
								return {
									content: [{ type: 'text' as const, text }],
									structuredContent,
								};
							}
							resolvedSessionId = session.id;
						}

						if (!resolvedSessionId) {
							return toolError('No session ID resolved');
						}

						const result = await getConversationWithTurns(resolvedSessionId, {
							maxTurns,
						});

						if (!result) {
							const structuredContent = {
								mode: 'get' as const,
								found: false,
								message: `No conversation found with ID: ${resolvedSessionId}`,
							};
							const text = isCompact()
								? JSON.stringify({ found: false })
								: JSON.stringify(structuredContent, null, 2);
							return {
								content: [{ type: 'text' as const, text }],
								structuredContent,
							};
						}

						// Build structuredContent (always verbose, canonical keys)
						const structuredContent = {
							mode: 'get' as const,
							found: true,
							session: {
								id: result.session.id,
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

						// Build content text (compact or verbose)
						const text = isCompact()
							? JSON.stringify({
									id: formatId(result.session.id),
									k: result.session.session_key,
									t: result.session.title,
									sum: result.session.summary,
									n: result.session.turn_count,
									turns: result.turns.map((t) => ({
										r: t.role[0],
										c: t.content,
									})),
								})
							: JSON.stringify(structuredContent, null, 2);

						return {
							content: [{ type: 'text' as const, text }],
							structuredContent,
						};
					}

					// --- List mode (replaces list_conversations) ---
					case 'list': {
						const { sessions, total } = await listSessions({ limit, offset });

						// Build structuredContent (always verbose, canonical keys)
						const structuredContent = {
							mode: 'list' as const,
							total,
							returned: sessions.length,
							offset,
							conversations: sessions.map((s) => ({
								sessionId: s.id,
								sessionKey: s.session_key,
								title: s.title,
								turnCount: s.turn_count,
								lastActivity: s.last_activity,
								createdAt: s.created_at,
							})),
						};

						// Build content text (compact or verbose)
						const text = isCompact()
							? JSON.stringify({
									n: total,
									c: sessions.map((s) => ({
										id: formatId(s.id),
										k: s.session_key,
										t: s.title,
										turns: s.turn_count,
										last: s.last_activity,
									})),
								})
							: JSON.stringify(structuredContent, null, 2);

						return {
							content: [{ type: 'text' as const, text }],
							structuredContent,
						};
					}
				}
			} catch (error) {
				return toolError('query_conversations', error);
			}
		},
	);

	logger.debug('Registered tool: query_conversations');

	// ============================================
	// Tool: delete_conversation
	// ============================================
	server.registerTool(
		'delete_conversation',
		{
			title: 'Delete Conversation',
			description:
				'Permanently delete a conversation session and all its turns. Defaults to a dry run (preview). Set dryRun=false and confirm (or accept the confirmation prompt) to actually delete.',
			inputSchema: {
				sessionId: z.string().optional().describe('Session ID to delete'),
				sessionKey: z.string().optional().describe('Session key to delete'),
				dryRun: z
					.boolean()
					.default(false)
					.describe('Preview only — report what would be deleted without deleting.'),
				confirm: z
					.boolean()
					.default(false)
					.describe(
						'Confirm deletion. Fallback when the client does not support interactive confirmation (elicitation).',
					),
			},
			annotations: {
				readOnlyHint: false,
				destructiveHint: true,
				openWorldHint: false,
			},
		},
		async ({ sessionId, sessionKey, dryRun, confirm }) => {
			logger.info('delete_conversation called', { sessionId, sessionKey, dryRun, confirm });

			if (!sessionId && !sessionKey) {
				return toolError('Either sessionId or sessionKey is required');
			}

			if (!isDatabaseConfigured()) {
				return configError('Database', 'Set DATABASE_URL');
			}

			try {
				// Resolve session ID from key if needed
				let resolvedSessionId = sessionId;
				if (!resolvedSessionId && sessionKey) {
					const session = await findSessionByKey(sessionKey);
					if (!session) {
						return toolError('Conversation not found');
					}
					resolvedSessionId = session.id;
				}

				if (!resolvedSessionId) {
					return toolError('No session ID resolved');
				}

				if (dryRun) {
					return {
						content: [
							{
								type: 'text' as const,
								text: toJSON({
									dryRun: true,
									wouldDelete: { sessionId: formatId(resolvedSessionId) },
									message:
										'Dry run — nothing deleted. Set dryRun=false and confirm to permanently delete this conversation and all its turns.',
								}),
							},
						],
					};
				}

				const confirmation = await confirmDestructive(server, {
					summary: 'permanently delete this conversation and all its turns.',
					confirmParam: confirm,
				});
				if (!confirmation.confirmed) {
					return toolError(
						'delete_conversation',
						new Error(
							'Deletion not confirmed. Set confirm=true (or accept the confirmation prompt) to delete.',
						),
					);
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
				return toolError('delete_conversation', error);
			}
		},
	);

	logger.debug('Registered tool: delete_conversation');
}
