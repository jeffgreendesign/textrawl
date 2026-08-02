---
title: Memory System Architectures (May 2026)
description: Survey of modern AI memory systems and recommended improvements for Textrawl
---

# Research: Memory System Architectures (May 2026)

This document surveys the state of AI memory systems as of May 14, 2026 and recommends improvements for Textrawl's memory graph, conversations, and insights subsystems. Recommendations are provider-agnostic and apply across the OpenAI, Google AI, and Ollama embedding/LLM stacks.

## TL;DR

The three highest-leverage changes for Textrawl, in order:

1. **Replace append-only writes with a Mem0-style ADD/UPDATE/DELETE/NOOP pipeline** in `src/services/memory-extraction.ts`. Today's 0.95-cosine dedup is the only mutation pathway; the rest of the field has moved on.
2. **Add a cross-encoder rerank step after `memory_hybrid_search`** (Cohere/Voyage, Vertex AI Rerank, or local BGE-reranker-v2). Cheap, dramatic precision lift.
3. **Implement the Anthropic `memory_20250818` filesystem interface as an MCP-exposed Textrawl tool.** This lets Claude agents — including Claude Code and Managed Agents — use Textrawl as their durable memory backend, with the existing entity/observation tables as the storage layer.

A consolidation cron mirroring Anthropic's "Dreaming" pattern, bi-temporal observations, and a conversations→memory pipeline are the natural follow-ups.

---

## Why memory is a 2026 first-class concern

Three things changed in the last six months:

- **Vendor-native memory shipped.** Anthropic's memory tool, OpenAI Codex Memories, ChatGPT cross-chat memory, and Gemini Personal Context all moved out of preview between January and May 2026. Agents now arrive with their own memory expectations and APIs.
- **The benchmark suite matured.** LongMemEval and LOCOMO are now the de-facto eval targets, and recent systems (LiCoMemory, ENGRAM-R) post double-digit improvements over GraphRAG/Mem0 baselines on them.
- **The ecosystem is fragmenting.** Mem0, Zep/Graphiti, Letta, Cloudflare Agent Memory, and Supermemory are now distinct architectural families, not interchangeable. Picking which patterns to absorb matters.

Million-token context windows complicate the picture: on most LongMemEval and LOCOMO instances, a "dump everything into context" baseline is now competitive on accuracy. Memory systems in 2026 justify themselves on **cost, latency, and provenance**, not raw recall.

---

## Current Textrawl memory architecture

Textrawl ships three independent memory-adjacent subsystems built in isolation:

| Subsystem | Schema | Surface | Status |
|---|---|---|---|
| Memory graph | `scripts/setup-db-memory.sql` (entities/observations/relations) | `src/tools/memory.ts` (`remember_fact`, `extract_memories`, `build_knowledge`, `query_memory`) | Append-only, 0.95-cosine dedup, RRF without rerank |
| Conversations | `scripts/setup-db-conversation.sql` | `src/tools/conversation.ts:save_conversation_context` | Sessions + turns with embeddings; no extraction pipeline to memory |
| Insights | `scripts/setup-db-insights.sql` | `src/services/insight-analysis.ts:runInsightScan` | Cross-source/theme/outlier discovery over document chunks only — does not see memory or conversations |

Gaps as of this writing:

- No UPDATE / DELETE / MERGE pathway for facts (only insert-or-skip).
- Partial temporal support exists (`valid_from`, `valid_until`), but no bi-temporal lineage model (`invalidated_by`, transaction-time audit, replacement chains).
- No cross-encoder rerank after `memory_hybrid_search`.
- No background consolidation / summarization job for memory.
- No conversations → memory extraction pipeline.
- Relations are retrievable in entity context, but no multi-hop graph traversal/ranking in `query_memory` search mode.
- No interop with the now-shipped vendor memory APIs (Claude memory tool, Codex Memories, etc.).

---

## Vendor-native memory APIs

Textrawl is an MCP server consumed *by* these agents, so the shipped interfaces matter more than any research paper.

### Anthropic Claude memory tool (`memory_20250818`)

Client-side filesystem-style tool with six operations: `view`, `create`, `str_replace`, `insert`, `delete`, `rename`. Files are rooted at `/memories`; the developer implements the backend (filesystem, database, encrypted store, etc.). Zero Data Retention eligible. Anthropic injects a system-prompt protocol instructing Claude to view memory before any task and warning that context may be reset at any time. Pairs with **context editing** (client-side clearing of tool results) and **server-side compaction** (automatic summarization near the context limit). The model is trained to write structured notes — `progress.md`, `checklist.md`, project state — rather than free-form prose.

**Relevance to Textrawl:** Textrawl can implement this interface as an MCP-exposed tool that maps the six filesystem ops onto the existing memory graph. `view /memories` lists top-level `memory_entities`; `view /memories/{entity}.xml` returns rendered observations; `create` and `str_replace` write through to `memory_observations` with the file path as the entity name. This makes Textrawl a drop-in durable backend for Claude agents — including Claude Code and Managed Agents — without changing the schema.

### Anthropic "Dreaming" (May 2026, research preview)

Scheduled background process that reviews past sessions, extracts patterns, and curates the memory store. Currently gated to Opus 4.7 and Sonnet 4.6 under the Managed Agents 2026-04-01 beta. This is sleep-inspired consolidation, productized.

**Relevance to Textrawl:** A direct template for a consolidation cron. The `runInsightScan` pattern in `src/services/insight-analysis.ts` is the existing scaffolding — repoint it at `memory_entities` / `memory_observations`, have an LLM cluster related observations, write distilled "consolidated" observations, and mark or archive the sources. The "Dreaming" name gives the feature a recognizable shape for users coming from the Anthropic ecosystem.

### Claude Managed Agents (April 2026 public beta)

Beta header `managed-agents-2026-04-01`. Memory is the headline feature: files-on-a-filesystem, exportable and editable via API or the Claude Console. Early adopters (Netflix, Rakuten, Wisedocs, Ando) report large error and latency reductions on long-running agents.

**Relevance to Textrawl:** Validates the filesystem-style memory abstraction as the dominant 2026 surface. If Textrawl exposes the memory tool backend (above), it can also accept exports from Managed Agents to bootstrap a new user's memory graph.

### OpenAI Codex Memories + Chronicle

Codex now stores persistent context under `~/.codex/memories/`: summaries, durable entries, recent inputs, and supporting evidence from prior threads. **Chronicle** layers screen-context capture on top. Rolling out preview-first to Enterprise and Edu, with EU/UK delayed.

**Relevance to Textrawl:** Codex users running Textrawl as an MCP server already have a parallel local memory store. Textrawl should not try to replace it — but the structured shape (summary / durable / recent / evidence) is a useful guide for how to organize the observation types in our own graph. Consider adding an `observation_type` enum (`summary` / `durable` / `recent` / `evidence`) so the data model can absorb a Codex export.

### ChatGPT memory (May 2026 update)

References past chats + saved memories + connected apps (Gmail) for personalization. New in May 2026: a **memory sources** UI that shows which items influenced a response and lets users edit or remove them.

**Relevance to Textrawl:** Provenance is now a user-facing expectation. Today `query_memory` does not return *why* a result surfaced. Adding a `sources` field that lists the contributing observation IDs and their `source_turn_id` / `source_document_id` brings Textrawl in line with the disclosure norm and is a prerequisite for any UI that wants to expose memory edits.

### Gemini Personal Context (January 2026)

Auto-recall of past chats and preferences, integrated with Gmail, Photos, YouTube, and Search. Default-on; toggle under Settings → Personal context.

**Relevance to Textrawl:** Gemini's bet is that **context from connected apps beats raw model power**. Textrawl already ingests documents; the equivalent move is to wire conversation turns and insights into the same retrieval surface, so a single `query_memory` returns evidence from documents, prior conversations, and memory graph facts together.

---

## Modern memory architectures (research + OSS)

### Mem0 — extraction + write pipeline

Two-stage pipeline: an LLM extracts candidate facts from new input, then a second LLM decides ADD / UPDATE / DELETE / NOOP against existing memories. The April 2026 release moved to single-pass hierarchical extraction plus multi-signal retrieval. Mem0 is currently the strongest published result on personalization-style benchmarks and ships an MCP server.

**Relevance to Textrawl:** Direct replacement for the current 0.95-cosine append-only logic in `src/services/memory-extraction.ts`. Implementation is a single LLM call returning a JSON list of `{ action, target_observation_id, content }` operations, executed against `memory_observations` inside a transaction. No schema change required.

Source: <https://docs.mem0.ai/> · <https://github.com/mem0ai/mem0>

### Zep / Graphiti — bi-temporal knowledge graph

Every edge in the graph carries two timestamps: **valid time** (when the fact was true in the world) and **transaction time** (when the system learned it). Edits don't overwrite — they invalidate the old edge and write a new one. Queries can ask "what did we know yesterday?" as easily as "what is true now?"

**Relevance to Textrawl:** The cleanest path to UPDATE/DELETE without losing audit. An additive migration on `memory_observations` adding `valid_from`, `valid_to`, and `invalidated_by` columns covers most of this; `memory_hybrid_search` filters by `valid_to IS NULL` for "current" queries. Pairs naturally with the Mem0 pipeline above.

Source: <https://arxiv.org/abs/2501.13956> · <https://github.com/getzep/graphiti>

### MAGMA — multi-graph agentic memory

Recent (arXiv 2601.03236, January 2026). Represents each memory item across four orthogonal graphs — **semantic, temporal, causal, entity** — and formulates retrieval as a policy-guided traversal across those relational views. Reports state-of-the-art results on LongMemEval and LOCOMO multi-hop subsets.

**Relevance to Textrawl:** Aspirational for now. Today `memory_relations` is a single untyped edge set; MAGMA argues for a typed relation column with `kind ∈ {semantic, temporal, causal, entity}`. Could be reached incrementally — first add `kind` to `memory_relations`, then add causal/temporal extractors in the Mem0 pipeline, then implement a traversal scorer.

Source: <https://arxiv.org/html/2601.03236v1>

### LiCoMemory

Reports 73.8% accuracy / 76.6% recall on LongMemEval with GPT-4o-mini, with 10–40% lower latency than graph and fact-extraction baselines. Key idea: a lightweight summary index sits in front of the full graph; expensive traversal only runs when the summary index can't satisfy a query.

**Relevance to Textrawl:** A two-tier retrieval pattern that fits Textrawl's existing layers cleanly. Tier 1 = rerank over `memory_hybrid_search` results (fast, covers most queries). Tier 2 = graph traversal over `memory_relations` for multi-hop questions only, gated on a confidence threshold from tier 1.

### ENGRAM-R

Reports 95.5% reduction in input tokens, 77.8% reduction in reasoning tokens, and +21.8pp accuracy on LongMemEval vs strong baselines. Mechanism: compresses retrieved memories into a structured "engram" form before they enter the prompt, rather than pasting raw observation text.

**Relevance to Textrawl:** Important framing for `query_memory`'s output shape. Today the tool returns raw observation rows; an engram-style return (entity → consolidated bullets → optional raw observations as evidence) would cut downstream token cost substantially for Claude/GPT/Gemini callers.

### HippoRAG and HippoRAG 2 — neurobiologically-inspired retrieval

Builds an entity-edge graph at index time, then uses **Personalized PageRank** at query time to find associated memories — mimicking the hippocampal indexing theory. HippoRAG 2 adds graph-based semantic synthesis: a dual-stream answer combining associative recall and explicit logical traversal.

**Relevance to Textrawl:** PPR over `memory_relations` would let `query_memory` find facts that share no surface tokens with the query but are linked through one or two entity hops. Implementable as a SQL recursive CTE or via the `pgrouting` extension; no schema change.

Source: <https://arxiv.org/abs/2405.14831>

### GraphRAG / LazyGraphRAG

Microsoft Research. Builds entity/relation/community summaries at index time; at query time, picks the right summary level. LazyGraphRAG (2025) defers community summarization until query time, dramatically reducing index cost.

**Relevance to Textrawl:** Once a memory user accumulates hundreds of entities, "summarize this cluster" becomes useful. The LazyGraphRAG variant fits Textrawl's mostly-cold workload better than full GraphRAG. Implementation: an optional consolidation cron output is a `memory_communities` table with cluster summaries, retrieved alongside individual observations.

Source: <https://arxiv.org/abs/2404.16130>

### Letta (formerly MemGPT) — agent-managed tiered context

Agent-managed memory with explicit tiers: in-context (always visible to the model), recall (searchable conversation history), and archival (vector store). The agent uses tools to move information between tiers. **Letta Code** (March 2026) is a memory-first coding agent built on this primitive.

**Relevance to Textrawl:** The tier abstraction maps onto Textrawl's existing structure if labeled correctly: insights = in-context summary, conversations = recall, memory graph + documents = archival. Surfacing the tier in `query_memory` results gives agents a way to reason about freshness and depth.

Source: <https://github.com/letta-ai/letta>

### A-MEM — Zettelkasten link evolution

Each new memory gets a structured note with tags and explicit links to existing notes. When a new note is added, an LLM revisits *related* notes and updates their links — so the graph evolves rather than ossifying.

**Relevance to Textrawl:** Today `memory_relations` is populated once (or not at all) and never revised. A-MEM's pattern — re-evaluate neighbor links on every write — slots into the Mem0 pipeline as an extra step: after ADD/UPDATE, fetch top-k related entities and let the LLM propose new/revised edges.

Source: <https://github.com/agiresearch/A-mem>

### CoALA — cognitive architecture framing

Cognitive Architectures for Language Agents. Argues memory should be split into **episodic** (specific past events), **semantic** (general facts), and **procedural** (learned skills/workflows). The categorization is descriptive; the value is in making the system design legible.

**Relevance to Textrawl:** A low-cost relabeling exercise. `memory_observations` becomes episodic-or-semantic; a new tiny `procedural_skills` table captures learned workflows ("when the user asks about X, always also check Y"). The triad maps directly onto how Claude and Codex agents already talk about their memory.

Source: <https://arxiv.org/abs/2309.02427>

### Reflexion / Voyager — self-reflective procedural memory

Agent reflects on its own failures and writes the lesson to a procedural memory that survives the episode. Voyager extended this to a skill library (executable code snippets) for Minecraft agents.

**Relevance to Textrawl:** Concrete fill for the procedural-memory tier above. After a `save_conversation_context` call that includes a failure signal (user correction, retry, "actually..."), a background job extracts a procedural note. Cheap to implement; gives Textrawl a story for "the agent gets better at me over time."

Source: <https://arxiv.org/abs/2303.11366> · <https://arxiv.org/abs/2305.16291>

### MemGPT — virtual context paging

OS-inspired paging of the context window: a fixed in-context working set plus an external store, with the agent issuing `read`/`write`/`evict` calls. Foundational rather than current state of the art, but the abstraction underlies Letta and the Anthropic memory tool both.

**Relevance to Textrawl:** Conceptually equivalent to what the Anthropic memory tool exposes. Worth knowing as the lineage when explaining the design to Textrawl users.

Source: <https://arxiv.org/abs/2310.08560>

### Supermemory, Cloudflare Agent Memory, Hindsight

Three production memory backends launched or expanded in 2026. Supermemory exposes a hosted memory API with a Claude memory tool wrapper. Cloudflare Agent Memory (private beta, April 2026) runs on Workers + Durable Objects + Vectorize. Hindsight adds memory to Codex with screen-context capture.

**Relevance to Textrawl:** Direct competitors at the API layer. Textrawl's differentiator is being self-hosted, MCP-native, and tightly integrated with document ingest. Watching their public API shapes is the cheapest way to validate Textrawl's tool schemas stay idiomatic.

---

## Benchmarks

| Benchmark | Size | Tests | Reference |
|---|---|---|---|
| **LongMemEval** | 500 manually-authored questions, avg 50 sessions / ~115k tokens each | Information extraction, multi-session reasoning, temporal reasoning, knowledge updates, abstention | arXiv 2410.10813 |
| **LOCOMO** | 1,540 questions across multi-session dialogues | Single-hop, multi-hop, open-domain, temporal recall, event summarization | snap-research.github.io/locomo |

Caveat: with million-token windows, a "stuff everything into context" baseline scores competitively on most LongMemEval and LOCOMO instances. New memory systems in 2026 lead with token-cost and latency reductions (95.5% input-token cut for ENGRAM-R, 10–40% latency cut for LiCoMemory) rather than raw accuracy.

---

## Gap → concept mapping

| Textrawl gap | Concept to adopt | Where it goes |
|---|---|---|
| No UPDATE/DELETE for facts | Mem0 ADD/UPDATE/DELETE/NOOP pipeline | `src/services/memory-extraction.ts` |
| No invalidation lineage / no as-of audit semantics | Zep/Graphiti bi-temporal lineage | additive migration on `memory_observations` |
| No rerank after RRF | Cross-encoder rerank | new step after `memory_hybrid_search` |
| No consolidation | Anthropic "Dreaming" / GraphRAG community summaries | new cron mirroring `runInsightScan` |
| Conversations don't feed memory | Mem0 extraction over saved turns | new hook in `src/tools/conversation.ts:save_conversation_context` |
| Untyped relations | MAGMA `kind` column (`semantic`/`temporal`/`causal`/`entity`) | additive migration on `memory_relations` |
| No multi-hop traversal/ranking at query time | HippoRAG PPR / LiCoMemory tier-2 | `memory_hybrid_search` follow-up query |
| No interop with vendor memory | Anthropic `memory_20250818` backend, Codex export shape | new MCP tool in `src/tools/memory.ts` |
| No procedural memory | CoALA + Reflexion | new tiny `procedural_skills` table |
| No provenance in results | ChatGPT "memory sources" pattern | `sources[]` field on `query_memory` output |

---

## Recommended adoption path

Provider-agnostic — each recommendation lists the equivalent component for the OpenAI, Google AI, and Ollama stacks.

### Tier 1 — high impact, low effort, no schema change

**a. Mem0-style write pipeline in `src/services/memory-extraction.ts`.**
Replace the 0.95-cosine dedup with a single LLM call that returns a JSON list of `{action, target_id?, content}` operations. Execute inside a transaction. LLM choice:

- OpenAI stack → `gpt-4.1-mini` or `gpt-5-mini`
- Google AI stack → `gemini-2.5-flash`
- Ollama → `llama3.1:8b-instruct` or `qwen2.5:7b-instruct`

Schema unchanged. The existing `memory_observations` table gains real mutation semantics for the first time.

**Prerequisite for provider-agnostic delivery:** today `memory-extraction.ts` is Anthropic-specific. Before claiming full provider agnosticism for extraction, add a provider adapter (parallel to `embeddings.ts`) so the Mem0 pipeline can run on OpenAI / Google / Ollama without forking tool behavior.

**b. Cross-encoder rerank after `memory_hybrid_search`.**
The function in `scripts/setup-db-memory.sql` already returns top-N candidates; rerank in the application layer before returning to the tool caller. Rerank options:

- OpenAI stack → Cohere Rerank v3 or Voyage `rerank-2`
- Google AI stack → Vertex AI Ranking API
- Ollama / self-hosted → `bge-reranker-v2-m3` via Ollama or local Transformers

Expected lift: same precision improvement seen in HiFi-RAG and Google's "sufficient context" work, with no index change.

**c. Consolidation cron mirroring Anthropic's "Dreaming."**
Reuse the `runInsightScan` job pattern in `src/services/insight-analysis.ts`. Iterate memory clusters (top-K nearest entities), have an LLM produce a consolidated observation, write it back, and link the sources via `memory_relations`. Run nightly; configurable cadence per the existing insight scheduler.

### Tier 2 — medium effort, new capabilities

**d. Bi-temporal observations (Zep pattern).**
Additive migration on top of existing temporal fields: keep `valid_from`, evolve `valid_until` semantics (or alias to `valid_to`), and add `invalidated_by` for replacement lineage. UPDATE in the Mem0 pipeline becomes "set old row closed (`valid_until/valid_to`), set `invalidated_by = new_observation_id`, insert the replacement row." Add optional `as_of` query semantics to `memory_hybrid_search` (default: current time). Backward-compatible.

**e. Conversations → memory pipeline.**
Hook `src/tools/conversation.ts:save_conversation_context` to enqueue a memory-extraction job over the new turns. Add `source_turn_id` (nullable FK) to `memory_observations` for provenance. Closes the loop between the two parallel memory systems Textrawl already has.

**f. CoALA episodic / semantic / procedural framing.**
Add `observation_kind` enum (`episodic` / `semantic` / `procedural`) to `memory_observations`. Add a small `procedural_skills` table for executable or templated skills. The Mem0 extractor sets the kind during write.

**g. MCP-exposed Claude memory tool backend.**
New file `src/tools/claude-memory.ts` registering an MCP tool that implements the six `memory_20250818` operations against the memory graph:

- `view /memories` → list entities
- `view /memories/{name}.md` → render entity + observations as Markdown
- `create` / `str_replace` / `insert` → write observations attached to the entity named by the file path
- `delete` / `rename` → entity-level operations

Path-traversal protection per Anthropic's guidance (paths must start with `/memories`, resolve canonical, reject `../`). The reward: Textrawl becomes a drop-in memory backend for any Anthropic-stack agent — Claude Code, Managed Agents, custom SDK clients — without those clients needing to learn Textrawl's existing tool schema.

### Tier 3 — higher effort, deferred

**h. HippoRAG-style PPR over `memory_relations`.** SQL recursive CTE or `pgrouting`. Useful once users have >100 entities and multi-hop questions become common.

**i. MAGMA-style multi-graph.** Add `kind` to `memory_relations`. Extend the Mem0 extractor to emit causal/temporal edges. Implement policy-guided traversal in the query layer.

**j. GraphRAG-lite community summaries.** A `memory_communities` table populated by the consolidation cron. Retrieved alongside observations when the query is broad.

**k. A-MEM link evolution.** Extend the Mem0 pipeline to re-evaluate neighbor links after every write. Cheap per-call, but the LLM-call volume scales with memory size, so gate on a "links last updated" timestamp.

---

## Provider-agnostic implementation notes

**Embeddings.** Textrawl already abstracts these in `src/services/embeddings.ts` across OpenAI (1536d), Google AI (1536d), Ollama (1024d), and Ollama v2 (768d). The `scripts/setup-db-memory*.sql` variants match. None of the recommendations above change embedding dimensions; all are additive on top of the existing vector column.

**Extraction LLM.** Every recommendation that needs an LLM (Mem0 pipeline, consolidation cron, A-MEM link revision) should respect a `MEMORY_LLM` env var resolved by a dedicated extraction provider abstraction. Defaults: GPT-4.1-mini (OpenAI), Gemini 2.5 Flash (Google), Llama 3.1 8B Instruct (Ollama). Keep cost-sensitive — these are background jobs that fire on every memory write.

**Reranker.** New provider abstraction `src/services/rerank.ts`. Cohere/Voyage for hosted OpenAI users, Vertex AI Ranking for Google, BGE-reranker-v2-m3 for Ollama / self-hosted. The same interface ships in all three.

**MCP tool schemas stay backward-compatible.** All Tier 1–2 changes either add new tools (`claude-memory.ts`) or add optional parameters to existing ones (`as_of`, `observation_kind`, `sources`). No breaking changes to `remember_fact`, `extract_memories`, `build_knowledge`, or `query_memory`.

**Observability.** The Mem0 pipeline's most useful debug signal is the LLM's ADD/UPDATE/DELETE/NOOP decision log. Persist it alongside the operation (`memory_observations.write_decision JSONB`) — same pattern Anthropic recommends for the memory tool's audit trail.

**Consolidation execution model.** Start with a scheduled batch job (nightly/cron, configurable cadence) before introducing lazy low-usage triggering. Batch-first gives predictable cost envelopes, better observability, and simpler rollback; lazy mode can be layered in after write/query correctness stabilizes.

---

## Additional roadmap additions (personal-history quality)

### 1) Semantic entity resolution ("identity layer")

Personal data contains aliases and role-based references ("Textrawl", "the MCP thing", "that project"). Add an entity-linking step during extraction that maps variant mentions to a stable entity ID and records aliases in metadata. This improves recall consistency across documents, conversations, and memory writes without forcing canonical naming in user text.

### 2) Contextual weighting and decay

Personal memory should favor recent, frequently reinforced facts unless the user asks for historical state. Add recency/frequency weighting at retrieval time (and optional decay) with explicit override controls (`historical=true`, `as_of=...`). This reduces stale-memory dominance while preserving auditability and timeline-style queries.

---

## Priority recommendations

### High priority (high value, low effort)

1. **Mem0-style write pipeline** in `src/services/memory-extraction.ts`. No schema change. Unblocks every subsequent recommendation.
2. **Cross-encoder rerank** after `memory_hybrid_search`. Same precision lift HiFi-RAG and Google's sufficient-context research demonstrated.
3. **Anthropic memory tool MCP backend** in a new `src/tools/claude-memory.ts`. Makes Textrawl a first-class durable memory for any Anthropic agent.

### Medium priority (medium effort, high impact)

1. **Consolidation cron** mirroring Anthropic's "Dreaming" — reuse the `runInsightScan` pattern.
2. **Bi-temporal observations** (additive Zep migration).
3. **Conversations → memory pipeline** with `source_turn_id` provenance.
4. **CoALA observation kinds** and a small `procedural_skills` table.

### Monitor / future consideration

1. **HippoRAG PPR** over `memory_relations` once multi-hop queries become common.
2. **MAGMA multi-graph** with typed relations and policy-guided traversal.
3. **GraphRAG-lite community summaries** at the cluster level.
4. **A-MEM link evolution** in the write pipeline.

---

## Sources

### Vendor memory APIs

- [Claude memory tool — Anthropic API docs](https://platform.claude.com/docs/en/agents-and-tools/tool-use/memory-tool)
- [Effective context engineering for AI agents (Anthropic)](https://www.anthropic.com/engineering/effective-context-engineering-for-ai-agents)
- [Anthropic adds persistent memory to Claude Managed Agents (April 2026)](https://www.edtechinnovationhub.com/news/anthropic-brings-persistent-memory-to-claude-managed-agents-in-public-beta)
- [Claude "Dreaming" / Auto-Dream](https://claudefa.st/blog/guide/mechanics/auto-dream)
- [Codex Memories — OpenAI Developers](https://developers.openai.com/codex/memories)
- [Codex Chronicle — OpenAI Developers](https://developers.openai.com/codex/memories/chronicle)
- [Memory and new controls for ChatGPT (OpenAI)](https://openai.com/index/memory-and-new-controls-for-chatgpt/)
- [Gemini personalization and Personal Context (Google blog)](https://blog.google/products/gemini/temporary-chats-privacy-controls/)

### Research papers and OSS

- [Mem0 docs](https://docs.mem0.ai/) · [Mem0 on GitHub](https://github.com/mem0ai/mem0)
- [Zep / Graphiti — arXiv 2501.13956](https://arxiv.org/abs/2501.13956) · [Graphiti on GitHub](https://github.com/getzep/graphiti)
- [MAGMA — arXiv 2601.03236](https://arxiv.org/html/2601.03236v1)
- [HippoRAG — arXiv 2405.14831](https://arxiv.org/abs/2405.14831)
- [GraphRAG — arXiv 2404.16130](https://arxiv.org/abs/2404.16130)
- [Letta on GitHub](https://github.com/letta-ai/letta)
- [A-MEM on GitHub](https://github.com/agiresearch/A-mem)
- [CoALA — arXiv 2309.02427](https://arxiv.org/abs/2309.02427)
- [Reflexion — arXiv 2303.11366](https://arxiv.org/abs/2303.11366)
- [Voyager — arXiv 2305.16291](https://arxiv.org/abs/2305.16291)
- [MemGPT — arXiv 2310.08560](https://arxiv.org/abs/2310.08560)

### Benchmarks

- [LongMemEval — arXiv 2410.10813](https://arxiv.org/abs/2410.10813)
- [LOCOMO](https://snap-research.github.io/locomo/)

### 2026 ecosystem context

- [State of AI Agent Memory 2026 (Mem0)](https://mem0.ai/blog/state-of-ai-agent-memory-2026)
- [Agent Memory Benchmark: A Manifesto (Hindsight)](https://hindsight.vectorize.io/blog/2026/03/23/agent-memory-benchmark)
- [AI Agent Memory 2026 — Comparing Mem0, Zep, Graphiti, Letta, LangMem](https://medium.com/@wasowski.jarek/i-compared-5-ai-agent-memory-systems-across-6-dimensions-none-wins-6a658335ed0a)
