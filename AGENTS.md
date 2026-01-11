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

**Example (`recall_memories` compact response):**
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

### Document Tools

| User Intent | Tool | Key Parameters |
|-------------|------|----------------|
| Find content by meaning | `search_knowledge` | `query`, `semanticWeight: 1.5` |
| Find exact phrases/keywords | `search_knowledge` | `query`, `fullTextWeight: 1.5` |
| Balanced hybrid search | `search_knowledge` | `query` (default weights) |
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
| Search past memories | `recall_memories` | `query`, `searchMode: 'hybrid'` |
| Connect entities together | `relate_entities` | `fromEntity`, `relation`, `toEntity` |
| Get all info about an entity | `get_entity_context` | `entityName` |
| List all known entities | `list_entities` | `entityTypes`, `limit` |
| Delete an entity completely | `forget_entity` | `entityName`, `confirm: true` |
| View memory statistics | `memory_stats` | (no parameters) |

## Tool Schemas (RFC 2119)

### search_knowledge

Hybrid semantic + full-text search using Reciprocal Rank Fusion.

**Parameters:**

- `query` (string, REQUIRED): Natural language search query (1-10000 chars)
- `limit` (number, OPTIONAL): Max results 1-50, default 10
- `fullTextWeight` (number, OPTIONAL): Keyword matching weight 0-2, default 1.0
- `semanticWeight` (number, OPTIONAL): Semantic similarity weight 0-2, default 1.0
- `tags` (string[], OPTIONAL): Filter to docs with ALL specified tags
- `sourceType` (enum, OPTIONAL): `'note' | 'file' | 'url'`
- `minScore` (number, OPTIONAL): Minimum relevance score 0-1

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

### recall_memories

Semantic search across stored memories using hybrid (keyword + semantic) or semantic-only mode.

**Parameters:**

- `query` (string, REQUIRED): What to search for (1-1000 chars)
- `entityTypes` (enum[], OPTIONAL): Filter by entity types
- `limit` (number, OPTIONAL): Max results 1-50, default 10
- `searchMode` (enum, OPTIONAL): `'hybrid' | 'semantic'`, default 'hybrid'

**Response:**

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

### get_entity_context

Retrieve all information about an entity including observations and relations.

**Parameters:**

- `entityName` (string, REQUIRED): Name of entity to look up
- `includeRelated` (boolean, OPTIONAL): Include relations, default true

**Response:**

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

### list_entities

List all known entities with pagination.

**Parameters:**

- `entityTypes` (enum[], OPTIONAL): Filter by entity types
- `limit` (number, OPTIONAL): 1-100, default 50
- `offset` (number, OPTIONAL): Pagination offset, default 0

**Response:**

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

### memory_stats

Get statistics about stored memories.

**Parameters:** None

**Response:**

```json
{
  "totalEntities": 25,
  "totalObservations": 150,
  "totalRelations": 30,
  "entitiesByType": { "person": 10, "project": 8, "concept": 7 }
}
```

## Common Agent Patterns

### Pattern 1: Search and Retrieve

```text
1. search_knowledge(query: "user question") → get top results
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
1. search_knowledge(query: "broad topic", limit: 5)
2. If results insufficient, adjust weights or add filters
3. search_knowledge(query: "refined", tags: ["specific"], minScore: 0.7)
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
2. recall_memories(query: "user preferences", entityTypes: ["person", "preference"])
3. get_entity_context(entityName: "User") for full context
4. Incorporate memories into response
```

### Pattern 7: Memory-Enhanced Search

```text
1. recall_memories(query: "...", limit: 5) for entity context
2. search_knowledge(query: "...", tags: relevant_tags) for documents
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
| `Entity not found` | forget_entity with unknown name | Check entity name with `list_entities` |
| `Confirmation required` | forget_entity without confirm | Set `confirm: true` to delete |

## Testing Tools

```bash
npm run inspector    # MCP Inspector at http://localhost:5173
```

**Document tools test sequence:**

1. `add_note` - Create test document
2. `search_knowledge` - Find it
3. `get_document` - Retrieve full content
4. `update_document` - Modify tags
5. `list_documents` - Verify in list

**Memory tools test sequence:**

1. `remember_fact` - Store a fact about "TestUser"
2. `recall_memories` - Search for the fact
3. `relate_entities` - Create a relation
4. `get_entity_context` - Get full entity info
5. `list_entities` - Verify entity exists
6. `memory_stats` - Check counts
7. `forget_entity` - Clean up test data

## When Modifying This Codebase

See [CLAUDE.md](CLAUDE.md) for development conventions:

- All logs MUST use `console.error()` (stdout reserved for MCP JSON-RPC)
- ESM imports require `.js` extensions
- Tools use Zod schemas in `src/tools/`
- Run `npm run typecheck` before committing

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
