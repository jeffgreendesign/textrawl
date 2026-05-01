# Docs Sync TODO

Audit completed 2026-05-01. Six discrepancies found between `/docs` and the codebase. Each phase below fits within a 200k context window session.

---

## Phase 1 — Database provider: Supabase → Neon

The project migrated to Neon PostgreSQL (`DATABASE_URL`), but docs still instruct users to create a Supabase project and set `SUPABASE_URL`/`SUPABASE_SERVICE_KEY`.

### Files to update

**`docs/getting-started/installation.mdx`**

- Lines 66–135: Replace "Option 1: Supabase (Recommended)" section with Neon setup (create project at neon.tech, copy pooled connection string into `DATABASE_URL`)
- Lines 128–135: Replace required vars block (`SUPABASE_URL`, `SUPABASE_SERVICE_KEY`) with `DATABASE_URL=postgresql://...` and `OPENAI_API_KEY=sk-...`

**`docs/getting-started/configuration.mdx`**

- Lines 11–18: Rename section header "Database Connection"; replace `SUPABASE_URL`/`SUPABASE_SERVICE_KEY` rows with `DATABASE_URL` (required, Neon pooled connection string)
- Lines 224–256: Update all three example configs (Dev, Production, Self-hosted) to use `DATABASE_URL` instead of the two Supabase vars

**`docs/cli/index.mdx`**

- Line 15: Change "Upload to Supabase" → "Upload to knowledge base"
- Line 73: Change "Supabase Knowledge Base" → "Knowledge Base" in the workflow diagram

**`docs/architecture/embeddings.mdx`**

- Line 32: Change "Run in Supabase SQL Editor" → `psql $DATABASE_URL -f scripts/setup-db.sql`
- Line 48: Same change for the Google AI schema instruction

**`docs/mcp-tools/index.mdx`**

- Line 349: Error table row "Database not configured" — change fix text from "Set `SUPABASE_URL` and `SUPABASE_SERVICE_KEY`" → "Set `DATABASE_URL`"
- Line 160: pg-analyze section — change "independent of Supabase client" → "independent of the main database client"

**`docs/guides/supabase-requirements.mdx`**

- Retitle to "Database Requirements" (or rename file to `database-requirements.mdx` and update `meta.json`)
- Replace Supabase-specific tier names/links with Neon equivalent (Neon free tier, Neon Pro, etc.)
- Keep pgvector/HNSW sizing math — it applies to any Postgres deployment
- Update any "Supabase Dashboard" UI references to generic psql/Neon console instructions

**`docs/RUNBOOK.md`**

- Update "Supabase setup" section heading and profile descriptions to reference Neon
- Replace `SUPABASE_URL`/`SUPABASE_SERVICE_KEY` wherever they appear with `DATABASE_URL`

---

## Phase 2 — Google AI embeddings model/dimensions + `health_check` tool

Two independent issues that are small enough to tackle in one session.

### 2a. Google AI model and dimensions outdated

Docs say `text-embedding-004` at 768d. Codebase default is `gemini-embedding-2-preview` at 3072d.

**`docs/architecture/embeddings.mdx`**

- Line 14: Provider comparison table — update Google AI row: Dimensions `768` → `3072`, Model `text-embedding-004` → `gemini-embedding-2-preview`
- Line 40–50: Google AI setup code block — change model env var default to `gemini-embedding-2-preview`, update schema reference to reflect 3072d
- "Choose Google AI if" recommendation — update dimension mention (768 → 3072)

**`docs/getting-started/configuration.mdx`**

- Line 33: Table row — change `GOOGLE_EMBEDDING_MODEL` default from `text-embedding-004` → `gemini-embedding-2-preview`
- Lines 50–53: Google AI config block — update model name and dimensions (768 → 3072)

### 2b. Missing `health_check` MCP tool

**`docs/mcp-tools/index.mdx`**

- Line 1: Change "25 MCP tools" → "26 MCP tools" in title/description
- Add `health_check` entry under a new "Diagnostics" section (or append to "Stats" section) with short description and link to new page

**Create `docs/mcp-tools/health-check.mdx`**

- Title: `health_check`
- Description: Per-component diagnostic check (database, documents, chunks, memory, conversations, insights). Use as the first step when diagnosing infrastructure issues.
- Parameters: none (or optional `components` filter if supported)
- Example response: show healthy and degraded component states
- Error handling: standard tool error format
- Related tools: `get_stats`

---

## Phase 3 — Missing CLI commands + model ID typo

### 3a. Missing CLI converters in docs

**`docs/cli/index.mdx`**

- Unified Converter commands table (around line 47): Add four missing rows:
  - `spotify <path>` — Convert Spotify data export
  - `reddit <path>` — Convert Reddit data export
  - `facebook <path>` — Convert Facebook data export
  - `instagram <path>` — Convert Instagram data export
- Available Commands section: Add `scan` and `split` entries with links to their new pages
- Next Steps links: Add links to new `scan.mdx` and `split.mdx`

**Create `docs/cli/scan.mdx`**

- Title: Scan — Analyze files before upload
- Command: `pnpm scan -- <directory-or-file> [options]`
- What it does: inspects converted markdown files to report file sizes, estimated chunk counts, and heading structure; flags oversized files
- Options table: `--all`, `--max-file-size <mb>`, `--max-chunks <n>`
- Example output (tabular: file, size, estimated chunks, status)
- Use case: run before `pnpm upload` to identify files needing splitting
- Next steps: link to `split.mdx` and `batch-upload.mdx`

**Create `docs/cli/split.mdx`**

- Title: Split — Break large markdown files into chunks
- Command: `pnpm split -- <file-or-directory> [options]`
- What it does: splits large markdown files at heading boundaries; preserves frontmatter; adds linking metadata
- Options table: `--split-level <h>`, `--target-chunks <n>`, `--output <dir>`, `--only-oversized`, `--dry-run`, `-r` (recursive)
- Example: a 2000-line file split into 4 files at `##` headings
- Next steps: link to `batch-upload.mdx`

### 3b. Model ID typo

**`docs/getting-started/configuration.mdx`**

- Line 142: Change `EXTRACTION_MODEL=claude-haiku-4-5-20250501` → `EXTRACTION_MODEL=claude-haiku-4-5-20251001`

---

## Phase 4 — A2A protocol docs + residual cleanup

### 4a. A2A protocol documentation

README lists "Agent Discovery — A2A protocol at `/.well-known/agent.json`" as a feature with no corresponding docs.

**Create `docs/architecture/a2a-protocol.mdx`**

- Title: Agent-to-Agent (A2A) Protocol
- What it is: standard discovery mechanism allowing other AI agents to find and interact with this knowledge server
- Endpoint: `GET /.well-known/agent.json` — returns agent card (name, description, capabilities, MCP endpoint)
- How to use: point an orchestrator agent at the server URL; it auto-discovers available tools
- Example agent card JSON
- Security note: endpoint is publicly readable by design (no auth required), but actual tool calls still require `API_BEARER_TOKEN`
- Related: link to MCP Tools overview

**`docs/architecture/index.mdx`**

- Transport layer section: add A2A as a fourth transport alongside MCP, REST, WebSocket; link to new page

**`docs/getting-started/introduction.mdx`**

- Key features list: add "Agent Discovery" feature entry matching README wording

### 4b. Residual cleanup

**`docs/mcp-tools/index.mdx`** (if not caught in Phase 1)

- Confirm pg-analyze description no longer mentions "Supabase client" after Phase 1 edit
- Confirm error table "Database not configured" row uses `DATABASE_URL` after Phase 1 edit
