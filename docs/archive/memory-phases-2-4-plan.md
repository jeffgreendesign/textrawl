---
title: Memory Phases 2-4 Implementation Plan
description: Implementation plan for conversation memory, automatic extraction, and memory-aware search
---

# Memory System Phases 2-4 Implementation Plan

**Date:** January 25, 2026
**Status:** ✅ IMPLEMENTATION COMPLETE (all phases shipped)

## Overview

This document details the implementation plan for extending Textrawl's persistent memory system with conversation memory (Phase 2), automatic memory formation (Phase 3), and memory-aware search (Phase 4).

> **Note:** All phases have been implemented. The actual implementation may differ slightly from the original plan below. See [AGENTS.md](/AGENTS.md) for current tool schemas and [CLAUDE.md](/CLAUDE.md) for configuration.

## Phase 2: Conversation Memory

### Objective
Enable persistence of conversation context across sessions, allowing Claude to recall past conversations and maintain continuity.

### Database Schema

```sql
-- Conversation sessions
CREATE TABLE conversation_sessions (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  session_key TEXT UNIQUE,           -- Optional external identifier
  title TEXT,                        -- Auto-generated or user-provided title
  summary TEXT,                      -- Rolling summary of conversation
  summary_embedding VECTOR(1536),    -- For semantic search
  metadata JSONB DEFAULT '{}',
  turn_count INTEGER DEFAULT 0,
  last_activity TIMESTAMPTZ DEFAULT NOW(),
  created_at TIMESTAMPTZ DEFAULT NOW()
);

-- Conversation turns
CREATE TABLE conversation_turns (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  session_id UUID REFERENCES conversation_sessions(id) ON DELETE CASCADE,
  role TEXT NOT NULL CHECK (role IN ('user', 'assistant')),
  content TEXT NOT NULL,
  embedding VECTOR(1536),
  turn_index INTEGER NOT NULL,
  metadata JSONB DEFAULT '{}',
  created_at TIMESTAMPTZ DEFAULT NOW()
);
```

### MCP Tools (Implemented)

1. **save_conversation_context** - Save conversation summary and turns
   - Parameters: `summary`, `sessionKey?`, `title?`, `recentTurns?[]`, `embedTurns?`
2. **recall_conversation** - Semantic search across past conversations
   - Parameters: `query`, `limit?`, `searchMode?`, `includeTranscript?`, `maxTurnsPerConversation?`
3. **list_conversations** - List recent conversation sessions
   - Parameters: `limit?`, `offset?`
4. **get_conversation** - Get full conversation by session key or ID
   - Parameters: `sessionId?` or `sessionKey?`, `maxTurns?`
5. **delete_conversation** - Delete a conversation session
   - Parameters: `sessionId?` or `sessionKey?`, `confirm`
6. **conversation_stats** - Get conversation storage statistics

### Implementation Files

- `scripts/setup-db-conversation.sql` - Schema for OpenAI
- `scripts/setup-db-conversation-ollama.sql` - Schema for Ollama (1024d)
- `scripts/setup-db-conversation-ollama-v2.sql` - Schema for Ollama v2 (768d)
- `src/db/conversation-sessions.ts` - Session CRUD
- `src/db/conversation-turns.ts` - Turn CRUD
- `src/db/conversation-search.ts` - Semantic search
- `src/tools/conversation.ts` - MCP tools

---

## Phase 3: Automatic Memory Formation

### Objective
Automatically extract entities, facts, and relationships from notes and conversations using LLM.

### Architecture

```
Text Input → Extraction Service → Deduplication → Memory Storage
                  ↓
           LLM (Claude API)
```

### LLM Extraction Prompt

```typescript
const EXTRACTION_PROMPT = `
Analyze this text and extract structured memory data.

Extract:
1. Named entities (people, organizations, projects, concepts, locations)
2. Atomic facts about each entity
3. Relationships between entities
4. User preferences or recurring patterns

Return JSON:
{
  "entities": [
    {
      "name": "string",
      "type": "person|concept|project|preference|fact|location|organization",
      "observations": ["atomic fact 1", "atomic fact 2"]
    }
  ],
  "relations": [
    {
      "from": "entity name",
      "relation": "works_at|knows|prefers|created|part_of|related_to",
      "to": "entity name"
    }
  ]
}

Rules:
- Only extract explicitly stated facts, not inferences
- Each observation should be a single, atomic fact
- Use lowercase for entity names unless proper nouns
- Confidence: only include facts you're highly confident about
`;
```

### Configuration

```bash
# Memory extraction
ENABLE_MEMORY_EXTRACTION=true
EXTRACTION_MODEL=claude-3-haiku-20240307  # Fast, cheap extraction
EXTRACTION_MAX_TOKENS=1000
```

### Enhanced add_note Tool

```typescript
server.tool('add_note', {
  title: z.string(),
  content: z.string(),
  tags: z.array(z.string()).optional(),
  extractMemories: z.boolean().default(false),  // NEW
}, async ({ title, content, tags, extractMemories }) => {
  // ... existing logic ...

  if (extractMemories && config.ENABLE_MEMORY_EXTRACTION) {
    const extracted = await extractMemoriesFromText(content);
    await storeExtractedMemories(extracted);
  }
});
```

### New MCP Tool

1. **extract_memories** - Manually trigger extraction from text
   - Parameters: `text`, `source?`
   - Returns extracted entities, facts, relations

### Implementation Files

- `src/services/memory-extraction.ts` - LLM extraction logic
- `src/tools/note.ts` - Enhanced with extractMemories
- `src/tools/memory.ts` - New extract_memories tool

---

## Phase 4: Memory-Aware Search

### Objective
Fuse document search and memory search results for comprehensive context retrieval.

### New MCP Tool

**search_with_context** - Combined document + memory search

```typescript
server.tool('search_with_context', {
  query: z.string(),
  limit: z.number().default(10),
  includeDocuments: z.boolean().default(true),
  includeMemories: z.boolean().default(true),
  includeConversations: z.boolean().default(false),
  memoryWeight: z.number().min(0).max(2).default(1.0),
  documentWeight: z.number().min(0).max(2).default(1.0),
  conversationWeight: z.number().min(0).max(2).default(0.5),
}, async (params) => {
  const results = [];

  if (params.includeDocuments) {
    const docs = await hybridSearch(query, embedding, { limit });
    results.push(...docs.map(d => ({ type: 'document', ...d })));
  }

  if (params.includeMemories) {
    const memories = await hybridMemorySearch(query, embedding, { limit });
    results.push(...memories.map(m => ({ type: 'memory', ...m })));
  }

  if (params.includeConversations) {
    const convos = await searchConversations(query, embedding, { limit });
    results.push(...convos.map(c => ({ type: 'conversation', ...c })));
  }

  // Fuse with weighted RRF
  return fuseResults(results, params);
});
```

### Implementation Files

- `src/db/search.ts` - Hybrid search with multi-source fusion
- `src/db/conversation-search.ts` - Conversation-specific search
- `src/db/memory-search.ts` - Memory-specific search
- `src/tools/search.ts` - Enhanced with search_with_context

---

## Implementation Order

1. **Phase 2A:** Database schema for conversations
2. **Phase 2B:** Conversation CRUD functions
3. **Phase 2C:** Conversation MCP tools
4. **Phase 3A:** Memory extraction service
5. **Phase 3B:** Enhanced add_note + extract_memories tool
6. **Phase 4:** Unified search with context

---

## Configuration Summary

New environment variables:

```bash
# Conversation memory (Phase 2)
ENABLE_CONVERSATIONS=true

# Memory extraction (Phase 3)
ENABLE_MEMORY_EXTRACTION=true
ANTHROPIC_API_KEY=sk-ant-...  # For extraction LLM calls
EXTRACTION_MODEL=claude-3-haiku-20240307

# Search fusion (Phase 4) - uses existing weights
# (no new config needed, weights are per-query)
```

---

## Testing Plan

1. **Phase 2:** Use MCP Inspector to test conversation tools
   - Create session, add turns, search, retrieve
2. **Phase 3:** Test extraction with sample notes
   - Verify entity/fact extraction accuracy
   - Check deduplication against existing memories
3. **Phase 4:** Test unified search
   - Verify results from all sources
   - Test weight parameters

---

## Rollback Plan

Each phase is independently deployable:
- Phase 2: New tables, new tools (no breaking changes)
- Phase 3: New service, optional parameter (backward compatible)
- Phase 4: New tool (additive only)

Feature flags allow gradual rollout:
- `ENABLE_CONVERSATIONS=false` disables Phase 2
- `ENABLE_MEMORY_EXTRACTION=false` disables Phase 3
- Phase 4 is always available (uses existing search)
