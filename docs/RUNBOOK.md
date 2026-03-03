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
2. Pick **one profile** and run the exact SQL scripts:

### OpenAI profile (1536d)

- Core: `scripts/setup-db.sql`
- Memory (optional): `scripts/setup-db-memory.sql`
- Conversations (optional): `scripts/setup-db-conversation.sql`
- Insights (optional): `scripts/setup-db-insights.sql`

### Ollama v1 profile (1024d)

- Core: `scripts/setup-db-ollama.sql`
- Memory (optional): `scripts/setup-db-memory-ollama.sql`
- Conversations (optional): `scripts/setup-db-conversation-ollama.sql`
- Insights (optional): `scripts/setup-db-insights-ollama.sql`

### Ollama v2 profile (768d)

- Core: `scripts/setup-db-ollama-v2.sql`
- Memory (optional): not currently provided as a dedicated v2 memory schema script
- Conversations (optional): `scripts/setup-db-conversation-ollama-v2.sql`
- Insights (optional): `scripts/setup-db-insights-ollama-v2.sql`

3. Security hardening scripts:

- Base: `scripts/security-rls.sql`
- Memory hardening (when memory tables are enabled): `scripts/security-rls-memory.sql`

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

- Supabase setup and operational guidance. [supabase]
- pgvector extension and vector index behavior. [pgvector]
- PostgreSQL operational references. [postgresql]
- MCP transport and client interoperability expectations. [mcp]
- OpenAI client-side MCP connector guidance. [openai]

## References

[supabase]: https://supabase.com/docs
[pgvector]: https://github.com/pgvector/pgvector
[postgresql]: https://www.postgresql.org/docs/
[mcp]: https://modelcontextprotocol.io
[openai]: https://platform.openai.com/docs/mcp
