# Troubleshooting

## Tools not showing in Claude

- Confirm server is running and reachable: `curl http://localhost:3000/health`.
- Validate MCP endpoint config points to `/mcp` and includes proper headers.
- If auth is enabled, include `Authorization: Bearer <API_BEARER_TOKEN>`.
- Run `pnpm inspector` and verify tools enumerate.

## No search results / embeddings mismatch

Symptoms:
- upload/search errors referencing vector dimensions or RPC failures.

Fix:
- Ensure schema script matches embedding provider/model dimensions:
  - OpenAI: 1536 (`setup-db.sql`)
  - Ollama v1: 1024 (`setup-db-ollama.sql`)
  - Ollama v2: 768 (`setup-db-ollama-v2.sql`)
- Re-embed/reload data when changing dimensions.

## Invalid Supabase URL

- `SUPABASE_URL` must be a full `https://<project>.supabase.co` URL.
- Confirm `.env` value and restart server.

## RLS blocking reads

- If using service-role key, reads should bypass restrictive RLS policies.
- If using anon/authenticated clients directly, verify RLS policies and grants.
- Re-run hardening scripts intentionally and review policy expectations.

## Rate limit exceeded

- API limits: 100/min; upload limits: 10/min.
- For distributed deployments, set `REDIS_URL` so counters are shared.
- Back off and retry with jitter in CLI/batch workflows.

## Why

- Supabase troubleshooting and auth key model. https://supabase.com/docs
- MCP integration/debug behavior in clients. https://modelcontextprotocol.io
- OpenAI MCP connector setup details. https://platform.openai.com/docs/mcp
- PostgreSQL + pgvector schema compatibility for vector operations. https://www.postgresql.org/docs/ and https://github.com/pgvector/pgvector
