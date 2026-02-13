# Textrawl Improvement Tracker

## Status Key

- [ ] Not started
- [~] In progress
- [x] Complete

## PR 1: Migrate to `registerTool()` API

- [x] Audit all `server.tool()` calls across codebase
- [x] Migrate each to `server.registerTool()` with `title` and `description` fields
- [x] Add explicit `title` metadata to every tool (user-facing display name)
- [x] Verify all tools still pass manual testing via MCP Inspector
- [x] Commit and open PR

## PR 2: Merge memory write tools into `build_knowledge`

- [x] Create new combined tool `build_knowledge` in `src/tools/memory.ts`
- [x] Accept `facts` array (each: entityName, entityType, observation, source?)
- [x] Accept `relations` array (each: fromEntity, fromEntityType?, relation, toEntity, toEntityType?)
- [x] Process all facts first, then all relations in a single handler
- [x] Fix the bug where `relate_entities` rejects optional entityType as null (make truly optional)
- [x] Update tool descriptions to guide agents toward `build_knowledge`
- [x] Update all 8 documentation files
- [x] Test: single call creating 5 entities + 3 relations
- [x] Commit and open PR

## PR 3: Consolidate read/query tools to reduce tool count

- [x] Merge `search_knowledge` + `search_with_context` into `search`
- [x] Merge `list_entities` + `get_entity_context` + `recall_memories` into `query_memory`
- [x] Merge stats tools into `get_stats` with `scope` param
- [x] Merge `list_conversations` + `recall_conversation` + `get_conversation` into `query_conversations`
- [x] Remove `insight_stats` (moved into `get_stats`)
- [x] Update `src/server.ts` registration
- [x] Clean break: remove old tool names entirely
- [x] Target: reduce from 26 tools to 18
- [x] Update all documentation files
- [x] Document migration mapping for breaking changes:

| Deprecated Tool | Replacement | Parameters |
|----------------|-------------|------------|
| `search_knowledge` | `search` | Same params |
| `search_with_context` | `search` | `includeMemories`/`includeConversations` |
| `recall_memories` | `query_memory` | `mode="search"` |
| `get_entity_context` | `query_memory` | `mode="entity"` |
| `list_entities` | `query_memory` | `mode="list"` |
| `recall_conversation` | `query_conversations` | `mode="search"` |
| `get_conversation` | `query_conversations` | `mode="get"` |
| `list_conversations` | `query_conversations` | `mode="list"` |
| `knowledge_stats` | `get_stats` | `scope="knowledge"` |
| `memory_stats` | `get_stats` | `scope="memory"` |
| `conversation_stats` | `get_stats` | `scope="conversations"` |
| `insight_stats` | `get_stats` | `scope="insights"` |

  **Versioning:** This is a clean break in v0.2.0. Per semver, breaking changes are
  expected during `0.x` development. No version headers or feature flags are required —
  the old tool names are simply removed and replaced by the consolidated tools above.

  **Deprecation timeline:** Old tool names were removed immediately in v0.2.0 with no
  coexistence window. The project is pre-1.0, single-tenant, and self-hosted, so a
  gradual sunset cycle is unnecessary. Clients should update to the new tool names now.

  **Transition support:** If a client depends on old tool names, register thin aliases
  that forward to the new tools. Example adapter for `search_with_context`:

  ```typescript
  server.registerTool('search_with_context', {
    title: 'Search with Context (deprecated)',
    description: 'DEPRECATED: Use search with includeMemories/includeConversations instead.',
    inputSchema: { query: z.string(), /* ... */ },
  }, async (params) => {
    return searchHandler({ ...params, includeMemories: true, includeConversations: true });
  });
  ```

  The same pattern applies to all deprecated tools — map old parameters to the new
  `mode` or `scope` parameters on the consolidated tool. `AGENTS.md` and `llms.txt`
  already document the new tool names for agent discovery.

  **Rollback:** To revert, check out the commit before consolidation (`git log --oneline`
  to find it) or pin to the previous release tag. Old tool registrations are preserved in
  git history and can be restored by re-adding the individual `registerTool()` calls from
  the pre-consolidation source files.

- [x] Commit and open PR

## PR 4: Add `outputSchema` to search and retrieval tools

- [x] Add `outputSchema` + `structuredContent` to `search`
- [x] Add to `query_memory`
- [x] Add to `get_document`, `list_documents`
- [x] Add to `query_conversations`
- [x] Add to `get_stats`
- [x] Update all documentation files (CLAUDE.md, README.md, AGENTS.md, llms.txt, llms-full.txt, .well-known/mcp.json, docs/mcp-tools/*.mdx)
- [x] Test with MCP Inspector that both structured and unstructured content are returned
- [x] Commit and open PR

## PR 5: Redis-backed rate limiting (optional)

- [x] Add `REDIS_URL` to config/env schema
- [x] Add rate limiter store swap: use Redis if `REDIS_URL` is set, else fall back to in-memory
- [x] Update `.env.example` and `CLAUDE.md`
- [x] Commit and open PR
