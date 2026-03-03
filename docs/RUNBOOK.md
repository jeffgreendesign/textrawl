# Runbook

## 1) Local dev (default OpenAI profile)

```bash
pnpm install
pnpm setup
pnpm dev
```

Checks:

```bash
curl -s http://localhost:3000/health
curl -s http://localhost:3000/health/ready
curl -s http://localhost:3000/health/live
```

## 2) Supabase setup

1. Create a Supabase project.
2. Run one **core schema** script:
   - OpenAI: `scripts/setup-db.sql`
   - Ollama 1024d: `scripts/setup-db-ollama.sql`
   - Ollama 768d: `scripts/setup-db-ollama-v2.sql`
3. Optional features:
   - Memory: `scripts/setup-db-memory.sql` or `scripts/setup-db-memory-ollama.sql`
   - Conversations: `scripts/setup-db-conversation*.sql`
   - Insights: `scripts/setup-db-insights*.sql`
4. Security hardening: `scripts/security-rls.sql` (+ `scripts/security-rls-memory.sql` when applicable).

## 3) Local Postgres alternative (without Supabase)

Use `docker-compose.local.yml` (pgvector image):

```bash
docker compose -f docker-compose.local.yml up -d
```

Then initialize schema (example OpenAI):

```bash
docker exec -i textrawl-postgres psql -U postgres -d textrawl < scripts/setup-db.sql
```

> Note: application code is built around Supabase client usage; local Postgres setup is useful for SQL/dev experiments and self-hosted alternatives.

## 4) Ollama profile

```bash
# optional helper stack
docker compose -f docker-compose.local.yml --profile ollama up -d

# configure
export EMBEDDING_PROVIDER=ollama
export OLLAMA_BASE_URL=http://localhost:11434
export OLLAMA_MODEL=nomic-embed-text
```

Use matching schema dimensions (1024d or 768d).

## 5) MCP client config

### Claude Desktop

```json
{
  "mcpServers": {
    "textrawl": {
      "command": "npx",
      "args": [
        "mcp-remote",
        "http://localhost:3000/mcp",
        "--header",
        "Accept: application/json, text/event-stream"
      ]
    }
  }
}
```

Add auth header when `API_BEARER_TOKEN` is set.

### ChatGPT Desktop

Use Settings → Connectors (Developer mode), point to `http://localhost:3000/mcp`, then add `Authorization: Bearer <token>` header if enabled.

## 6) MCP Inspector

```bash
pnpm inspector
```

Then open the Inspector UI and verify tools load.

## Why

- Supabase setup and operational guidance. https://supabase.com/docs
- pgvector extension and vector index behavior. https://github.com/pgvector/pgvector
- PostgreSQL operational references. https://www.postgresql.org/docs/
- MCP transport and client interoperability expectations. https://modelcontextprotocol.io
- OpenAI client-side MCP connector guidance. https://platform.openai.com/docs/mcp
