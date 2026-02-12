# Textrawl Improvement Tracker

## Status Key

- [ ] Not started
- [~] In progress
- [x] Complete

## PR 1: Migrate to `registerTool()` API

- [x] Audit all `server.tool()` calls across codebase
- [x] Migrate each to `server.registerTool()` with `title` and `description` fields
- [x] Add explicit `title` metadata to every tool (user-facing display name)
- [ ] Verify all tools still pass manual testing via MCP Inspector
- [x] Commit and open PR

## PR 2: Merge memory write tools into `build_knowledge`

- [x] Create new combined tool `build_knowledge` in `src/tools/memory.ts`
- [x] Accept `facts` array (each: entityName, entityType, observation, source?)
- [x] Accept `relations` array (each: fromEntity, fromEntityType?, relation, toEntity, toEntityType?)
- [x] Process all facts first, then all relations in a single handler
- [x] Fix the bug where `relate_entities` rejects optional entityType as null (make truly optional)
- [x] Update tool descriptions to guide agents toward `build_knowledge`
- [x] Update all 8 documentation files
- [ ] Test: single call creating 5 entities + 3 relations
- [~] Commit and open PR

## PR 3: Consolidate read/query tools to reduce tool count

- [ ] Merge `search_knowledge` + `search_with_context` into `search`
- [ ] Merge `list_entities` + `get_entity_context` + `recall_memories` into `query_memory`
- [ ] Merge stats tools into `get_stats` with `scope` param
- [ ] Merge `list_conversations` + `recall_conversation` + `get_conversation` into `query_conversations`
- [ ] Remove `insight_stats` (moved into `get_stats`)
- [ ] Update `src/server.ts` registration
- [ ] Clean break: remove old tool names entirely
- [ ] Target: reduce from ~26 tools to ~16
- [ ] Update all documentation files
- [ ] Commit and open PR

## PR 4: Add `outputSchema` to search and retrieval tools

- [ ] Add `outputSchema` + `structuredContent` to `search`
- [ ] Add to `query_memory`
- [ ] Add to `get_document`, `list_documents`
- [ ] Add to `query_conversations`
- [ ] Add to `get_stats`
- [ ] Test with MCP Inspector that both structured and unstructured content are returned
- [ ] Commit and open PR

## PR 5: Redis-backed rate limiting (optional)

- [ ] Add `REDIS_URL` to config/env schema
- [ ] Add rate limiter store swap: use Redis if `REDIS_URL` is set, else fall back to in-memory
- [ ] Update `.env.example` and `CLAUDE.md`
- [ ] Commit and open PR
