# Environment Variables (ENV)

This file centralizes runtime configuration for Textrawl server, MCP tools, CLI, and optional features.

## Source of truth

- Repository defaults and comments: `.env.example`
- Runtime validation: `src/utils/config.ts`
- High-level user setup: `README.md`

## Core variables

| Variable | Required | Purpose |
|---|---|---|
| `DATABASE_URL` | Yes (DB features) | Neon (or any PostgreSQL) pooled connection string |
| `EMBEDDING_PROVIDER` | No | `openai` (default), `ollama`, or `google` |
| `OPENAI_API_KEY` | Required for OpenAI | Embedding API key (`text-embedding-3-small`, 1536d) |
| `GOOGLE_AI_API_KEY` | Required for Google | Google AI API key (`gemini-embedding-2-preview`, 3072d) |
| `GOOGLE_EMBEDDING_MODEL` | No | Google embedding model (default: `gemini-embedding-2-preview`) |
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
| `EXTRACTION_MODEL` | No | Default: `claude-haiku-4-5-20251001` |
| `INSIGHT_MODEL` | No | Default: `claude-sonnet-4-6-20250514` |

## Optional / advanced

| Variable | Purpose |
|---|---|
| `DATABASE_URL_UNPOOLED` | Direct Postgres connection for pg_analyze tools and migrations |
| `REDIS_URL` | Shared rate limiting across instances |
| `GOOGLE_CLIENT_ID`, `GOOGLE_CLIENT_SECRET`, `OAUTH_JWT_SECRET`, `OAUTH_SERVER_URL` | OAuth support |
| `OAUTH_ALLOWED_EMAILS` | Optional OAuth email allowlist |
| `CHUNKING_MODE`, `SEMANTIC_SIMILARITY_THRESHOLD` | Chunking strategy tuning |
| `PG_REPORT_DIR` | Directory for analysis reports (default: `./reports/pg-analysis`) |
| `INSIGHT_BATCH_THRESHOLD` | Insight scan tuning (default: `50`) |
| `INSIGHT_DEBOUNCE_SECONDS` | Insight scan debounce (default: `300`) |
| `MAX_SINGLE_FILE_SIZE_MB`, `WARN_FILE_SIZE_MB`, `MAX_CHUNKS_PER_FILE` | Upload/chunking guardrails (`WARN_FILE_SIZE_MB` logs large docs; `MAX_CHUNKS_PER_FILE` is an advisory soft threshold) |
| `MAX_CHUNKS_HARD_CAP` | Hard ceiling on chunks per document; the chunker rejects past it to bound memory (default: `50000`) |
| `MAX_UPLOAD_SIZE_MB` | Max size accepted by the resumable `/api/upload/init` path (default: `500`) |
| `UPLOAD_THRESHOLD_MB` | Direct (≤) vs resumable (>) switch point (default: `MAX_SINGLE_FILE_SIZE_MB`) |
| `UPLOAD_SESSION_TTL_MIN` | Resumable session + upload-row expiry in minutes (default: `120`) |
| `GCS_UPLOAD_BUCKET` | GCS bucket for large uploads (required once GCS storage is enabled) |
| `CLOUD_TASKS_QUEUE` | Cloud Tasks queue id for async upload processing; set with `UPLOAD_PROCESS_URL` to use the real queue |
| `CLOUD_TASKS_LOCATION` | Cloud Tasks queue region (default: `us-central1`) |
| `CLOUD_TASKS_SERVICE_ACCOUNT` | OIDC identity minted into each task; verified by the processing endpoint |
| `UPLOAD_PROCESS_URL` | Internal processing endpoint base URL (task target `<url>/<uploadId>` + OIDC audience) |
| `ZIP_MAX_ENTRIES` | Max file entries per archive (default: `2000`) |
| `ZIP_MAX_COMPRESSED_BYTES` | Max compressed archive size in bytes (default: `MAX_UPLOAD_SIZE_MB`) |
| `ZIP_MAX_EXPANDED_BYTES` | Max total uncompressed size in bytes — bomb guard (default: `2000000000`) |
| `ZIP_MAX_ENTRY_BYTES` | Max uncompressed size of a single entry in bytes (default: `50000000`) |
| `ZIP_MAX_COMPRESSION_RATIO` | Max expanded/compressed ratio — bomb guard (default: `100`) |
| `ZIP_MAX_FILENAME_LEN` | Max entry-path length in characters (default: `255`) |

## Security notes

- Never expose `DATABASE_URL` to browser/renderer/client bundles.
- Treat `API_BEARER_TOKEN` as a secret and rotate if leaked.

## Why

- `DATABASE_URL` grants full database access and is for trusted server environments only.
- MCP servers should enforce authentication/authorization at transport boundaries in deployed environments. [mcp]
- OpenAI MCP integration and client connector behavior are documented in OpenAI MCP docs. [openai-mcp]

## References

[mcp]: https://modelcontextprotocol.io
[openai-mcp]: https://platform.openai.com/docs/mcp
