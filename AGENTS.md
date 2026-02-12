# AGENTS.md

Agent conventions for Textrawl - Personal Knowledge MCP Server.

## Quick Reference

| Aspect | Value |
|--------|-------|
| MCP Endpoint | `POST /mcp` |
| Transport | StreamableHTTPServerTransport (stateless HTTP) |
| Auth | Bearer token (`Authorization: Bearer <API_BEARER_TOKEN>`) |
| Rate Limits | API: 100/min, Upload: 10/min |
| Node.js | >= 22.0.0 |
| Response Format | Compact by default (`COMPACT_RESPONSES=true`) |

## Compact Response Format

Memory tools return token-efficient responses by default (40-60% smaller). Set `COMPACT_RESPONSES=false` for verbose mode.

**Key mappings (compact → verbose):**

- `n` → `name` or `count` (context-dependent)
- `t` → `type`
- `o` → `observations`
- `m` → `memories`
- `c` → `content`
- `s` → `score`
- `r` → `relations`
- `ok` → `success`
- `dup` → `duplicate`
- `ent`/`obs`/`rel` → `totalEntities`/`totalObservations`/`totalRelations`

**Example (`query_memory` compact response):**

```json
{"n":2,"e":[{"n":"Jeff","t":"person","m":[{"c":"prefers dark mode","s":0.92}]}]}
```

**Same response in verbose mode:**

```json
{
  "query": "preferences",
  "totalMemories": 2,
  "entities": [
    {
      "entityName": "Jeff",
      "entityType": "person",
      "memories": [
        {"content": "prefers dark mode", "source": "conversation", "score": 0.92}
      ]
    }
  ]
}
```

## Tool Selection Guide

### Search (18 tools total)

| User Intent | Tool | Key Parameters |
|-------------|------|----------------|
| Find content by meaning | `search` | `query`, `semanticWeight: 1.5` |
| Find exact phrases/keywords | `search` | `query`, `fullTextWeight: 1.5` |
| Balanced hybrid search | `search` | `query` (default weights) |
| Search across all sources | `search` | `query`, `includeMemories: true`, `includeConversations: true` |

### Document Tools

| User Intent | Tool | Key Parameters |
|-------------|------|----------------|
| Get full document content | `get_document` | `documentId` |
| Browse all documents | `list_documents` | `limit`, `offset` |
| Filter by type | `list_documents` | `sourceType: 'note' \| 'file' \| 'url'` |
| Create new knowledge | `add_note` | `title`, `content`, `tags` |
| Update metadata | `update_document` | `documentId`, `title`, `tags` |

### Memory Tools (Persistent Memory)

Enable with `ENABLE_MEMORY=true` (default). Requires `setup-db-memory.sql` (OpenAI) or `setup-db-memory-ollama.sql` (Ollama).

| User Intent | Tool | Key Parameters |
|-------------|------|----------------|
| Remember facts about people/projects | `remember_fact` | `entityName`, `entityType`, `observation` |
| Search past memories | `query_memory` | `mode: 'search'`, `query` |
| Get all info about an entity | `query_memory` | `mode: 'entity'`, `entityName` |
| List all known entities | `query_memory` | `mode: 'list'`, `entityTypes`, `limit` |
| Connect entities together | `relate_entities` | `fromEntity`, `relation`, `toEntity` |
| Delete an entity completely | `forget_entity` | `entityName`, `confirm: true` |
| Extract entities from text | `extract_memories` | `text`, `source`, `storeResults` |

### Conversation Tools (Conversation Memory)

Enable with `ENABLE_CONVERSATIONS=true` (default). Requires `setup-db-conversation.sql` (OpenAI) or `setup-db-conversation-ollama.sql` (Ollama).

| User Intent | Tool | Key Parameters |
|-------------|------|----------------|
| Save conversation for later recall | `save_conversation_context` | `summary`, `recentTurns`, `sessionKey` |
| Search past conversations | `query_conversations` | `mode: 'search'`, `query` |
| Browse conversation history | `query_conversations` | `mode: 'list'`, `limit`, `offset` |
| Get full conversation transcript | `query_conversations` | `mode: 'get'`, `sessionId` or `sessionKey` |
| Delete a conversation | `delete_conversation` | `sessionId` or `sessionKey`, `confirm: true` |

### Stats

| User Intent | Tool | Key Parameters |
|-------------|------|----------------|
| Get all statistics | `get_stats` | `scope: 'all'` |
| Get knowledge base statistics | `get_stats` | `scope: 'knowledge'` |
| Get memory statistics | `get_stats` | `scope: 'memory'` |
| Get conversation statistics | `get_stats` | `scope: 'conversations'` |
| Get insight queue stats | `get_stats` | `scope: 'insights'` |

### Insight Tools (Proactive Discovery)

Enable with `ENABLE_INSIGHTS=true` (default).

| User Intent | Tool | Key Parameters |
|-------------|------|----------------|
| View discovered patterns/connections | `get_insights` | `status`, `insightType`, `query` |
| Trigger insight scan | `discover_connections` | `fullScan`, `maxChunks` |
| Dismiss an insight | `dismiss_insight` | `insightId` |

## Tool Schemas (RFC 2119)

### search

Hybrid semantic + full-text search using Reciprocal Rank Fusion. Consolidates `search_knowledge` and `search_with_context` into a single tool. By default searches documents only; set `includeMemories` and/or `includeConversations` to search across all sources.

**Parameters:**

- `query` (string, REQUIRED): Natural language search query (1-10000 chars)
- `limit` (number, OPTIONAL): Max results 1-50, default 10
- `fullTextWeight` (number, OPTIONAL): Keyword matching weight 0-2, default 1.0
- `semanticWeight` (number, OPTIONAL): Semantic similarity weight 0-2, default 1.0
- `tags` (string[], OPTIONAL): Filter to docs with ALL specified tags
- `sourceType` (enum, OPTIONAL): `'note' | 'file' | 'url'`
- `minScore` (number, OPTIONAL): Minimum relevance score 0-1
- `includeMemories` (boolean, OPTIONAL): Also search memories, default false
- `includeConversations` (boolean, OPTIONAL): Also search conversations, default false

**Response:**

```json
{
  "query": "...",
  "filters": { "tags": null, "sourceType": null, "minScore": null },
  "totalResults": 5,
  "results": [
    {
      "documentId": "uuid",
      "documentTitle": "...",
      "sourceType": "note",
      "tags": ["tag1"],
      "chunkId": "uuid",
      "content": "...",
      "score": 0.85
    }
  ]
}
```

### get_document

Retrieve full document content by ID.

**Parameters:**

- `documentId` (UUID, REQUIRED): The document UUID
- `includeChunks` (boolean, OPTIONAL): Include chunks in response, default false

**Response:**

```json
{
  "document": {
    "id": "uuid",
    "title": "...",
    "sourceType": "note",
    "sourceUrl": null,
    "content": "...",
    "metadata": { "tags": [] },
    "createdAt": "2025-01-01T00:00:00Z",
    "updatedAt": "2025-01-01T00:00:00Z"
  },
  "chunks": [{ "id": "uuid", "index": 0, "content": "..." }]
}
```

### list_documents

List documents with pagination and filtering.

**Parameters:**

- `limit` (number, OPTIONAL): 1-100, default 20
- `offset` (number, OPTIONAL): Pagination offset, default 0
- `sourceType` (enum, OPTIONAL): `'note' | 'file' | 'url'`
- `tags` (string[], OPTIONAL): Filter to docs with ALL specified tags

**Response:**

```json
{
  "documents": [
    {
      "id": "uuid",
      "title": "...",
      "sourceType": "note",
      "tags": [],
      "createdAt": "...",
      "updatedAt": "..."
    }
  ],
  "pagination": { "limit": 20, "offset": 0, "total": 100, "hasMore": true }
}
```

### update_document

Update document title and/or tags.

**Parameters:**

- `documentId` (UUID, REQUIRED): The document UUID to update
- `title` (string, OPTIONAL): New title (min 1 char)
- `tags` (string[], OPTIONAL): New tags (replaces existing)

MUST provide at least one of `title` or `tags`.

**Response:**

```json
{
  "success": true,
  "document": {
    "id": "uuid",
    "title": "...",
    "sourceType": "note",
    "tags": [],
    "updatedAt": "..."
  }
}
```

### add_note

Create markdown notes with automatic chunking and embedding.

**Parameters:**

- `title` (string, REQUIRED): Note title (1-500 chars)
- `content` (string, REQUIRED): Note content in markdown (1 char - 1MB)
- `tags` (string[], OPTIONAL): Tags for organization

**Response:**

```json
{
  "success": true,
  "documentId": "uuid",
  "title": "...",
  "chunksCreated": 3,
  "message": "Note saved and indexed for search."
}
```

### remember_fact

Store facts about entities (people, projects, concepts) with automatic semantic embedding.

**Parameters:**

- `entityName` (string, REQUIRED): Name of entity (e.g., "Jeff", "Project Alpha")
- `entityType` (enum, REQUIRED): `'person' | 'concept' | 'project' | 'preference' | 'fact' | 'location' | 'organization'`
- `observation` (string, REQUIRED): Single atomic fact to remember (max 2000 chars)
- `source` (enum, OPTIONAL): `'conversation' | 'note' | 'document' | 'manual'`, default 'conversation'
- `validUntil` (string, OPTIONAL): ISO date for expiring facts (e.g., "2026-12-31")

**Response:**

```json
{
  "success": true,
  "message": "Remembered: \"prefers dark mode\" about Jeff",
  "entityId": "uuid",
  "entityName": "Jeff",
  "entityType": "person",
  "observationId": "uuid"
}
```

### build_knowledge

Store multiple facts and relations in a single call. Prefer this over separate `remember_fact` and `relate_entities` calls for batch operations.

**Parameters:**

- `facts` (array, OPTIONAL): Array of facts to store (max 50)
  - `entityName` (string, REQUIRED): Entity name (1-200 chars)
  - `entityType` (enum, REQUIRED): `'person' | 'concept' | 'project' | 'preference' | 'fact' | 'location' | 'organization'`
  - `observation` (string, REQUIRED): Fact to remember (1-2000 chars)
  - `source` (enum, OPTIONAL): `'conversation' | 'note' | 'document' | 'manual'`, default 'conversation'
- `relations` (array, OPTIONAL): Array of relations to create (max 50)
  - `fromEntity` (string, REQUIRED): Source entity name
  - `relation` (string, REQUIRED): Relationship type (e.g., "works on", "manages")
  - `toEntity` (string, REQUIRED): Target entity name
  - `fromEntityType` (enum, OPTIONAL): Type of source entity
  - `toEntityType` (enum, OPTIONAL): Type of target entity

**Response:**

```json
{
  "success": true,
  "factsCreated": 3,
  "factsDuplicate": 0,
  "relationsCreated": 2
}
```

### query_memory

Unified memory query tool. Consolidates `recall_memories`, `get_entity_context`, and `list_entities` into a single tool with a `mode` parameter.

**Parameters (all modes):**

- `mode` (enum, REQUIRED): `'search' | 'entity' | 'list'`

**Parameters (mode: 'search'):**

Semantic search across stored memories using hybrid (keyword + semantic) or semantic-only mode.

- `query` (string, REQUIRED): What to search for (1-1000 chars)
- `entityTypes` (enum[], OPTIONAL): Filter by entity types
- `limit` (number, OPTIONAL): Max results 1-50, default 10
- `searchMode` (enum, OPTIONAL): `'hybrid' | 'semantic'`, default 'hybrid'

**Response (mode: 'search'):**

```json
{
  "query": "...",
  "totalMemories": 5,
  "entities": [
    {
      "entityName": "Jeff",
      "entityType": "person",
      "memories": [
        { "content": "prefers dark mode", "source": "conversation", "confidence": 1.0, "score": 0.85 }
      ]
    }
  ]
}
```

**Parameters (mode: 'entity'):**

Retrieve all information about an entity including observations and relations.

- `entityName` (string, REQUIRED): Name of entity to look up
- `includeRelated` (boolean, OPTIONAL): Include relations, default true

**Response (mode: 'entity'):**

```json
{
  "found": true,
  "entity": { "id": "uuid", "name": "Jeff", "type": "person", "description": null },
  "observations": [
    { "id": "uuid", "content": "prefers dark mode", "source": "conversation", "confidence": 1.0, "created_at": "..." }
  ],
  "relations": {
    "outgoing": [{ "relation_type": "works_at", "to_entity": "Acme Corp", "to_entity_type": "organization", "strength": 1.0 }],
    "incoming": []
  }
}
```

**Parameters (mode: 'list'):**

List all known entities with pagination.

- `entityTypes` (enum[], OPTIONAL): Filter by entity types
- `limit` (number, OPTIONAL): 1-100, default 50
- `offset` (number, OPTIONAL): Pagination offset, default 0

**Response (mode: 'list'):**

```json
{
  "total": 25,
  "returned": 25,
  "offset": 0,
  "entities": [
    { "id": "uuid", "name": "Jeff", "type": "person", "description": null, "updatedAt": "..." }
  ]
}
```

### relate_entities

Create directed relationships between entities.

**Parameters:**

- `fromEntity` (string, REQUIRED): Source entity name
- `relation` (string, REQUIRED): Relation type (e.g., "works_at", "prefers", "knows", "created", "part_of")
- `toEntity` (string, REQUIRED): Target entity name
- `fromEntityType` (enum, OPTIONAL): Type of source entity
- `toEntityType` (enum, OPTIONAL): Type of target entity

**Response:**

```json
{
  "success": true,
  "message": "Created relation: Jeff works_at Acme Corp",
  "relationId": "uuid",
  "fromEntity": { "id": "uuid", "name": "Jeff", "type": "person" },
  "toEntity": { "id": "uuid", "name": "Acme Corp", "type": "organization" }
}
```

### forget_entity

Delete an entity and all its associated memories and relations.

**Parameters:**

- `entityName` (string, REQUIRED): Name of entity to delete
- `confirm` (boolean, REQUIRED): Must be true to confirm deletion

**Response:**

```json
{
  "success": true,
  "message": "Forgotten: Jeff and all associated memories",
  "deletedEntityId": "uuid"
}
```

### extract_memories

Extract entities and facts from text using LLM analysis. Requires `ENABLE_MEMORY_EXTRACTION=true` and `ANTHROPIC_API_KEY`.

**Parameters:**

- `text` (string, REQUIRED): Text to extract entities and facts from (10-100000 chars)
- `source` (enum, OPTIONAL): `'conversation' | 'note' | 'document' | 'manual'`, default 'document'
- `storeResults` (boolean, OPTIONAL): Store extracted memories in database, default false (preview only)

### save_conversation_context

Save conversation summary and turns for later recall.

**Parameters:**

- `summary` (string, REQUIRED): Summary of the conversation context (1-10000 chars)
- `sessionKey` (string, OPTIONAL): Key to identify this conversation (1-200 chars)
- `title` (string, OPTIONAL): Title for this conversation (max 500 chars)
- `recentTurns` (array, OPTIONAL): Recent turns to save (max 50), each with `role` and `content`
- `embedTurns` (boolean, OPTIONAL): Generate embeddings for individual turns, default false

### query_conversations

Unified conversation query tool. Consolidates `recall_conversation`, `get_conversation`, and `list_conversations` into a single tool with a `mode` parameter.

**Parameters (all modes):**

- `mode` (enum, REQUIRED): `'search' | 'get' | 'list'`

**Parameters (mode: 'search'):**

Semantic search across past conversations.

- `query` (string, REQUIRED): What to search for (1-1000 chars)
- `limit` (number, OPTIONAL): Max results 1-20, default 5
- `searchMode` (enum, OPTIONAL): `'summary' | 'turns' | 'both'`, default 'summary'
- `includeTranscript` (boolean, OPTIONAL): Include recent turns, default false
- `maxTurnsPerConversation` (number, OPTIONAL): Max turns per conversation, default 10

**Parameters (mode: 'get'):**

Get full conversation by session ID or key.

- `sessionId` (string, OPTIONAL): Session ID to retrieve
- `sessionKey` (string, OPTIONAL): Session key to retrieve
- `maxTurns` (number, OPTIONAL): Max turns to include, default 50

MUST provide either `sessionId` or `sessionKey`.

**Parameters (mode: 'list'):**

List recent conversation sessions.

- `limit` (number, OPTIONAL): 1-50, default 20
- `offset` (number, OPTIONAL): Pagination offset, default 0

### delete_conversation

Delete a conversation session.

**Parameters:**

- `sessionId` (string, OPTIONAL): Session ID to delete
- `sessionKey` (string, OPTIONAL): Session key to delete
- `confirm` (boolean, REQUIRED): Must be true to confirm deletion

### get_stats

Unified statistics tool. Consolidates `knowledge_stats`, `memory_stats`, `conversation_stats`, and `insight_stats` into a single tool.

**Parameters:**

- `scope` (enum, REQUIRED): `'all' | 'knowledge' | 'memory' | 'conversations' | 'insights'`

**Response (scope: 'all'):**

```json
{
  "knowledge": { "totalDocuments": 100, "totalChunks": 500, "storageBytes": 1048576 },
  "memory": { "totalEntities": 25, "totalObservations": 150, "totalRelations": 30 },
  "conversations": { "totalSessions": 10, "totalTurns": 200 },
  "insights": { "totalInsights": 15, "newInsights": 5 }
}
```

When `scope` is set to a specific subsystem, only that section is returned.

### get_insights

Get proactive insights discovered from your knowledge base.

**Parameters:**

- `status` (enum, OPTIONAL): `'new' | 'seen' | 'dismissed'`, default 'new'
- `insightType` (enum, OPTIONAL): `'cross_source' | 'theme_cluster' | 'entity_bridge' | 'temporal_pattern' | 'outlier'`
- `query` (string, OPTIONAL): Semantic search query for relevant insights
- `limit` (number, OPTIONAL): Max insights 1-50, default 5

### discover_connections

Trigger an insight scan to discover patterns in the knowledge base.

**Parameters:**

- `fullScan` (boolean, OPTIONAL): Scan all content (not just recent), default false
- `maxChunks` (number, OPTIONAL): Max chunks to analyze 10-1000, default 200

### dismiss_insight

Dismiss an insight from the queue.

**Parameters:**

- `insightId` (string, REQUIRED): The insight ID to dismiss

## Tool Interaction Guide

### Memory Data Model

Textrawl's memory system has three concepts:

- **Entities** — Named items (people, projects, concepts, etc.). Uniqueness is per `(name, entity_type)` — case-insensitive lookup.
- **Observations** — Atomic facts attached to an entity. Each has a semantic embedding for search.
- **Relations** — Directed links between two entities (e.g., "Jeff `works_at` Acme Corp").

### When to Use Each Memory Tool

| Goal | Tool | Notes |
|------|------|-------|
| Store a fact about something | `remember_fact` | Creates entity if needed. One fact per call. |
| Connect two things | `relate_entities` | Creates both entities if needed. Entity types are optional and auto-detected. |
| Find stored facts | `query_memory` | `mode: 'search'` — semantic search across all observations. |
| See everything about one entity | `query_memory` | `mode: 'entity'` — returns observations + all relations. |
| List all known entities | `query_memory` | `mode: 'list'` — paginated entity listing. |
| Bulk-extract from text | `extract_memories` | Requires `ENABLE_MEMORY_EXTRACTION=true`. |

### Critical Behavior Notes

1. **Entity auto-creation**: Both `remember_fact` and `relate_entities` auto-create entities. You do NOT need to call `remember_fact` before `relate_entities`.
2. **Entity type params are optional in `relate_entities`**: If the entity already exists, its type is looked up automatically. Only provide `fromEntityType`/`toEntityType` when creating brand-new entities. **If unsure, just omit them.**
3. **Relation types are free-form**: Use snake_case strings. Common types: `works_at`, `knows`, `prefers`, `created`, `part_of`, `interested_in`. Custom types are accepted.
4. **Idempotent operations**: `remember_fact` detects duplicate observations. `relate_entities` upserts — creating the same relation twice is a no-op.
5. **Error responses include `isError: true`**: When a tool returns an error, the response includes `isError: true` per the MCP spec. Do NOT retry the same call blindly — read the error message for guidance.
6. **Configuration errors are permanent**: Errors like "Database not configured" or "Embedding not configured" are server-side issues. Retrying will not help.

### Avoiding Common Pitfalls

- **MUST NOT pass `null` for optional parameters** — simply omit them entirely.
- **SHOULD NOT retry the same failing call** — read the error message and adjust parameters or try a different tool.
- If `relate_entities` fails, the most common cause is passing an invalid entity type. You SHOULD omit `fromEntityType` and `toEntityType`.

## Common Agent Patterns

### Pattern 1: Search and Retrieve

```text
1. search(query: "user question") → get top results
2. get_document(documentId: results[0].documentId) → full content
3. Synthesize answer from full document
```

### Pattern 2: Knowledge Capture

```text
1. User provides information
2. add_note(title: "...", content: "...", tags: ["topic"])
3. Confirm storage with documentId
```

### Pattern 3: Iterative Refinement

```text
1. search(query: "broad topic", limit: 5)
2. If results insufficient, adjust weights or add filters
3. search(query: "refined", tags: ["specific"], minScore: 0.7)
```

### Pattern 4: Browse and Organize

```text
1. list_documents(sourceType: "note", limit: 50)
2. Identify documents needing organization
3. update_document(documentId: "...", tags: ["category"])
```

### Pattern 5: Memory Capture (Persistent Memory)

```text
1. User mentions facts about themselves, preferences, or context
2. remember_fact(entityName: "User", entityType: "person", observation: "prefers TypeScript")
3. For relationships: relate_entities(fromEntity: "User", relation: "works_at", toEntity: "Acme")
```

### Pattern 6: Context Retrieval (Persistent Memory)

```text
1. Before responding, check for relevant memories
2. query_memory(mode: "search", query: "user preferences", entityTypes: ["person", "preference"])
3. query_memory(mode: "entity", entityName: "User") for full context
4. Incorporate memories into response
```

### Pattern 7: Memory-Enhanced Search

```text
1. search(query: "...", includeMemories: true) for combined results
2. Or separately: query_memory(mode: "search", query: "...") + search(query: "...")
3. Combine entity knowledge with document content
```

## Error Handling

Errors are returned in the result object (NOT as protocol-level errors):

```json
{
  "error": "Error type",
  "message": "Human-readable explanation with fix suggestions"
}
```

**Common errors and fixes:**

| Error | Cause | Fix |
|-------|-------|-----|
| `Database not configured` | Missing Supabase credentials | Set `SUPABASE_URL` and `SUPABASE_SERVICE_KEY` |
| `OpenAI not configured` | Missing embedding API key | Set `OPENAI_API_KEY` or configure Ollama |
| `No updates provided` | update_document called without changes | Provide `title` or `tags` |
| `Document not found` | Invalid documentId | Verify UUID from search or list results |
| `Embedding service not configured` | Memory tools need embeddings | Set `OPENAI_API_KEY` or configure Ollama |
| `Entity not found` | forget_entity with unknown name | Check entity name with `query_memory(mode: "list")` |
| `Confirmation required` | forget_entity without confirm | Set `confirm: true` to delete |

## Testing Tools

```bash
pnpm inspector    # MCP Inspector at http://localhost:5173
```

**Document tools test sequence:**

1. `add_note` - Create test document
2. `search` - Find it
3. `get_document` - Retrieve full content
4. `update_document` - Modify tags
5. `list_documents` - Verify in list

**Memory tools test sequence:**

1. `remember_fact` - Store a fact about "TestUser"
2. `query_memory(mode: "search")` - Search for the fact
3. `relate_entities` - Create a relation
4. `query_memory(mode: "entity")` - Get full entity info
5. `query_memory(mode: "list")` - Verify entity exists
6. `get_stats(scope: "memory")` - Check counts
7. `forget_entity` - Clean up test data

**Conversation tools test sequence:**

1. `save_conversation_context` - Save a test conversation
2. `query_conversations(mode: "search")` - Search for it
3. `query_conversations(mode: "get")` - Retrieve full transcript
4. `query_conversations(mode: "list")` - Verify in list
5. `get_stats(scope: "conversations")` - Check counts
6. `delete_conversation` - Clean up test data

**Insight tools test sequence:**

1. `discover_connections` - Run a scan
2. `get_insights` - View discovered insights
3. `get_stats(scope: "insights")` - Check queue stats
4. `dismiss_insight` - Dismiss a test insight

## When Modifying This Codebase

See [CLAUDE.md](CLAUDE.md) for development conventions:

- All logs MUST use `console.error()` (stdout reserved for MCP JSON-RPC)
- ESM imports require `.js` extensions
- Tools use Zod schemas in `src/tools/`
- Run `pnpm typecheck` before committing

## Integration Examples

### Claude Desktop (claude_desktop_config.json)

```json
{
  "mcpServers": {
    "textrawl": {
      "url": "https://your-instance.run.app/mcp",
      "headers": {
        "Authorization": "Bearer YOUR_TOKEN"
      }
    }
  }
}
```

### Cursor IDE (.cursor/mcp.json)

```json
{
  "mcpServers": {
    "textrawl": {
      "url": "http://localhost:3000/mcp"
    }
  }
}
```

## Related Documentation

- [CLAUDE.md](CLAUDE.md) - Development conventions
- [docs/cli/](docs/cli/) - CLI tools for file conversion
- [docs/guides/security-hardening.mdx](docs/guides/security-hardening.mdx) - Row Level Security setup
- [.well-known/mcp.json](.well-known/mcp.json) - MCP capability advertisement
