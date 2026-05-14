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

---

# Memory System Roadmap (Phases 5–14)

Derived from `docs/research/memory-systems.md` (May 2026 survey). Each phase below is server-side only and scoped to a single 200k context window: bounded file set, at most one additive migration, focused tests. New env vars live in `src/utils/config.ts` and are configured via shell/`.env` — no CLI or desktop integration is in scope. Tier 3 deferred items (HippoRAG PPR, MAGMA multi-graph, GraphRAG-lite communities, A-MEM link evolution) are intentionally omitted; revisit once Phases 5–14 stabilize.

Dependency order: Phase 5 (extraction provider adapter) is a prerequisite for Phase 6 (Mem0 pipeline). Phase 7 (identity layer) and Phases 12/14 (bi-temporal, CoALA kinds) build on the Phase 6 pipeline. Phase 13 (conversations→memory) depends on Phase 6. Phases 8/9 (rerank, weighting) and Phase 10 (consolidation) and Phase 11 (Claude memory MCP backend) are independent and can run in parallel after Phase 5.

---

## Phase 5 — Extraction LLM provider adapter

Today `src/services/memory-extraction.ts` is hardcoded to `@anthropic-ai/sdk`. Before the Mem0 pipeline can be claimed provider-agnostic, extraction needs a provider abstraction parallel to `src/services/embeddings.ts`.

### Files

- **New** `src/services/extraction-llm.ts` — modeled on `src/services/embeddings.ts`: a `runExtraction(messages, schema?)` dispatcher selecting on `MEMORY_LLM` env, with lazy clients for Anthropic / OpenAI / Google / Ollama. Defaults: `claude-haiku-4-5`, `gpt-4.1-mini`, `gemini-2.5-flash`, `llama3.1:8b-instruct`.
- **Modify** `src/services/memory-extraction.ts` — replace direct Anthropic calls in `extractMemoriesFromText()` with `runExtraction()`. No behavior change.
- **Modify** `src/utils/config.ts` — register `MEMORY_LLM`, `MEMORY_LLM_MODEL`.
- **Tests** — unit test the dispatcher per provider with a mocked client; confirm `extractAndStoreMemories()` still passes existing tests.

### Verification

- `pnpm verify` green.
- Manual: set `MEMORY_LLM=openai`, call `extract_memories` tool, confirm extraction succeeds.

---

## Phase 6 — Mem0-style ADD/UPDATE/DELETE/NOOP write pipeline

Replace the 0.95-cosine append-only dedup in `src/services/memory-extraction.ts` with a single LLM call returning JSON ops, executed in a transaction. No schema change beyond an audit column.

### Files

- **Modify** `src/services/memory-extraction.ts` — rewrite the `findSimilarObservation()` callsite into a `decideOperations(newCandidates, existingNeighbors)` step that returns `Array<{ action: 'ADD' | 'UPDATE' | 'DELETE' | 'NOOP', target_observation_id?: string, content: string, confidence?: number }>`. Execute inside a single transaction.
- **New migration** `scripts/migrations/00XX-write-decision.sql` — `ALTER TABLE memory_observations ADD COLUMN write_decision JSONB`. Persists the operation log per observation for audit.
- **Modify** `src/tools/memory.ts` — `extract_memories` preview mode displays the planned ops list, not just candidate observations.
- **Tests** — table-driven: each action type with mocked LLM output; transaction rollback on partial failure.

### Verification

- `pnpm verify` green.
- Manual: ingest a document, ingest a contradicting follow-up, confirm an `UPDATE` op fires and the audit JSON is populated.

---

## Phase 7 — Semantic entity resolution (identity layer)

Personal data uses aliases ("Textrawl", "the MCP thing", "that project"). Add entity linking during extraction so variant mentions map to a stable entity ID. Slots into the Phase 6 pipeline as a pre-step.

### Files

- **New migration** `scripts/migrations/00XX-entity-aliases.sql` — `ALTER TABLE memory_entities ADD COLUMN aliases TEXT[] DEFAULT '{}'`. Add GIN index on `aliases`.
- **Modify** `src/services/memory-extraction.ts` — before `decideOperations`, run a `resolveEntity(mention, candidates)` step that picks an existing entity (or creates a new one) and appends to `aliases`. Reuse the embedding-similarity helper.
- **Modify** `src/tools/memory.ts` — `query_memory` entity mode matches against `name` ∪ `aliases`.
- **Tests** — alias matching across known variants; new-entity creation when no alias matches.

### Verification

- Manual: create entity "Textrawl", ingest text mentioning "the MCP thing"; confirm alias is recorded, not a duplicate entity.

---

## Phase 8 — Cross-encoder rerank after `memory_hybrid_search`

The function in `scripts/setup-db-memory.sql` already returns top-N candidates. Add an application-layer rerank step before returning to the tool caller.

### Files

- **New** `src/services/rerank.ts` — provider abstraction (`rerank(query, documents): Promise<RankedDoc[]>`), provider switch on `RERANK_PROVIDER` env. Implementations: Cohere `rerank-v3`, Voyage `rerank-2`, Vertex AI Ranking, BGE `bge-reranker-v2-m3` via Ollama or local Transformers.
- **Modify** `src/tools/memory.ts` — `query_memory` search mode pipes `memory_hybrid_search` results through `rerank()` before truncating to `limit`.
- **Modify** `src/utils/config.ts` — register `RERANK_PROVIDER`, `RERANK_MODEL`, optional API keys.
- **Tests** — mocked rerankers per provider; confirm rerank is skipped (no-op) when `RERANK_PROVIDER=off`.

### Verification

- Compare top-5 hits with and without rerank on a fixture query; confirm rerank reorders without dropping relevant results.

---

## Phase 9 — Contextual weighting and decay

Recency/frequency weighting at retrieval time, with explicit override controls. Touches the same retrieval surface as Phase 8.

### Files

- **Modify** `scripts/setup-db-memory.sql` — add optional `recency_half_life` and `frequency_boost` params to `memory_hybrid_search()`. Compute score as `base_score * exp(-age/half_life) * (1 + log(1 + access_count) * boost)`.
- **New migration** `scripts/migrations/00XX-observation-access.sql` — `ALTER TABLE memory_observations ADD COLUMN access_count INT DEFAULT 0, last_accessed_at TIMESTAMPTZ`.
- **Modify** `src/tools/memory.ts` — `query_memory` accepts optional `historical: boolean` and `as_of: ISO timestamp` params; both bypass the recency decay.
- **Tests** — assert old-but-recently-accessed observations rank above stale ones; confirm `historical=true` returns equal weighting.

### Verification

- Manual: store 10 facts spread over months; query without flag (recent dominates), then with `historical=true` (uniform).

---

## Phase 10 — Consolidation cron ("Dreaming")

Background pattern mirroring `src/services/insight-analysis.ts`'s `runInsightScan`. Iterate memory clusters, distill consolidated observations, link sources.

### Files

- **New** `src/services/memory-consolidation.ts` — exports `runMemoryConsolidation()` that selects top-K entity clusters, fetches their observations, calls `runExtraction()` (Phase 5) to produce a consolidated summary, writes it as a new observation marked `consolidated: true` in metadata, and links sources via `memory_relations`.
- **Modify** `src/services/scheduler.ts` — register the consolidation interval (default 24h, configurable via `MEMORY_CONSOLIDATION_INTERVAL_HOURS`).
- **New migration** `scripts/migrations/00XX-consolidation-queue.sql` — mirror `insight_queue`: `memory_consolidation_queue` with `last_run_at`, `processing` flags.
- **Modify** `src/tools/memory.ts` — add an on-demand `consolidate_memory` tool wrapping `runMemoryConsolidation()`.
- **Tests** — fixture with 5 related observations; assert one consolidated observation is written with all 5 linked.

### Verification

- Manual: trigger via tool, inspect new `consolidated` observations and the relations pointing at sources.

---

## Phase 11 — Anthropic `memory_20250818` MCP backend

New MCP tool implementing the six Claude filesystem-style memory ops against the existing memory graph. Makes Textrawl a drop-in durable backend for Anthropic agents (Claude Code, Managed Agents).

### Files

- **New** `src/tools/claude-memory.ts` — register an MCP tool family for the six ops:
  - `view /memories` → list `memory_entities`
  - `view /memories/{name}.md` → render the entity + observations as Markdown
  - `create /memories/{name}.md` → create entity
  - `str_replace` / `insert` → write observations attached to the entity
  - `delete` / `rename` → entity-level
- **Modify** `src/server.ts` (MCP registration) — wire `claude-memory.ts` into the tool registry.
- **Security** — path-traversal protection: paths must start with `/memories`, canonicalize, reject `..` segments. Mirror Anthropic's spec.
- **Tests** — every op against a fixture DB; explicit path-traversal rejection tests.

### Verification

- Run `pnpm inspector`, exercise each op, confirm rendered Markdown matches stored entity/observations.

---

## Phase 12 — Bi-temporal observations + provenance

Additive migration giving observations real UPDATE/DELETE lineage. Couples with Phase 6's pipeline so `UPDATE` ops close the old row and write a replacement.

### Files

- **New migration** `scripts/migrations/00XX-bitemporal.sql` — keep `valid_from`; alias or evolve `valid_until` → `valid_to` semantics; add `invalidated_by UUID REFERENCES memory_observations(id)`.
- **Modify** `scripts/setup-db-memory.sql` — extend `memory_hybrid_search()` with optional `as_of TIMESTAMPTZ` (default `NOW()`); filter `valid_to IS NULL OR valid_to > as_of`.
- **Modify** `src/services/memory-extraction.ts` (Phase 6 pipeline) — `UPDATE` op sets old row's `valid_to = NOW()`, `invalidated_by = new_id`, inserts replacement.
- **Modify** `src/tools/memory.ts` — `query_memory` adds a `sources[]` field on results listing contributing observation IDs (ChatGPT "memory sources" pattern). Accept optional `as_of` param.
- **Tests** — replacement lineage assertions; `as_of` returns the historical view.

### Verification

- Manual: store a fact, update it, query with and without `as_of`; confirm two timelines.

---

## Phase 13 — Conversations → memory extraction pipeline

Close the gap between `src/tools/conversation.ts`'s `save_conversation_context` and the memory graph. Saved turns enqueue an extraction job.

### Files

- **New migration** `scripts/migrations/00XX-source-turn.sql` — `ALTER TABLE memory_observations ADD COLUMN source_turn_id UUID REFERENCES conversation_turns(id)`.
- **Modify** `src/tools/conversation.ts` — at the end of `save_conversation_context`, emit `events.emit('conversation_turns_saved', { turnIds })` (use the existing typed emitter in `src/services/events.ts`).
- **New** `src/services/conversation-to-memory.ts` — subscriber that fetches turns, calls `extractAndStoreMemories()` (Phase 6 pipeline), records `source_turn_id` per observation.
- **Modify** `src/services/scheduler.ts` — register the subscriber on startup.
- **Tests** — saving a turn produces observations with `source_turn_id` populated.

### Verification

- Manual: call `save_conversation_context` with a turn containing a learnable fact, query memory, confirm provenance back to the turn.

---

## Phase 14 — CoALA observation kinds + procedural skills

Make the cognitive-architecture split (episodic / semantic / procedural) legible in the schema. Tiny `procedural_skills` table + Reflexion-style hook from conversation failures.

### Files

- **New migration** `scripts/migrations/00XX-observation-kind.sql` — `CREATE TYPE observation_kind AS ENUM ('episodic', 'semantic', 'procedural'); ALTER TABLE memory_observations ADD COLUMN kind observation_kind DEFAULT 'semantic'`.
- **New migration** `scripts/migrations/00XX-procedural-skills.sql` — `procedural_skills (id, trigger_pattern, skill_body, source_observation_id, success_count, failure_count, created_at)`.
- **Modify** `src/services/memory-extraction.ts` — extractor prompt classifies each observation by kind; populate `kind` on write.
- **Modify** `src/services/conversation-to-memory.ts` (from Phase 13) — detect failure signals in turns (user corrections, "actually...", retries); emit procedural observations and `procedural_skills` rows.
- **Modify** `src/tools/memory.ts` — `query_memory` accepts optional `kind` filter; surface in results.
- **Tests** — kind classification on fixture inputs; procedural-skill extraction from a corrective turn.

### Verification

- Manual: a conversation with a user correction produces a `procedural_skills` row that triggers on similar future queries.
