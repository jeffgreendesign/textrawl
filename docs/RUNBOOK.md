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

## 2) Database setup

1. Create a Postgres database with the `pgvector` extension (Neon recommended; Supabase, AWS RDS, GCP Cloud SQL, or self-hosted also work). Copy the **pooled** connection string into `DATABASE_URL`.
2. Pick **one profile** and run the exact SQL scripts via `psql "$DATABASE_URL" -f <script>`:

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

1. Security hardening scripts:

- Base: `scripts/security-rls.sql`
- Memory hardening (when memory tables are enabled): `scripts/security-rls-memory.sql`

## 3) Local Postgres alternative

Use `docker-compose.local.yml` (pgvector image):

```bash
docker compose -f docker-compose.local.yml up -d
export DATABASE_URL=postgresql://textrawl:textrawl@localhost:5432/textrawl
```

Then initialize schema (example OpenAI):

```bash
psql "$DATABASE_URL" -f scripts/setup-db.sql
```

> Note: the application connects via `pg` against `DATABASE_URL`, so this works identically against Neon, the Supabase pooler, RDS, or local Postgres.

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

Use Settings → Connectors (Developer mode), point to `http://localhost:3000/mcp`, then add the `Authorization: Bearer <your-token>` header if enabled.

## 6) MCP Inspector

```bash
pnpm inspector
```

Then open the Inspector UI and verify tools load.

## Why

- Neon: recommended Postgres provider with native pgvector. [neon]
- Supabase, AWS RDS, GCP Cloud SQL, and self-hosted Postgres are also supported via the same `DATABASE_URL`. [supabase]
- pgvector extension and vector index behavior. [pgvector]
- PostgreSQL operational references. [postgresql]
- MCP transport and client interoperability expectations. [mcp]
- OpenAI client-side MCP connector guidance. [openai]

## References

[neon]: https://neon.com/docs
[supabase]: https://supabase.com/docs
[pgvector]: https://github.com/pgvector/pgvector
[postgresql]: https://www.postgresql.org/docs/
[mcp]: https://modelcontextprotocol.io
[openai]: https://platform.openai.com/docs/mcp
