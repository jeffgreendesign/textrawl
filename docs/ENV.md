# Environment Variables (ENV)

This file centralizes runtime configuration for Textrawl server, MCP tools, CLI, and optional features.

## Source of truth

- Repository defaults and comments: `.env.example`
- Runtime validation: `src/utils/config.ts`
- High-level user setup: `README.md`

## Core variables

| Variable | Required | Purpose |
|---|---|---|
| `SUPABASE_URL` | Yes (DB features) | Supabase project URL |
| `SUPABASE_SERVICE_KEY` | Yes (DB features) | Service-role key used by server/CLI |
| `EMBEDDING_PROVIDER` | No | `openai` (default), `ollama`, or `google` |
| `OPENAI_API_KEY` | Required for OpenAI | Embedding API key (`text-embedding-3-small`, 1536d) |
| `GOOGLE_AI_API_KEY` | Required for Google | Google AI API key (`text-embedding-004`, 768d) |
| `GOOGLE_EMBEDDING_MODEL` | No | Google embedding model (default: `text-embedding-004`) |
| `OLLAMA_BASE_URL` | Required for Ollama | Local/remote Ollama base URL |
| `OLLAMA_MODEL` | Required for Ollama | Embedding model (e.g. `nomic-embed-text`) |
| `API_BEARER_TOKEN` | Strongly recommended; required in prod unless OAuth | Bearer auth for `/mcp` and `/api/upload` |
| `ALLOWED_ORIGINS` | No | Comma-separated CORS allowlist |
| `PORT` | No | HTTP port (default 3000) |
| `NODE_ENV` | No | `development` / `production` / `test` |
| `LOG_LEVEL` | No | `debug` / `info` / `warn` / `error` |

## Feature flags

| Variable | Default | Notes |
|---|---|---|
| `ENABLE_MEMORY` | `true` | Requires memory schema SQL |
| `ENABLE_CONVERSATIONS` | `true` | Requires conversation schema SQL |
| `ENABLE_INSIGHTS` | `true` | Requires insights schema SQL |
| `ENABLE_MEMORY_EXTRACTION` | `false` | Requires Anthropic key |
| `COMPACT_RESPONSES` | `true` | Compact text output for memory tools |

## Extraction (Anthropic)

| Variable | Required | Notes |
|---|---|---|
| `ANTHROPIC_API_KEY` | If extraction enabled | Key for `extract_memories` |
| `EXTRACTION_MODEL` | No | Default: `claude-haiku-4-5-20250501` |
| `INSIGHT_MODEL` | No | Default: `claude-sonnet-4-6-20250514` |

## Optional / advanced

| Variable | Purpose |
|---|---|
| `REDIS_URL` | Shared rate limiting across instances |
| `GOOGLE_CLIENT_ID`, `GOOGLE_CLIENT_SECRET`, `OAUTH_JWT_SECRET`, `OAUTH_SERVER_URL` | OAuth support |
| `OAUTH_ALLOWED_EMAILS` | Optional OAuth email allowlist |
| `CHUNKING_MODE`, `SEMANTIC_SIMILARITY_THRESHOLD` | Chunking strategy tuning |
| `DATABASE_URL` | Direct Postgres connection for pg_analyze tools |
| `PG_REPORT_DIR` | Directory for analysis reports (default: `./reports/pg-analysis`) |
| `INSIGHT_BATCH_THRESHOLD` | Insight scan tuning (default: `50`) |
| `INSIGHT_DEBOUNCE_SECONDS` | Insight scan debounce (default: `300`) |
| `MAX_SINGLE_FILE_SIZE`, `WARN_FILE_SIZE_MB`, `MAX_CHUNKS_PER_FILE` | Upload/chunking guardrails |

## Security notes

- Never expose `SUPABASE_SERVICE_KEY` to browser/renderer/client bundles.
- Treat `API_BEARER_TOKEN` as a secret and rotate if leaked.

## Why

- Supabase service-role keys are privileged and intended for trusted server environments only. [supabase]
- MCP servers should enforce authentication/authorization at transport boundaries in deployed environments. [mcp]
- OpenAI MCP integration and client connector behavior are documented in OpenAI MCP docs. [openai-mcp]

## References

[supabase]: https://supabase.com/docs/guides/api/api-keys
[mcp]: https://modelcontextprotocol.io
[openai-mcp]: https://platform.openai.com/docs/mcp
