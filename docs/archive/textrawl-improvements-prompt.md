# Textrawl MCP Server — Improvement Plan

**Date**: February 11, 2026
**Context**: You are working on `textrawl`, a personal knowledge base MCP server (TypeScript, Express, Supabase/pgvector, deployed on Cloud Run). The codebase uses `@modelcontextprotocol/sdk` v1.x with the `server.tool()` API pattern. Tools are registered in `src/server.ts` with implementations in `src/tools/`. Services live in `src/services/` and database logic in `src/db/`.

## Before You Start

1. **Read `CLAUDE.md`** if present, and `package.json` to confirm the current `@modelcontextprotocol/sdk` version.
2. **Run `find src/tools -name "*.ts" | head -20`** to see all tool files.
3. **Run `grep -r "server\.tool\|server\.registerTool" src/ --include="*.ts" -l`** to see which registration API is currently used.
4. **Run `grep -r "outputSchema\|structuredContent" src/ --include="*.ts" -l`** to check if any structured output is already implemented.
5. **Run `cat src/server.ts | head -80`** to understand how tools are registered and feature-flagged.
6. **Count current tools**: `grep -c "server\.tool\|server\.registerTool" src/server.ts src/tools/*.ts`
7. **Check rate limiting**: `grep -rn "rate.limit\|rateLimit" src/ --include="*.ts"` to see current implementation.

See `docs/IMPROVEMENT_TRACKER.md` for the tracking checklist. Update it after each PR is complete so you know where to pick up.

## PR 1: Migrate to `registerTool()` API

**Why**: The TypeScript SDK v1.x (current: v1.26.0 as of Feb 5, 2026) already supports `registerTool()` as the recommended API. The older `server.tool()` method works but `registerTool()` adds `title` metadata support and is the forward-compatible path for SDK v2 (expected Q1 2026 but not yet released). This is a low-risk migration that improves tool metadata for MCP clients.

**How**:

The old pattern:

~~~typescript
server.tool(
  'search_knowledge',
  { query: z.string().min(1).max(10000).describe('...'), /* ... */ },
  async ({ query, limit /* ... */ }) => { /* handler */ }
);
~~~

The new pattern:

~~~typescript
server.registerTool(
  'search_knowledge',
  {
    title: 'Search Knowledge Base',
    description: 'Search the knowledge base using hybrid semantic + full-text search',
    inputSchema: {
      query: z.string().min(1).max(10000).describe('Natural language search query'),
      // ... rest of params
    },
  },
  async ({ query, limit /* ... */ }) => { /* handler */ }
);
~~~

Migrate every tool. Add a meaningful `title` to each one (this is what MCP clients display in UIs). Keep `description` as the detailed text that LLMs read for tool selection.

**Important**: Check the SDK docs at `node_modules/@modelcontextprotocol/sdk/dist/server/mcp.d.ts` to confirm the exact `registerTool` signature, as it may differ slightly from examples. The TypeScript types are authoritative.

After migrating, `grep -r "server\.tool(" src/` should return zero results (only `server.registerTool(`).

---

## PR 2: Merge Memory Write Tools into `build_knowledge`

**Why**: The current API requires agents to make N separate calls to build an entity graph — one `remember_fact` per entity, one `relate_entities` per relation. This is exactly the anti-pattern Philipp Schmid calls out in his MCP best practices post (philschmid.de, Jan 2026): "Design tools around what the user/agent wants to achieve." A single `build_knowledge` tool reduces round-trips from O(entities + relations) to O(1).

**Design**:

~~~typescript
server.registerTool('build_knowledge', {
  title: 'Build Knowledge Graph',
  description: 'Create multiple entities with facts and relations in a single call. Use this instead of calling remember_fact and relate_entities separately. Processes all facts first, then creates relations between entities.',
  inputSchema: {
    facts: z.array(z.object({
      entityName: z.string().min(1).max(200),
      entityType: z.enum(['person', 'concept', 'project', 'preference', 'fact', 'location', 'organization']),
      observation: z.string().min(1).max(2000),
      source: z.enum(['conversation', 'note', 'document', 'manual']).default('conversation'),
      validUntil: z.string().optional(),
    })).min(1).describe('Array of entity facts to store'),
    relations: z.array(z.object({
      fromEntity: z.string().min(1).max(200),
      fromEntityType: z.enum(['person', 'concept', 'project', 'preference', 'fact', 'location', 'organization']).optional(),
      relation: z.string().min(1).max(100),
      toEntity: z.string().min(1).max(200),
      toEntityType: z.enum(['person', 'concept', 'project', 'preference', 'fact', 'location', 'organization']).optional(),
    })).optional().default([]).describe('Array of relations between entities'),
  },
}, async ({ facts, relations }) => {
  // 1. Process all facts (creates entities if needed)
  // 2. Process all relations
  // 3. Return summary of what was created
});
~~~

**Bug fix**: The current `relate_entities` tool rejects `null` for optional `fromEntityType`/`toEntityType` params. The Zod schema likely uses `.optional()` but the MCP client sends explicit `null`. Fix by adding `.nullable()` to those fields: `z.enum([...]).optional().nullable()`.

**Backward compat**: Keep `remember_fact` and `relate_entities` registered but update their descriptions to say "Prefer build_knowledge for batch operations." Have them call the same internal service functions.

---

## PR 3: Consolidate Read/Query Tools

**Why**: With ~24 tools, the tool descriptions alone consume significant LLM context tokens. Every tool description gets injected into the system prompt when an MCP client connects. Reducing to ~15 tools saves context and reduces agent decision fatigue.

**Merge candidates** (evaluate each — some may not make sense once you see the current code):

| Current Tools | Proposed Merge | Notes |
|---|---|---|
| `search_knowledge`, `search_with_context` | `search` | One tool with `includeDocuments`, `includeMemories`, `includeConversations` booleans |
| `list_entities`, `get_entity_context`, `recall_memories` | `query_memory` | Mode param: `list`, `entity`, `search` |
| `knowledge_stats`, `memory_stats`, `conversation_stats`, `insight_stats` | `get_stats` | `scope` param: `all`, `knowledge`, `memory`, `conversations`, `insights` |
| `list_conversations`, `recall_conversation`, `get_conversation` | `query_conversations` | Mode param: `list`, `search`, `get` |
| `get_insights`, `discover_connections`, `dismiss_insight`, `insight_stats` | Evaluate — insights may be fine as-is | These are distinct enough actions |

**Do NOT merge** tools with fundamentally different write semantics (e.g., `add_note` should stay separate from `remember_fact`/`build_knowledge`).

**Approach**: Extract the handler logic into service functions if not already, then create new tool registrations that dispatch to the right service based on params. Preserve old tool names as deprecated aliases if possible.

---

## PR 4: Add `outputSchema` to Search & Retrieval Tools

**Why**: The MCP spec (2025-06-18 revision) introduced `outputSchema` and `structuredContent` for typed, validated tool outputs. This lets clients parse results programmatically instead of extracting data from free-text. Supported in `@modelcontextprotocol/sdk` v1.x.

**Implementation pattern**:

~~~typescript
server.registerTool('search', {
  title: 'Search Knowledge Base',
  description: '...',
  inputSchema: { /* ... */ },
  outputSchema: {
    type: 'object',
    properties: {
      results: {
        type: 'array',
        items: {
          type: 'object',
          properties: {
            id: { type: 'string' },
            title: { type: 'string' },
            content: { type: 'string' },
            score: { type: 'number' },
            sourceType: { type: 'string' },
          },
          required: ['id', 'title', 'content', 'score'],
        },
      },
      total: { type: 'integer' },
    },
    required: ['results', 'total'],
  },
}, async (params) => {
  const results = await searchService.search(params);
  const structured = { results, total: results.length };
  return {
    content: [{ type: 'text', text: JSON.stringify(structured, null, 2) }],
    structuredContent: structured,
  };
});
~~~

**Note**: The `outputSchema` must be plain JSON Schema (not Zod). You can use `zodToJsonSchema()` from the `zod-to-json-schema` package if you want to define it in Zod and convert, or just write the JSON Schema directly.

**Important**: Always return both `content` (text) AND `structuredContent` for backward compatibility with clients that don't support structured output yet.

Start with the highest-impact tools: `search_knowledge`/`search`, `recall_memories`/`query_memory`, `get_document`, `list_documents`.

---

## PR 5: Redis-backed Rate Limiting

**Why**: `express-rate-limit` with the default in-memory store tracks counts per-process. On Cloud Run with multiple instances, each instance has its own counter, so a user hitting different instances gets N× the intended rate limit.

**Only implement if**: the Cloud Run service is configured for `--max-instances > 1` or auto-scaling is enabled. Check `cloudbuild.yaml`, `Dockerfile`, or any Cloud Run config in the repo.

**Implementation**:

~~~bash
npm install @express-rate-limit/redis ioredis
~~~

~~~typescript
import RedisStore from '@express-rate-limit/redis';
import Redis from 'ioredis';

const store = config.REDIS_URL
  ? new RedisStore({ sendCommand: (...args) => new Redis(config.REDIS_URL).call(...args) })
  : undefined; // falls back to in-memory

const limiter = rateLimit({
  store,
  windowMs: 60 * 1000,
  max: 100,
});
~~~

Add `REDIS_URL` as an optional env var in your config schema. Document that it's only needed for multi-instance deployments.

---

## General Guidelines

- **Run tests after each PR**: `npm test` or whatever the test command is. If there are no tests for tools, at minimum verify the server starts and tools register without errors.
- **Use MCP Inspector** (`npx @modelcontextprotocol/inspector`) to smoke-test tool changes if available.
- **Commit messages**: Use conventional commits (`feat:`, `refactor:`, `fix:`).
- **Update `docs/IMPROVEMENT_TRACKER.md`** after completing each PR — check off items and note any deviations or decisions made.
- **Don't change behavior**: These PRs are refactors and API improvements. Existing functionality should not change. If you find bugs during the process (like the `relate_entities` null issue), fix them but note them separately.
- **SDK version**: Do NOT upgrade to `@modelcontextprotocol/sdk` v2 — it hasn't shipped a stable release yet (still anticipated Q1 2026 as of Feb 11, 2026). Stay on v1.x. The `registerTool()` API is already available in v1.x.
