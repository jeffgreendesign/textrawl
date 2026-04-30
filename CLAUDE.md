# CLAUDE.md

Claude Code reference for Textrawl.

## Commands (from `package.json`)

| Task | Command |
|---|---|
| Install deps | `pnpm install` |
| Interactive env setup | `pnpm setup` |
| Dev server | `pnpm dev` |
| Build server | `pnpm build` |
| Start built server | `pnpm start` |
| Typecheck | `pnpm typecheck` |
| Lint (TS/JS) | `pnpm lint` |
| Lint (Markdown) | `pnpm lint:md` |
| Unit tests | `pnpm test` |
| Quick quality | `pnpm quality` |
| Fast local gate | `pnpm verify:fast` |
| Canonical CI/local gate | `pnpm verify` |
| MCP inspector | `pnpm inspector` |
| Desktop app dev | `pnpm desktop:dev` |
| CLI convert | `pnpm convert -- <subcommand> ...` |
| CLI upload | `pnpm upload -- <path>` |

## Architecture boundaries

- **Server (`src/`)**: Express + MCP endpoint (`/mcp`) + REST (`/api/upload`, `/health/*`). Holds Supabase service key usage.
- **Desktop (`desktop/`)**: Electron conversion/upload UX. Must not embed server-only secrets in renderer.
- **CLI (`scripts/cli/`)**: Batch conversion/upload pipeline for local archives.
- **Docs site (`website/`, `docs/`)**: Next.js docs and MDX reference content.

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
- **Security hardening**: `scripts/security-rls.sql` (+ `scripts/security-rls-memory.sql`)

## MCP tools reference

<!-- Document/search: search, get_document, list_documents, update_document, add_note -->
<!-- Memory: remember_fact, query_memory, relate_entities, forget_entity, extract_memories -->
<!-- Conversation: save_conversation_context, query_conversations, delete_conversation -->
<!-- Stats: get_stats, health_check -->
<!-- Insights: get_insights, discover_connections, dismiss_insight, build_knowledge -->
<!-- Unified: ask, daily_briefing, save_url, timeline -->
<!-- Postgres: pg_analyze, pg_recommendations, pg_report_history -->

Tool implementations: `src/tools/*.ts`. See `README.md` for full tool documentation.

## Postgres analysis tools

- Gated on `DATABASE_URL` env var (direct `pg` connection, independent of Supabase)
- MCP tools: `src/tools/pg-analyze.ts`
- Analysis engine: `src/services/pg-analyze/`
- CLI: `pnpm pg:analyze` (`scripts/cli/pg-analyze.ts`)
- Reports saved to `PG_REPORT_DIR` (default `./reports/pg-analysis`)

## Conventions

- ESM imports require explicit `.js` extension.
- Keep MCP stdout clean (avoid arbitrary stdout logging in MCP request path).
- Prefer small, PR-shaped changes and keep tool schemas backward compatible.
- MCP tool handlers MUST return plain JSON-serializable values. Handlers MUST NOT return raw Date, BigInt, Buffer, or class instances. All date fields MUST be ISO 8601 strings or null. All aggregate queries (COUNT, MIN, MAX) MUST handle the empty-table case with sensible defaults (0, null, []). Every scope in get_stats MUST be wrapped in its own try/catch so partial failures MUST NOT cause a crash for scope=all.

## AX (Agent Experience) rules

- All tool errors must use `toolError(toolName, error, context?)` for structured error objects — never throw generic messages that hide the root cause. The structured form includes `tool`, `message`, `code`, and optional `scope`/`hint` fields.
- All tool responses pass through `serializeResponse()` via `toolResponse()`. Never return raw `{ content: [...] }` with unserialized data. Never return raw Date, BigInt, Buffer, or class instances.
- Composite tools (get_stats, daily_briefing) must wrap each independent section in try/catch and return partial results on failure. Failed sections include `{ error: true, message, code }` in the response — they are never silently omitted.
- All aggregate SQL queries (COUNT, MIN, MAX, AVG) must handle null/empty results with sensible defaults (0, null, []).
- New tools must include an output schema smoke test covering the empty-DB case.
- The `health_check` tool is always registered and provides per-component diagnostics. Use it as the first step when diagnosing infrastructure issues.
