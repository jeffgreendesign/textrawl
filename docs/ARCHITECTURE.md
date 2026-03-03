# Architecture

## Runtime boundaries

- **Server (`src/`)**: Express HTTP server + MCP endpoint + REST endpoints.
- **Desktop (`desktop/`)**: Electron UI for conversion/upload workflow.
- **CLI (`scripts/cli/`)**: Batch conversion/upload and scanning.
- **Docs site (`website/` + `docs/`)**: Next.js docs and MDX content.

## Entry points and request flow

- Main entry: `src/index.ts`
- MCP server assembly: `src/server.ts`
- MCP endpoint: `POST /mcp` (stateless `StreamableHTTPServerTransport`)
- REST upload endpoint: `POST /api/upload`
- Health endpoints: `GET /health`, `GET /health/ready`, `GET /health/live`

## Auth and rate limiting

- `bearerAuth` on `/mcp` and `/api/upload`.
- In production, auth is required (`API_BEARER_TOKEN` or OAuth).
- Rate limits:
  - API: 100 req/min
  - Upload: 10 req/min
  - Health: 300 req/min
- Optional shared limits via Redis (`REDIS_URL`).

## Search architecture

- Tool layer: `src/tools/search.ts`
- DB call layer: `src/db/search.ts`
- SQL fusion functions: `hybrid_search` + semantic fallback in schema scripts.
- Weighted parameters: `fullTextWeight`, `semanticWeight`, `minScore`; limit is validated to 1–50.

## Embeddings and dimensionality

- OpenAI profile: 1536 dimensions.
- Ollama profiles:
  - 1024 dimensions (`nomic-embed-text`, `mxbai-embed-large`)
  - 768 dimensions (`nomic-embed-text-v2-moe`)
- Schema scripts must match embedding dimensions.

## Database scripts by feature

- Core docs/chunks search: `setup-db*.sql`
- Memory graph: `setup-db-memory*.sql`
- Conversations: `setup-db-conversation*.sql`
- Insights: `setup-db-insights*.sql`
- RLS hardening: `security-rls.sql` (+ memory variant)

## Why

- MCP protocol architecture and stateless HTTP transport principles. https://modelcontextprotocol.io
- Supabase security model and key separation. https://supabase.com/docs/guides/api/api-keys
- PostgreSQL and pgvector index/function behavior references. https://www.postgresql.org/docs/ and https://github.com/pgvector/pgvector
