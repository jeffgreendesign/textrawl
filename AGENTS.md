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

## Tool Selection Guide

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

## Testing Tools

```bash
npm run inspector    # MCP Inspector at http://localhost:5173
```

Test sequence:

1. `add_note` - Create test document
2. `search_knowledge` - Find it
3. `get_document` - Retrieve full content
4. `update_document` - Modify tags
5. `list_documents` - Verify in list

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
- [docs/CLI.md](docs/CLI.md) - CLI tools for file conversion
- [docs/SECURITY.md](docs/SECURITY.md) - Row Level Security setup
- [.well-known/mcp.json](.well-known/mcp.json) - MCP capability advertisement
