# AX Upgrade Report (2026-03-03)

## Scope

Improve agent/developer experience (AX) and operational clarity without changing core product behavior.

---

## Step 0 — Inventory summary

### Stack and entry points

- **Server framework**: Express 5 + MCP SDK (`StreamableHTTPServerTransport`) in stateless HTTP mode.
- **Main entry**: `src/index.ts`
- **MCP assembly**: `src/server.ts`
- **Endpoints**:
  - `POST /mcp`
  - `POST /api/upload`
  - `GET /health`, `GET /health/ready`, `GET /health/live`
  - Status dashboard routes under `src/api/status.ts`
- **Auth token behavior**:
  - `/mcp` and `/api/upload` use bearer auth middleware.
  - In development, auth can be skipped when no token/OAuth config is present.
  - In production, config enforces auth (`API_BEARER_TOKEN` or OAuth).
- **Rate limits**:
  - API: 100/min
  - Upload: 10/min
  - Health: 300/min
  - Optional shared limits via Redis (`REDIS_URL`).

### Supabase schema scripts and RLS

- **Core knowledge schema**:
  - `scripts/setup-db.sql` (OpenAI 1536d)
  - `scripts/setup-db-ollama.sql` (Ollama 1024d)
  - `scripts/setup-db-ollama-v2.sql` (Ollama 768d)
- **Memory**:
  - `scripts/setup-db-memory.sql` (OpenAI)
  - `scripts/setup-db-memory-ollama.sql` (Ollama 1024d)
- **Conversations**:
  - `scripts/setup-db-conversation.sql` (OpenAI)
  - `scripts/setup-db-conversation-ollama.sql` (Ollama 1024d)
  - `scripts/setup-db-conversation-ollama-v2.sql` (Ollama 768d)
- **Insights**:
  - `scripts/setup-db-insights.sql`, `scripts/setup-db-insights-ollama.sql`, `scripts/setup-db-insights-ollama-v2.sql`
- **Security hardening**:
  - `scripts/security-rls.sql` (+ `scripts/security-rls-memory.sql`)
- **RLS for typical use**:
  - Typical server usage relies on service-role key (bypasses RLS by design); RLS remains defense-in-depth for anon/authenticated roles.

### Embedding providers and dimensionality

- Providers: OpenAI or Ollama (`EMBEDDING_PROVIDER`).
- Dimensions:
  - OpenAI: 1536
  - Ollama: 1024 or 768 depending on model
- Constraint/enforcement:
  - Code determines expected model dimensions and SQL schemas define vector dimensions.
  - Mismatch surfaces as DB/RPC errors if wrong schema is used for selected model.

### Desktop + CLI flows

- **Desktop flow**: `pnpm desktop:dev` (workspace package `desktop/`) for conversion/upload UX.
- **CLI flow**:
  - Convert: `pnpm convert -- <subcommand> <path>`
  - Upload: `pnpm upload -- <path>`

### Current quality gates and CI

- Existing scripts included lint/typecheck/test/build/quality.
- CI workflow existed and ran checks step-by-step.
- Husky pre-commit existed and ran a checklist of local checks.

### Top 5 most common tasks (commands + files)

1. **Boot local server**
   - Commands: `pnpm install`, `pnpm setup`, `pnpm dev`
   - Files: `.env.example`, `scripts/setup.sh`, `src/index.ts`
2. **Initialize database schema**
   - Command pattern: run selected SQL script in Supabase SQL editor
   - Files: `scripts/setup-db*.sql`, `scripts/security-rls.sql`
3. **Connect MCP client and validate tools**
   - Commands: configure client + `pnpm inspector`
   - Files: `README.md`, `src/server.ts`, `src/tools/*.ts`
4. **Batch import data**
   - Commands: `pnpm convert -- ...`, `pnpm upload -- ...`
   - Files: `scripts/cli/convert.ts`, `scripts/cli/upload.ts`
5. **Run full project checks before PR**
   - Command: `pnpm verify`
   - Files: `package.json`, `.github/workflows/ci.yml`

---

## Changes made

- Added a concise, operator-focused `AGENTS.md` with first commands, secret-handling rules, and code map.
- Replaced/updated `CLAUDE.md` with script-accurate command table and clear architecture boundaries.
- Added operational docs:
  - `docs/ENV.md`
  - `docs/RUNBOOK.md`
  - `docs/ARCHITECTURE.md`
  - `docs/DECISIONS.md`
  - `docs/TROUBLESHOOTING.md`
- Standardized quality gates:
  - Added canonical `pnpm verify`
  - Added fast local `pnpm verify:fast`
  - Updated CI to call one command (`pnpm verify`)
  - Updated pre-commit to call one fast command (`pnpm verify:fast`)
- Reliability guardrail:
  - Added deterministic secondary sort (`id`) in `listDocuments` query path.

---

## Why (official and repo sources)

- **Single command gate in CI/local** reduces drift and “works-on-my-machine” mismatch.
  - Repo source: existing CI + scripts (`package.json`, `.github/workflows/ci.yml`).
- **Secret-handling emphasis** aligns with Supabase key model and server-only service role usage.
  - Supabase official: [supabase]
- **MCP config/runbook guidance** aligns with official MCP and OpenAI MCP connector docs.
  - MCP official: [mcp]
  - OpenAI MCP docs: [openai-mcp]
- **Dimension/schema mapping docs** reduce common pgvector runtime failures.
  - pgvector official: [pgvector]
  - PostgreSQL official: [postgresql]
- **Deterministic pagination/sorting** improves predictable list behavior for agents/tools.
  - Repo source: `src/db/documents.ts`

---

## How to verify

1. Install and validate scripts are present:

```bash
pnpm install
pnpm -s run | rg "verify|verify:fast|quality"
```

Expected:

- Both `verify` and `verify:fast` listed.

1. Run fast local gate:

```bash
pnpm verify:fast
```

Expected:

- lint + markdown lint + typecheck + tests + local shell checks pass.

1. Run canonical full gate:

```bash
pnpm verify
```

Expected:

- quality + tests + build + docs build pass.

1. Confirm CI uses the canonical command:

```bash
rg "pnpm verify" .github/workflows/ci.yml
```

Expected:

- CI contains one gate step using `pnpm verify`.

1. Confirm pre-commit uses fast gate:

```bash
cat .husky/pre-commit
```

Expected:

- Hook executes `pnpm verify:fast`.

---

## Follow-ups

1. Add a lightweight DB dimension preflight check (query vector dimensions on startup and compare to provider model) for friendlier error messages.
2. Add an explicit deployment matrix doc (Supabase-hosted vs self-hosted Postgres + PostgREST/Supabase alternatives).
3. Add contract tests for read-only tool `structuredContent` schemas.
4. Consider documenting Supabase Vercel integration only if/when Vercel deployment is officially supported in this repo.


## References

[supabase]: https://supabase.com/docs/guides/api/api-keys
[mcp]: https://modelcontextprotocol.io
[openai-mcp]: https://platform.openai.com/docs/mcp
[pgvector]: https://github.com/pgvector/pgvector
[postgresql]: https://www.postgresql.org/docs/
