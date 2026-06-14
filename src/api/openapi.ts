import crypto from 'node:crypto';
import { Router, type Router as RouterType } from 'express';
import { config } from '../utils/config.js';
import { bearerAuth } from './middleware/auth.js';

export const openapiRoutes: RouterType = Router();

// ---------------------------------------------------------------------------
// OpenAPI 3.1 specification
// ---------------------------------------------------------------------------

const spec = {
	openapi: '3.1.0',
	info: {
		title: 'Textrawl API',
		version: '0.3.0',
		description:
			'REST API for the Textrawl knowledge base. Provides unified search, document management, memory graph, conversations, insights, and health endpoints.',
	},
	servers: [{ url: '/' }],
	security: [{ bearerAuth: [] }],
	tags: [
		{ name: 'Search', description: 'Unified search across knowledge base' },
		{ name: 'Documents', description: 'Document CRUD operations' },
		{
			name: 'Memory',
			description: 'Memory graph entities, relations and search (requires ENABLE_MEMORY)',
		},
		{
			name: 'Conversations',
			description: 'Conversation history and search (requires ENABLE_CONVERSATIONS)',
		},
		{ name: 'Insights', description: 'Proactive insights management (requires ENABLE_INSIGHTS)' },
		{ name: 'Health', description: 'Health and readiness probes (no auth required)' },
	],
	components: {
		securitySchemes: {
			bearerAuth: {
				type: 'http',
				scheme: 'bearer',
				description: 'API key passed as a Bearer token in the Authorization header.',
			},
		},
		schemas: {
			Error: {
				type: 'object',
				properties: {
					error: { type: 'string' },
				},
				required: ['error'],
			},
			Document: {
				type: 'object',
				properties: {
					id: { type: 'string', format: 'uuid' },
					title: { type: 'string' },
					content: { type: 'string' },
					metadata: { type: 'object' },
					created_at: { type: 'string', format: 'date-time' },
					updated_at: { type: 'string', format: 'date-time' },
				},
			},
			DocumentList: {
				type: 'object',
				properties: {
					documents: {
						type: 'array',
						items: { $ref: '#/components/schemas/Document' },
					},
					total: { type: 'integer' },
				},
			},
			SearchResult: {
				type: 'object',
				properties: {
					query: { type: 'string' },
					totalResults: { type: 'integer' },
					results: {
						type: 'array',
						items: {
							type: 'object',
							properties: {
								type: { type: 'string', enum: ['document', 'memory', 'conversation'] },
								score: { type: 'number' },
								documentId: { type: 'string' },
								documentTitle: { type: 'string' },
								entityName: { type: 'string' },
								entityType: { type: 'string' },
								sessionId: { type: 'string' },
								title: { type: 'string' },
								content: { type: 'string' },
							},
						},
					},
					counts: {
						type: 'object',
						properties: {
							documents: { type: 'integer' },
							memories: { type: 'integer' },
							conversations: { type: 'integer' },
						},
					},
				},
			},
			Stats: {
				type: 'object',
				properties: {
					documents: { type: 'integer' },
					memories: { type: ['object', 'null'] },
					conversations: { type: ['object', 'null'] },
					insights: { type: ['object', 'null'] },
				},
			},
			Entity: {
				type: 'object',
				properties: {
					name: { type: 'string' },
					type: { type: 'string' },
					observations: { type: 'array', items: { type: 'string' } },
					created_at: { type: 'string', format: 'date-time' },
				},
			},
			Relation: {
				type: 'object',
				properties: {
					relation_type: { type: 'string' },
					to_entity: { type: 'string' },
					to_entity_type: {
						type: 'string',
						enum: [
							'person',
							'concept',
							'project',
							'preference',
							'fact',
							'location',
							'organization',
						],
					},
					from_entity: { type: 'string' },
					from_entity_type: {
						type: 'string',
						enum: [
							'person',
							'concept',
							'project',
							'preference',
							'fact',
							'location',
							'organization',
						],
					},
					strength: { type: 'number', minimum: 0, maximum: 1 },
				},
			},
			EntityContext: {
				type: 'object',
				properties: {
					entity: { $ref: '#/components/schemas/Entity' },
					entity_description: { type: ['string', 'null'] },
					observations: {
						type: 'array',
						items: {
							type: 'object',
							properties: {
								id: { type: 'string', format: 'uuid' },
								content: { type: 'string' },
								source: { type: ['string', 'null'] },
								created_at: { type: 'string', format: 'date-time' },
							},
						},
					},
					outgoing_relations: {
						type: 'array',
						items: { $ref: '#/components/schemas/Relation' },
					},
					incoming_relations: {
						type: 'array',
						items: { $ref: '#/components/schemas/Relation' },
					},
				},
			},
			GraphNode: {
				type: 'object',
				properties: {
					id: { type: 'string', format: 'uuid' },
					name: { type: 'string' },
					type: {
						type: 'string',
						enum: [
							'person',
							'concept',
							'project',
							'preference',
							'fact',
							'location',
							'organization',
						],
					},
					description: { type: ['string', 'null'] },
				},
			},
			GraphEdge: {
				type: 'object',
				properties: {
					id: { type: 'string', format: 'uuid' },
					source: { type: 'string', format: 'uuid', description: 'from_entity_id' },
					target: { type: 'string', format: 'uuid', description: 'to_entity_id' },
					type: { type: 'string' },
					strength: { type: 'number', minimum: 0, maximum: 1 },
				},
			},
			GraphData: {
				type: 'object',
				properties: {
					nodes: { type: 'array', items: { $ref: '#/components/schemas/GraphNode' } },
					edges: { type: 'array', items: { $ref: '#/components/schemas/GraphEdge' } },
				},
			},
			MemorySearchResultItem: {
				type: 'object',
				properties: {
					entity_id: { type: 'string', format: 'uuid' },
					entity_name: { type: 'string' },
					entity_type: { type: 'string' },
					observation_content: { type: 'string' },
					score: { type: 'number' },
					confidence: { type: 'number' },
				},
			},
			MemorySearchResult: {
				type: 'object',
				properties: {
					query: { type: 'string' },
					totalResults: { type: 'integer' },
					results: {
						type: 'array',
						items: { $ref: '#/components/schemas/MemorySearchResultItem' },
					},
				},
			},
			MemoryStats: {
				type: 'object',
				properties: {
					totalEntities: { type: 'integer' },
					totalObservations: { type: 'integer' },
					totalRelations: { type: 'integer' },
					entityTypeCounts: {
						type: 'object',
						additionalProperties: { type: 'integer' },
						description: 'Map of entity type name to count',
					},
				},
			},
			ConversationTurn: {
				type: 'object',
				properties: {
					id: { type: 'string', format: 'uuid' },
					role: { type: 'string', enum: ['user', 'assistant', 'system'] },
					content: { type: 'string' },
					turn_index: { type: 'integer' },
					created_at: { type: 'string', format: 'date-time' },
				},
			},
			ConversationSummary: {
				type: 'object',
				properties: {
					id: { type: 'string', format: 'uuid' },
					session_key: { type: ['string', 'null'] },
					title: { type: ['string', 'null'] },
					summary: { type: ['string', 'null'] },
					turn_count: { type: 'integer' },
					last_activity: { type: 'string', format: 'date-time' },
					created_at: { type: 'string', format: 'date-time' },
				},
			},
			Conversation: {
				type: 'object',
				properties: {
					id: { type: 'string', format: 'uuid' },
					session_key: { type: ['string', 'null'] },
					title: { type: ['string', 'null'] },
					summary: { type: ['string', 'null'] },
					created_at: { type: 'string', format: 'date-time' },
					turns: {
						type: 'array',
						items: { $ref: '#/components/schemas/ConversationTurn' },
					},
				},
			},
			ConversationList: {
				type: 'object',
				properties: {
					conversations: {
						type: 'array',
						items: { $ref: '#/components/schemas/ConversationSummary' },
					},
					total: { type: 'integer' },
				},
			},
			ConversationSearchResultItem: {
				type: 'object',
				properties: {
					session_id: { type: 'string', format: 'uuid' },
					session_key: { type: ['string', 'null'] },
					title: { type: ['string', 'null'] },
					summary: { type: ['string', 'null'] },
					score: { type: 'number' },
				},
			},
			ConversationSearchResult: {
				type: 'object',
				properties: {
					query: { type: 'string' },
					totalResults: { type: 'integer' },
					results: {
						type: 'array',
						items: { $ref: '#/components/schemas/ConversationSearchResultItem' },
					},
				},
			},
			Insight: {
				type: 'object',
				properties: {
					id: { type: 'string', format: 'uuid' },
					insight_type: {
						type: 'string',
						enum: ['cross_source', 'theme_cluster', 'entity_bridge', 'temporal_pattern', 'outlier'],
					},
					title: { type: 'string' },
					summary: { type: 'string' },
					status: { type: 'string', enum: ['new', 'seen', 'dismissed'] },
					evidence: {
						type: 'array',
						items: {
							type: 'object',
							properties: {
								type: { type: 'string' },
								id: { type: 'string' },
								title: { type: 'string' },
								snippet: { type: 'string' },
							},
						},
					},
					entities: { type: 'array', items: { type: 'string' } },
					created_at: { type: 'string', format: 'date-time' },
				},
			},
			InsightList: {
				type: 'object',
				properties: {
					insights: { type: 'array', items: { $ref: '#/components/schemas/Insight' } },
					total: { type: 'integer' },
				},
			},
			InsightStats: {
				type: 'object',
				properties: {
					total: { type: 'integer' },
					new: { type: 'integer' },
					seen: { type: 'integer' },
					dismissed: { type: 'integer' },
					byType: {
						type: 'object',
						additionalProperties: { type: 'integer' },
						description: 'Map of insight type to count',
					},
				},
			},
			HealthCheck: {
				type: 'object',
				properties: {
					status: { type: 'string' },
					timestamp: { type: 'string', format: 'date-time' },
				},
			},
		},
	},
	paths: {
		// ----- Search -----
		'/api/search': {
			get: {
				tags: ['Search'],
				summary: 'Unified search',
				description: 'Search across documents, memories, and conversations.',
				parameters: [
					{
						name: 'q',
						in: 'query',
						required: true,
						schema: { type: 'string' },
						description: 'Search query',
					},
					{
						name: 'limit',
						in: 'query',
						schema: { type: 'integer', default: 10, maximum: 50 },
						description: 'Max results',
					},
					{
						name: 'includeMemories',
						in: 'query',
						schema: { type: 'string', enum: ['true', 'false'] },
						description: 'Include memory results',
					},
					{
						name: 'includeConversations',
						in: 'query',
						schema: { type: 'string', enum: ['true', 'false'] },
						description: 'Include conversation results',
					},
				],
				responses: {
					'200': {
						description: 'Search results',
						content: {
							'application/json': { schema: { $ref: '#/components/schemas/SearchResult' } },
						},
					},
					'400': {
						description: 'Missing query parameter',
						content: { 'application/json': { schema: { $ref: '#/components/schemas/Error' } } },
					},
					'401': { description: 'Unauthorized' },
					'500': {
						description: 'Internal server error',
						content: { 'application/json': { schema: { $ref: '#/components/schemas/Error' } } },
					},
					'503': {
						description: 'Service unavailable — database or embeddings not configured',
						content: { 'application/json': { schema: { $ref: '#/components/schemas/Error' } } },
					},
				},
			},
		},

		// ----- Documents -----
		'/api/documents': {
			get: {
				tags: ['Documents'],
				summary: 'List documents',
				description: 'Retrieve a paginated list of documents.',
				parameters: [
					{
						name: 'limit',
						in: 'query',
						schema: { type: 'integer', default: 20, maximum: 100 },
						description: 'Max documents to return',
					},
					{
						name: 'offset',
						in: 'query',
						schema: { type: 'integer', default: 0 },
						description: 'Pagination offset',
					},
				],
				responses: {
					'200': {
						description: 'Document list',
						content: {
							'application/json': { schema: { $ref: '#/components/schemas/DocumentList' } },
						},
					},
					'401': { description: 'Unauthorized' },
					'503': {
						description: 'Database not available',
						content: { 'application/json': { schema: { $ref: '#/components/schemas/Error' } } },
					},
				},
			},
		},
		'/api/documents/{id}': {
			get: {
				tags: ['Documents'],
				summary: 'Get document',
				description: 'Retrieve a single document by ID.',
				parameters: [
					{
						name: 'id',
						in: 'path',
						required: true,
						schema: { type: 'string', format: 'uuid' },
						description: 'Document ID',
					},
				],
				responses: {
					'200': {
						description: 'Document details',
						content: { 'application/json': { schema: { $ref: '#/components/schemas/Document' } } },
					},
					'401': { description: 'Unauthorized' },
					'404': {
						description: 'Document not found',
						content: { 'application/json': { schema: { $ref: '#/components/schemas/Error' } } },
					},
					'503': {
						description: 'Database not available',
						content: { 'application/json': { schema: { $ref: '#/components/schemas/Error' } } },
					},
				},
			},
		},

		// ----- Upload -----
		'/api/upload': {
			post: {
				tags: ['Documents'],
				summary: 'Upload file',
				description: 'Upload a file for processing and indexing into the knowledge base.',
				requestBody: {
					required: true,
					content: {
						'multipart/form-data': {
							schema: {
								type: 'object',
								properties: {
									file: { type: 'string', format: 'binary', description: 'File to upload' },
								},
								required: ['file'],
							},
						},
					},
				},
				responses: {
					'200': {
						description: 'Upload successful',
						content: {
							'application/json': {
								schema: {
									type: 'object',
									properties: {
										id: { type: 'string' },
										title: { type: 'string' },
										chunks: { type: 'integer' },
									},
								},
							},
						},
					},
					'400': {
						description: 'Bad request',
						content: { 'application/json': { schema: { $ref: '#/components/schemas/Error' } } },
					},
					'401': { description: 'Unauthorized' },
					'500': {
						description: 'Internal server error',
						content: { 'application/json': { schema: { $ref: '#/components/schemas/Error' } } },
					},
				},
			},
		},

		// ----- Stats -----
		'/api/stats': {
			get: {
				tags: ['Documents'],
				summary: 'Knowledge base statistics',
				description:
					'Returns aggregate statistics for documents, memories, conversations, and insights.',
				responses: {
					'200': {
						description: 'Statistics',
						content: { 'application/json': { schema: { $ref: '#/components/schemas/Stats' } } },
					},
					'401': { description: 'Unauthorized' },
					'503': {
						description: 'Database not available',
						content: { 'application/json': { schema: { $ref: '#/components/schemas/Error' } } },
					},
				},
			},
		},

		// ----- Memory -----
		'/api/memory/entities': {
			get: {
				tags: ['Memory'],
				summary: 'List entities',
				description: 'List memory entities with optional type filtering. Requires ENABLE_MEMORY.',
				parameters: [
					{
						name: 'limit',
						in: 'query',
						schema: { type: 'integer', default: 50 },
						description: 'Max entities',
					},
					{
						name: 'offset',
						in: 'query',
						schema: { type: 'integer', default: 0 },
						description: 'Pagination offset',
					},
					{
						name: 'types',
						in: 'query',
						schema: { type: 'string' },
						description: 'Comma-separated entity types to filter by',
					},
				],
				responses: {
					'200': {
						description: 'Entity list',
						content: {
							'application/json': {
								schema: {
									type: 'object',
									properties: {
										entities: { type: 'array', items: { $ref: '#/components/schemas/Entity' } },
										total: { type: 'integer' },
									},
								},
							},
						},
					},
					'401': { description: 'Unauthorized' },
					'404': {
						description: 'Memory feature not enabled',
						content: { 'application/json': { schema: { $ref: '#/components/schemas/Error' } } },
					},
				},
			},
		},
		'/api/memory/entities/{name}': {
			get: {
				tags: ['Memory'],
				summary: 'Get entity context',
				description:
					'Get full context for a named entity including relations. Requires ENABLE_MEMORY.',
				parameters: [
					{
						name: 'name',
						in: 'path',
						required: true,
						schema: { type: 'string' },
						description: 'Entity name',
					},
				],
				responses: {
					'200': {
						description: 'Entity context',
						content: {
							'application/json': { schema: { $ref: '#/components/schemas/EntityContext' } },
						},
					},
					'401': { description: 'Unauthorized' },
					'404': {
						description: 'Entity or feature not found',
						content: { 'application/json': { schema: { $ref: '#/components/schemas/Error' } } },
					},
				},
			},
		},
		'/api/memory/graph': {
			get: {
				tags: ['Memory'],
				summary: 'Graph data',
				description: 'Returns nodes and edges for the memory graph. Requires ENABLE_MEMORY.',
				parameters: [
					{
						name: 'limit',
						in: 'query',
						schema: { type: 'integer', default: 100 },
						description: 'Max nodes',
					},
				],
				responses: {
					'200': {
						description: 'Graph data',
						content: { 'application/json': { schema: { $ref: '#/components/schemas/GraphData' } } },
					},
					'401': { description: 'Unauthorized' },
					'404': {
						description: 'Memory feature not enabled',
						content: { 'application/json': { schema: { $ref: '#/components/schemas/Error' } } },
					},
				},
			},
		},
		'/api/memory/search': {
			get: {
				tags: ['Memory'],
				summary: 'Search memories',
				description: 'Hybrid search across memory entities. Requires ENABLE_MEMORY.',
				parameters: [
					{
						name: 'q',
						in: 'query',
						required: true,
						schema: { type: 'string' },
						description: 'Search query',
					},
					{
						name: 'limit',
						in: 'query',
						schema: { type: 'integer', default: 10 },
						description: 'Max results',
					},
				],
				responses: {
					'200': {
						description: 'Search results',
						content: {
							'application/json': { schema: { $ref: '#/components/schemas/MemorySearchResult' } },
						},
					},
					'400': {
						description: 'Missing query',
						content: { 'application/json': { schema: { $ref: '#/components/schemas/Error' } } },
					},
					'401': { description: 'Unauthorized' },
					'404': {
						description: 'Memory feature not enabled',
						content: { 'application/json': { schema: { $ref: '#/components/schemas/Error' } } },
					},
				},
			},
		},
		'/api/memory/stats': {
			get: {
				tags: ['Memory'],
				summary: 'Memory statistics',
				description: 'Aggregate statistics for the memory graph. Requires ENABLE_MEMORY.',
				responses: {
					'200': {
						description: 'Memory stats',
						content: {
							'application/json': { schema: { $ref: '#/components/schemas/MemoryStats' } },
						},
					},
					'401': { description: 'Unauthorized' },
					'404': {
						description: 'Memory feature not enabled',
						content: { 'application/json': { schema: { $ref: '#/components/schemas/Error' } } },
					},
				},
			},
		},

		// ----- Conversations -----
		'/api/conversations': {
			get: {
				tags: ['Conversations'],
				summary: 'List conversations',
				description: 'Retrieve a paginated list of conversations. Requires ENABLE_CONVERSATIONS.',
				parameters: [
					{
						name: 'limit',
						in: 'query',
						schema: { type: 'integer', default: 20 },
						description: 'Max conversations',
					},
					{
						name: 'offset',
						in: 'query',
						schema: { type: 'integer', default: 0 },
						description: 'Pagination offset',
					},
				],
				responses: {
					'200': {
						description: 'Conversation list',
						content: {
							'application/json': { schema: { $ref: '#/components/schemas/ConversationList' } },
						},
					},
					'401': { description: 'Unauthorized' },
					'404': {
						description: 'Conversations feature not enabled',
						content: { 'application/json': { schema: { $ref: '#/components/schemas/Error' } } },
					},
				},
			},
		},
		'/api/conversations/search': {
			get: {
				tags: ['Conversations'],
				summary: 'Search conversations',
				description: 'Hybrid search across conversation summaries. Requires ENABLE_CONVERSATIONS.',
				parameters: [
					{
						name: 'q',
						in: 'query',
						required: true,
						schema: { type: 'string' },
						description: 'Search query',
					},
					{
						name: 'limit',
						in: 'query',
						schema: { type: 'integer', default: 10 },
						description: 'Max results',
					},
				],
				responses: {
					'200': {
						description: 'Search results',
						content: {
							'application/json': {
								schema: { $ref: '#/components/schemas/ConversationSearchResult' },
							},
						},
					},
					'400': {
						description: 'Missing query',
						content: { 'application/json': { schema: { $ref: '#/components/schemas/Error' } } },
					},
					'401': { description: 'Unauthorized' },
					'404': {
						description: 'Conversations feature not enabled',
						content: { 'application/json': { schema: { $ref: '#/components/schemas/Error' } } },
					},
				},
			},
		},
		'/api/conversations/{id}': {
			get: {
				tags: ['Conversations'],
				summary: 'Get conversation with turns',
				description: 'Retrieve a single conversation and its turns. Requires ENABLE_CONVERSATIONS.',
				parameters: [
					{
						name: 'id',
						in: 'path',
						required: true,
						schema: { type: 'string', format: 'uuid' },
						description: 'Conversation ID',
					},
					{
						name: 'maxTurns',
						in: 'query',
						schema: { type: 'integer' },
						description: 'Max turns to include',
					},
				],
				responses: {
					'200': {
						description: 'Conversation with turns',
						content: {
							'application/json': { schema: { $ref: '#/components/schemas/Conversation' } },
						},
					},
					'401': { description: 'Unauthorized' },
					'404': {
						description: 'Conversation not found or feature not enabled',
						content: { 'application/json': { schema: { $ref: '#/components/schemas/Error' } } },
					},
				},
			},
		},

		// ----- Insights -----
		'/api/insights': {
			get: {
				tags: ['Insights'],
				summary: 'List insights',
				description:
					'Retrieve a paginated, filtered list of proactive insights. Requires ENABLE_INSIGHTS.',
				parameters: [
					{
						name: 'status',
						in: 'query',
						schema: { type: 'string', enum: ['new', 'seen', 'dismissed'] },
						description: 'Filter by status',
					},
					{
						name: 'type',
						in: 'query',
						schema: { type: 'string' },
						description: 'Filter by insight type',
					},
					{
						name: 'limit',
						in: 'query',
						schema: { type: 'integer', default: 20 },
						description: 'Max insights',
					},
					{
						name: 'offset',
						in: 'query',
						schema: { type: 'integer', default: 0 },
						description: 'Pagination offset',
					},
				],
				responses: {
					'200': {
						description: 'Insight list',
						content: {
							'application/json': { schema: { $ref: '#/components/schemas/InsightList' } },
						},
					},
					'401': { description: 'Unauthorized' },
					'404': {
						description: 'Insights feature not enabled',
						content: { 'application/json': { schema: { $ref: '#/components/schemas/Error' } } },
					},
				},
			},
		},
		'/api/insights/scan': {
			post: {
				tags: ['Insights'],
				summary: 'Run an insight scan',
				description:
					'Run a proactive-insight scan synchronously and return the result. Intended to be driven by an external scheduler (e.g. Cloud Scheduler) on a cron. Requires ENABLE_INSIGHTS.',
				requestBody: {
					required: false,
					content: {
						'application/json': {
							schema: {
								type: 'object',
								properties: {
									fullScan: {
										type: 'boolean',
										default: false,
										description: 'Analyze all chunks, not just those added since the last scan',
									},
									maxChunks: {
										type: 'integer',
										minimum: 10,
										maximum: 1000,
										default: 200,
										description: 'Maximum chunks to analyze in this scan',
									},
								},
							},
						},
					},
				},
				responses: {
					'200': {
						description: 'Scan result',
						content: {
							'application/json': {
								schema: {
									type: 'object',
									properties: {
										insightsCreated: { type: 'integer' },
										chunksAnalyzed: { type: 'integer' },
										batchId: { type: 'string' },
									},
									required: ['insightsCreated', 'chunksAnalyzed', 'batchId'],
								},
							},
						},
					},
					'400': {
						description: 'Invalid maxChunks',
						content: { 'application/json': { schema: { $ref: '#/components/schemas/Error' } } },
					},
					'401': { description: 'Unauthorized' },
					'404': {
						description: 'Insights feature not enabled',
						content: { 'application/json': { schema: { $ref: '#/components/schemas/Error' } } },
					},
					'503': {
						description: 'Database not available',
						content: { 'application/json': { schema: { $ref: '#/components/schemas/Error' } } },
					},
				},
			},
		},
		'/api/insights/stats': {
			get: {
				tags: ['Insights'],
				summary: 'Insight statistics',
				description: 'Aggregate statistics for proactive insights. Requires ENABLE_INSIGHTS.',
				responses: {
					'200': {
						description: 'Insight stats',
						content: {
							'application/json': { schema: { $ref: '#/components/schemas/InsightStats' } },
						},
					},
					'401': { description: 'Unauthorized' },
					'404': {
						description: 'Insights feature not enabled',
						content: { 'application/json': { schema: { $ref: '#/components/schemas/Error' } } },
					},
				},
			},
		},
		'/api/insights/{id}/status': {
			patch: {
				tags: ['Insights'],
				summary: 'Update insight status',
				description:
					'Change the status of an insight (e.g. mark as seen or dismissed). Requires ENABLE_INSIGHTS.',
				parameters: [
					{
						name: 'id',
						in: 'path',
						required: true,
						schema: { type: 'string', format: 'uuid' },
						description: 'Insight ID',
					},
				],
				requestBody: {
					required: true,
					content: {
						'application/json': {
							schema: {
								type: 'object',
								properties: {
									status: { type: 'string', enum: ['new', 'seen', 'dismissed'] },
								},
								required: ['status'],
							},
						},
					},
				},
				responses: {
					'200': {
						description: 'Updated insight',
						content: {
							'application/json': {
								schema: {
									type: 'object',
									properties: {
										id: { type: 'string', format: 'uuid' },
										status: { type: 'string', enum: ['new', 'seen', 'dismissed'] },
									},
									required: ['id', 'status'],
								},
							},
						},
					},
					'400': {
						description: 'Invalid status',
						content: { 'application/json': { schema: { $ref: '#/components/schemas/Error' } } },
					},
					'401': { description: 'Unauthorized' },
					'404': {
						description: 'Insight not found or feature not enabled',
						content: { 'application/json': { schema: { $ref: '#/components/schemas/Error' } } },
					},
				},
			},
		},

		// ----- Health -----
		'/health': {
			get: {
				tags: ['Health'],
				summary: 'Basic health check',
				security: [],
				responses: {
					'200': {
						description: 'Healthy',
						content: {
							'application/json': { schema: { $ref: '#/components/schemas/HealthCheck' } },
						},
					},
				},
			},
		},
		'/health/ready': {
			get: {
				tags: ['Health'],
				summary: 'Readiness probe',
				description:
					'Returns 200 when the service is ready to accept traffic (database connected, embeddings configured).',
				security: [],
				responses: {
					'200': {
						description: 'Ready',
						content: {
							'application/json': { schema: { $ref: '#/components/schemas/HealthCheck' } },
						},
					},
					'503': {
						description: 'Not ready',
						content: {
							'application/json': { schema: { $ref: '#/components/schemas/HealthCheck' } },
						},
					},
				},
			},
		},
		'/health/live': {
			get: {
				tags: ['Health'],
				summary: 'Liveness probe',
				description: 'Returns 200 if the process is alive.',
				security: [],
				responses: {
					'200': {
						description: 'Alive',
						content: {
							'application/json': { schema: { $ref: '#/components/schemas/HealthCheck' } },
						},
					},
				},
			},
		},
	},
} as const;

// ---------------------------------------------------------------------------
// GET /api/openapi.json — serve the spec
// ---------------------------------------------------------------------------

// Production-only auth for API docs — open in development for convenience
const docsAuth =
	config.NODE_ENV === 'production'
		? bearerAuth
		: (
				_req: Parameters<typeof bearerAuth>[0],
				_res: Parameters<typeof bearerAuth>[1],
				next: Parameters<typeof bearerAuth>[2],
			) => next();

openapiRoutes.get('/openapi.json', docsAuth, (_req, res) => {
	res.json(spec);
});

// ---------------------------------------------------------------------------
// GET /api/docs — Scalar API reference UI
// ---------------------------------------------------------------------------

openapiRoutes.get('/docs', docsAuth, (_req, res) => {
	const nonce = crypto.randomBytes(16).toString('base64');
	res.setHeader('Content-Type', 'text/html; charset=utf-8');
	res.setHeader(
		'Content-Security-Policy',
		`default-src 'none'; script-src 'nonce-${nonce}' https://cdn.jsdelivr.net; style-src 'unsafe-inline' https://cdn.jsdelivr.net; connect-src 'self'; font-src https://cdn.jsdelivr.net; img-src 'self' data: https:; base-uri 'none'; form-action 'none'`,
	);
	res.send(getDocsHTML(nonce));
});

function getDocsHTML(nonce: string): string {
	return `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>Textrawl API Reference</title>
</head>
<body>
<script
  nonce="${nonce}"
  id="api-reference"
  data-url="/api/openapi.json"
  data-configuration='${JSON.stringify({ theme: 'dark' })}'
>
</script>
<script nonce="${nonce}" src="https://cdn.jsdelivr.net/npm/@scalar/api-reference"></script>
</body>
</html>`;
}
