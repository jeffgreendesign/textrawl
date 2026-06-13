# Roadmap TODO

The docs-sync backlog (Phases 1–4) is complete — those documentation fixes shipped and are recorded in `CHANGELOG.md` under `[0.4.0]`. What remains is the server-side Memory System Roadmap below.

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
