# PR 3: Consolidate Tools — Continuation Prompt

## Context

You are continuing the Textrawl improvement plan. PRs 1 and 2 are complete and committed:

- **PR 1** (`refactor/register-tool-migration`): Migrated all 26 tools to `registerTool()` API with `title` metadata
- **PR 2** (`feat/build-knowledge`): Added `build_knowledge` batch tool, fixed `relate_entities` null bug, per-item error handling

## What to do now

Implement **PR 3: Consolidate read/query tools** to reduce the tool count from ~26 to ~16.

### Key files to read first

1. `docs/IMPROVEMENT_TRACKER.md` — checklist for PR 3
2. `.claude/plans/jazzy-hatching-locket.md` — full plan with merge table and file list
3. `CLAUDE.md` — project conventions, doc sync rules (8 files must be updated)
4. `docs/archive/textrawl-improvements-prompt.md` — original improvement plan

### Merge plan (clean break — no deprecated aliases)

| New Tool | Replaces | Dispatch |
|----------|----------|----------|
| `search` | `search_knowledge` + `search_with_context` | `includeMemories` / `includeConversations` boolean flags (default false) |
| `query_memory` | `recall_memories` + `get_entity_context` + `list_entities` | `mode: 'search' \| 'entity' \| 'list'` |
| `get_stats` | `knowledge_stats` + `memory_stats` + `conversation_stats` + `insight_stats` | `scope: 'all' \| 'knowledge' \| 'memory' \| 'conversations' \| 'insights'` |
| `query_conversations` | `recall_conversation` + `get_conversation` + `list_conversations` | `mode: 'search' \| 'get' \| 'list'` |

### Unchanged tools (14)

`get_document`, `list_documents`, `update_document`, `add_note`, `remember_fact`, `build_knowledge`, `relate_entities`, `forget_entity`, `extract_memories`, `save_conversation_context`, `delete_conversation`, `get_insights`, `discover_connections`, `dismiss_insight`

### Implementation order

1. Create branch `refactor/consolidate-tools` from `feat/build-knowledge`
2. `stats.ts` — simplest merge (4 paramless tools → 1 with `scope`)
3. `search.ts` — merge 2 into `search`
4. `memory.ts` — add `query_memory`, remove 3 old tools
5. `conversation.ts` — add `query_conversations`, remove 3 old tools
6. `insights.ts` — remove `insight_stats` (moved into `get_stats`)
7. Update `src/server.ts` if needed
8. Update all 8 documentation files (CLAUDE.md, README.md, AGENTS.md, llms.txt, llms-full.txt, .well-known/mcp.json, docs/mcp-tools/*.mdx, docs/mcp-tools/meta.json)
9. Run `pnpm quality && pnpm docs:build`

### Critical notes

- **Clean break**: Old tool names are removed entirely, not kept as aliases
- **Doc sync**: When modifying tools, all 8 doc files must be updated (see CLAUDE.md "Documentation Sync Rules")
- **Pause before committing**: User runs CodeRabbit on changes before commit
- **No co-author trailers** in commit messages
- **Target**: ~16 tools total (14 unchanged + 4 new merged = 18, minus `insight_stats` removed = ~17-18 depending on final count)
- Extract handler logic into service functions where not already done, then create new tool registrations that dispatch based on params
