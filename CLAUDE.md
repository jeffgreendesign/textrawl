# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

Textrawl is a personal knowledge MCP server: hybrid (vector + FTS) search over imported documents, a memory graph, conversation recall, and proactive insights. Postgres + pgvector (Neon). Supports OpenAI, Google AI, or Ollama embeddings — **not interchangeable** (different dimensions; you cannot switch without re-embedding).

## Toolchain

- Node.js **>= 22** required. `preinstall` runs `only-allow pnpm` — npm/yarn will be rejected.
- ESM project (`"type": "module"`). All imports MUST use explicit `.js` extension even for `.ts` files.
- Package manager: pnpm 9.15+. Workspace includes `website/`, `desktop/`, and `dashboard/`.

## Commands (from `package.json`)

| Task | Command |
|---|---|
| Install deps | `pnpm install` |
| Interactive env setup | `pnpm setup` (generates `.env` with secure token) |
| Dev server (watch) | `pnpm dev` |
| Build server | `pnpm build` (`tsc` + esbuild bundle to `dist/`) |
| Start built server | `pnpm start` |
| Typecheck | `pnpm typecheck` |
| Lint (Biome) | `pnpm lint` / `pnpm lint:fix` |
| Lint (Markdown) | `pnpm lint:md` |
| Unit tests | `pnpm test` (vitest, run once) |
| Single test file | `pnpm test path/to/file.test.ts` |
| Test watch mode | `pnpm test:watch` |
| Quick quality | `pnpm quality` (lint + lint:md + typecheck) |
| Fast local gate | `pnpm verify:fast` (quality + test + security/docs/tool-sync checks) |
| Canonical CI gate | `pnpm verify` (verify:fast + build + docs build) |
| MCP inspector | `pnpm inspector` (against running `localhost:3000/mcp`) |
| Desktop app dev | `pnpm desktop:dev` |
| Docs site dev | `pnpm docs:dev` |
| CLI convert | `pnpm convert -- <subcommand> ...` |
| CLI upload | `pnpm upload -- <path>` |
| Postgres analysis | `pnpm pg:analyze` |

The `verify` gates invoke three shell scripts directly: `scripts/security-check.sh` (secret/RLS scan; also exposed as `pnpm security-check`), `scripts/docs-check.sh` (doc freshness; no pnpm alias), and `scripts/tool-sync-check.sh` (also exposed as `pnpm tool-sync`; asserts the MCP tool list stays in sync between `src/tools/`, `README.md`, and `AGENTS.md`).

## Architecture boundaries

- **Server (`src/`)** — Express + MCP. Entry: `src/index.ts` boots Express; `src/server.ts` builds the MCP `McpServer` and registers tools via `src/tools/index.ts`. Routes mount under `/mcp` (MCP transport), `/api/upload`, `/api/*`, and `/health/*`. This is the **only** layer permitted to hold privileged DB credentials.
- **Desktop (`desktop/`)** — Electron app (main/preload/renderer). Talks to the server over HTTP/MCP; renderer must never see service-role credentials.
- **CLI (`scripts/cli/`)** — `convert.ts`, `upload.ts`, `scan.ts`, `split.ts`, `pg-analyze.ts`. Converters live in `scripts/cli/converters/` (mbox, eml, takeout, html, instagram, facebook, reddit, spotify). Shared helpers in `scripts/cli/lib/`.
- **Dashboard (`dashboard/`)** — Next.js web UI (separate workspace package). Consumes server REST + WebSocket.
- **Docs site (`website/`, `docs/`)** — Next.js docs and MDX reference content.

## Request/data flow

- **MCP tool call** → `src/server.ts` (McpServer) → handler in `src/tools/<area>.ts` → `src/db/*` or `src/services/*`. Tool handlers return through `toolResponse()` / `toolError()` (see AX rules below).
- **Upload** → `src/api/upload.ts` → `src/services/processor.ts` (text extraction) → `src/services/chunker.ts` (paragraph-aware, 512 tok / 50 tok overlap; or semantic if `CHUNKING_MODE=semantic`) → `src/services/embeddings.ts` (provider-dispatched) → `src/db/documents.ts` + `src/db/chunks.ts`.
- **Search** → `src/tools/search.ts` → `src/db/search.ts` → Postgres `hybrid_search()` RPC (RRF fusion of pgvector HNSW + tsvector FTS). RPC body lives in `scripts/setup-db*.sql`.
- **Memory / conversations / insights** are parallel feature trees with their own schemas, db modules, services, and tools, gated by `ENABLE_MEMORY` / `ENABLE_CONVERSATIONS` / `ENABLE_INSIGHTS`.

## Feature schemas and SQL scripts

- **Knowledge search/documents**: one of
  - OpenAI 1536d: `scripts/setup-db.sql`
  - Google AI 3072d: `scripts/setup-db-google.sql`
  - Ollama 1024d: `scripts/setup-db-ollama.sql`
  - Ollama 768d: `scripts/setup-db-ollama-v2.sql`
- **Memory graph**:
  - OpenAI: `scripts/setup-db-memory.sql`
  - Ollama 1024d: `scripts/setup-db-memory-ollama.sql`
- **Conversations**:
  - OpenAI: `scripts/setup-db-conversation.sql`
  - Ollama 1024d: `scripts/setup-db-conversation-ollama.sql`
  - Ollama 768d: `scripts/setup-db-conversation-ollama-v2.sql`
- **Insights**:
  - OpenAI: `scripts/setup-db-insights.sql`
  - Google AI 3072d: `scripts/setup-db-insights-google.sql`
  - Ollama 1024d: `scripts/setup-db-insights-ollama.sql`
  - Ollama 768d: `scripts/setup-db-insights-ollama-v2.sql`
- **Large uploads** (metadata/state only; provider-agnostic, no embeddings): `scripts/setup-db-uploads.sql`
- **Security hardening**: `scripts/security-rls.sql` (+ `scripts/security-rls-memory.sql`)

## MCP tools reference

Implementations: `src/tools/*.ts`. Full descriptions and schemas in `README.md`. Groupings:

- **Document/search**: `search`, `get_document`, `list_documents`, `update_document`, `add_note`
- **Memory**: `remember_fact`, `build_knowledge`, `query_memory`, `relate_entities`, `forget_entity`, `extract_memories`
- **Conversation**: `save_conversation_context`, `query_conversations`, `delete_conversation`
- **Insights**: `get_insights`, `discover_connections`, `dismiss_insight`
- **Stats**: `get_stats`, `health_check`
- **Unified**: `ask`, `daily_briefing`, `save_url`, `timeline`
- **Postgres**: `pg_analyze`, `pg_recommendations`, `pg_report_history`

`scripts/tool-sync-check.sh` enforces that this list stays in sync with `src/tools/` and `README.md`. When adding/removing a tool, update all three.

## Postgres analysis tools

- Gated on `DATABASE_URL` env var (direct `pg` connection, independent of the main database client)
- MCP tools: `src/tools/pg-analyze.ts`
- Analysis engine: `src/services/pg-analyze/`
- CLI: `pnpm pg:analyze` (`scripts/cli/pg-analyze.ts`)
- Reports saved to `PG_REPORT_DIR` (default `./reports/pg-analysis`)

## Conventions

- ESM imports require explicit `.js` extension (even for `.ts` source).
- **Never `console.log`** in server code — stdout is reserved for MCP JSON-RPC. Use `logger` from `src/utils/logger.js` (routes everything to stderr).
- Embedding dimensions and schema must match: OpenAI 1536d, Google 3072d, Ollama 1024d (`nomic-embed-text`) or 768d (`nomic-embed-text-v2-moe`). Switching providers requires re-embedding all documents.
- Biome enforces single quotes, tabs, 100-char width, no unused template literals.
- Prefer small, PR-shaped changes and keep tool schemas backward compatible.
- MCP tool handlers MUST return plain JSON-serializable values. Handlers MUST NOT return raw Date, BigInt, Buffer, or class instances. All date fields MUST be ISO 8601 strings or null. All aggregate queries (COUNT, MIN, MAX) MUST handle the empty-table case with sensible defaults (0, null, []). Every scope in get_stats MUST be wrapped in its own try/catch so partial failures MUST NOT cause a crash for scope=all.

## Privacy / committed content

This is a **public** repo. Do not commit incidental personal info: personal names (outside the intentional `website/` author branding and the `package.json` author field), real personal filenames, personal infrastructure URLs, or personal incident specifics — in docs, tests, scripts, or examples. Use generic placeholders (`Ada`, `sample.zip`, `https://dashboard.example.com`) and supply real infra origins at deploy time via `ALLOWED_ORIGINS`. `scripts/security-check.sh` blocks any `*.vercel.app` hostname automatically; for specific strings you never want committed, add them (one regex per line) to the gitignored `.security/pii-patterns.txt` (and as a CI secret/file for CI coverage).

## AX (Agent Experience) rules

- All tool errors must use `toolError(toolName, error, context?)` for structured error objects — never throw generic messages that hide the root cause. The structured form includes `tool`, `message`, `code`, and optional `scope`/`hint` fields.
- All tool responses pass through `serializeResponse()` via `toolResponse()`. Never return raw `{ content: [...] }` with unserialized data. Never return raw Date, BigInt, Buffer, or class instances.
- Composite tools (get_stats, daily_briefing) must wrap each independent section in try/catch and return partial results on failure. Failed sections include `{ error: true, message, code }` in the response — they are never silently omitted.
- All aggregate SQL queries (COUNT, MIN, MAX, AVG) must handle null/empty results with sensible defaults (0, null, []).
- New tools must include an output schema smoke test covering the empty-DB case.
- The `health_check` tool is always registered and provides per-component diagnostics. Use it as the first step when diagnosing infrastructure issues.
