# AGENTS.md

Agent/developer operating guide for Textrawl.

## First commands (start here)

```bash
pnpm install
pnpm setup
pnpm dev
# optional
pnpm desktop:dev
pnpm inspector
```

## Safety rules

- Never log, print, or commit `SUPABASE_SERVICE_KEY` or `API_BEARER_TOKEN`.
- Keep server-only secrets server-side; do not place service-role credentials in desktop renderer code, website bundles, or client config files.
- Treat desktop distribution as client-like: only call server APIs from the desktop app, never embed privileged Supabase keys.

## Where to start (code map)

- Main server entry: `src/index.ts`
- MCP server/tool registration: `src/server.ts`, `src/tools/index.ts`
- Search implementation:
  - Tool surface/schema: `src/tools/search.ts`
  - Database hybrid search RPC call: `src/db/search.ts`
  - SQL function definitions: `scripts/setup-db*.sql`
- Upload pipeline:
  - REST route: `src/api/upload.ts`
  - Text extraction: `src/services/processor.ts`
  - Chunking: `src/services/chunker.ts`
  - Embeddings: `src/services/embeddings.ts`
  - Persistence: `src/db/documents.ts`, `src/db/chunks.ts`
- Schema scripts:
  - Core knowledge: `scripts/setup-db.sql`, `scripts/setup-db-ollama.sql`, `scripts/setup-db-ollama-v2.sql`
  - Memory: `scripts/setup-db-memory.sql`, `scripts/setup-db-memory-ollama.sql`
  - Conversations: `scripts/setup-db-conversation*.sql`
  - Insights: `scripts/setup-db-insights*.sql`
  - Security hardening (RLS): `scripts/security-rls.sql`, `scripts/security-rls-memory.sql`

## Quality gates

- Canonical full gate: `pnpm verify`
- Fast local gate: `pnpm verify:fast`

## Notes

- Keep MCP tool names and schemas stable unless explicitly requested.
- Use `console.error()` for logging paths that may affect stdio MCP JSON-RPC transport.
