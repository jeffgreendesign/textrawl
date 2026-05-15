# Troubleshooting

## Tools not showing in Claude

- Confirm server is running and reachable: `curl http://localhost:3000/health`.
- Validate MCP endpoint config points to `/mcp` and includes proper headers.
- If auth is enabled, include `Authorization: Bearer <API_BEARER_TOKEN>`.
- Run `pnpm inspector` and verify tools are listed.

## No search results / embeddings mismatch

Symptoms:

- upload/search errors referencing vector dimensions or RPC failures.

Fix:

- Ensure schema script matches embedding provider/model dimensions:
  - OpenAI: 1536 (`setup-db.sql`)
  - Ollama v1: 1024 (`setup-db-ollama.sql`)
  - Ollama v2: 768 (`setup-db-ollama-v2.sql`)
- Re-embed/reload data when changing dimensions.

## Invalid DATABASE_URL

- `DATABASE_URL` must be a full Postgres connection string (e.g. `postgresql://user:pass@host:5432/db?sslmode=require`).
- On Neon and Supabase, prefer the **pooled** connection string for production use.
- Confirm `.env` value and restart server.

## RLS blocking reads

- The application connects via `pg` against `DATABASE_URL` as a single role; RLS is bypassed when that role is the table owner or has `BYPASSRLS`.
- If you've split connection roles, verify RLS policies and grants against the role in your `DATABASE_URL`.
- Re-run hardening scripts (`scripts/security-rls.sql`, `scripts/security-rls-memory.sql`) intentionally and review policy expectations.

## Rate limit exceeded

- API limits: 100/min; upload limits: 10/min.
- For distributed deployments, set `REDIS_URL` so counters are shared.
- Back off and retry with jitter in CLI/batch workflows.

## Why

- Supabase troubleshooting and auth key model. [supabase]
- MCP integration/debug behavior in clients. [mcp]
- OpenAI MCP connector setup details. [openai-mcp]
- PostgreSQL + pgvector schema compatibility for vector operations. [pgvector]

[supabase]: https://supabase.com/docs
[mcp]: https://modelcontextprotocol.io
[openai-mcp]: https://platform.openai.com/docs/mcp
[pgvector]: https://github.com/pgvector/pgvector
