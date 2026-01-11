---
title: Persistent Memory Analysis
description: Research and implementation analysis for persistent memory in Textrawl
---

# Persistent Memory Implementation Analysis for Textrawl

**Analysis Date:** January 5, 2026
**Status:** Research Complete - Ready for Implementation

## Executive Summary

Textrawl currently operates as a **stateless MCP server** optimized for document storage and hybrid search. While it excels at knowledge retrieval, it lacks **persistent memory** capabilities that would enable Claude to remember context across conversations. This analysis examines the current architecture gaps and recommends implementation strategies based on 2025-2026 best practices.

## Current Architecture Assessment

### What Textrawl Does Well
- ✅ Hybrid semantic + full-text search via RRF fusion
- ✅ Document chunking with overlap for context preservation
- ✅ Flexible metadata (JSONB) including tags
- ✅ Support for multiple embedding providers (OpenAI/Ollama)
- ✅ Cloud-native stateless design for serverless deployment

### What's Missing (Memory Gaps)
- ❌ **No conversation history persistence** - Each MCP request is independent
- ❌ **No entity extraction** - User preferences, facts, and context aren't structured
- ❌ **No relational memory** - No way to track relationships between concepts
- ❌ **No temporal awareness** - Cannot reason about when things happened
- ❌ **No memory retrieval tools** - Claude can search documents but not recall "memories"
- ❌ **No automatic memory formation** - Must manually add notes for persistence

## Modern Persistent Memory Approaches (2025-2026)

### 1. Knowledge Graph Memory (Official MCP Pattern)

**Reference:** [Anthropic's MCP Memory Server](https://github.com/modelcontextprotocol/servers/tree/main/src/memory)

The official MCP memory server uses a knowledge graph with:
- **Entities**: Named nodes with types (person, concept, preference)
- **Relations**: Directed connections in active voice
- **Observations**: Atomic facts attached to entities

**Pros:**
- Standardized MCP pattern
- Simple JSONL storage
- Works well for relationship-heavy data

**Cons:**
- No semantic search
- Limited scalability
- Requires explicit entity management

### 2. Hybrid Memory Architecture (Mem0 Pattern)

**Reference:** [Mem0 Research Paper](https://arxiv.org/abs/2504.19413) | [Mem0 Documentation](https://docs.mem0.ai/)

Mem0's hybrid approach combines:
- **Vector Store**: For semantic similarity search
- **Graph Database**: For relationship modeling
- **Key-Value Store**: For fast fact retrieval

**Benchmarks (2025):**
- 26% improvement over OpenAI's approach
- 91% lower p95 latency than full-context approaches
- 90%+ token cost savings

**Pros:**
- Production-proven at scale (Netflix, Rocket Money)
- Automatic memory extraction from conversations
- Semantic retrieval with graph relationships

**Cons:**
- Additional infrastructure (graph DB)
- More complex implementation

### 3. Virtual Memory Architecture (MemGPT/Letta Pattern)

**Reference:** [MemGPT Research](https://arxiv.org/abs/2310.08560) | [Letta Documentation](https://docs.letta.com/concepts/memgpt/)

MemGPT treats memory like an operating system:
- **Core Memory**: Always-in-context essential facts
- **Recall Memory**: Searchable conversation archive
- **Archival Memory**: Long-term storage with semantic search

**Key Innovation:** The LLM manages its own memory through tool calls.

**Pros:**
- LLM-driven memory management
- Handles very long conversations
- Self-improving memory organization

**Cons:**
- Requires more LLM calls (latency/cost)
- Complex state management

### 4. Hierarchical Summarization

**Reference:** [Chat History Summarization Guide](https://mem0.ai/blog/llm-chat-history-summarization-guide-2025)

Rolling summarization approach:
- Recent messages kept verbatim
- Older messages progressively summarized
- Token-efficient for long conversations

**Pros:**
- Simple to implement
- Works with existing infrastructure
- Predictable token usage

**Cons:**
- Information loss in summaries
- No structured fact extraction

## Recommended Implementation Strategy

Given Textrawl's existing PostgreSQL/Supabase infrastructure and hybrid search capabilities, I recommend a **phased approach** that builds on current strengths.

---

## Phase 1: Entity-Based Memory Layer

**Objective:** Add structured memory storage without breaking existing architecture.

### New Database Schema

```sql
-- Memory entities (people, concepts, preferences)
CREATE TABLE memory_entities (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  name TEXT NOT NULL,
  entity_type TEXT NOT NULL, -- person, concept, preference, fact
  metadata JSONB DEFAULT '{}',
  embedding VECTOR(1536), -- For semantic entity search
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW(),
  UNIQUE(name, entity_type)
);

-- Observations (atomic facts about entities)
CREATE TABLE memory_observations (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  entity_id UUID REFERENCES memory_entities(id) ON DELETE CASCADE,
  content TEXT NOT NULL,
  source TEXT, -- conversation, note, document
  confidence FLOAT DEFAULT 1.0,
  valid_from TIMESTAMPTZ DEFAULT NOW(),
  valid_until TIMESTAMPTZ, -- For temporal facts
  embedding VECTOR(1536),
  created_at TIMESTAMPTZ DEFAULT NOW()
);

-- Relations between entities
CREATE TABLE memory_relations (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  from_entity_id UUID REFERENCES memory_entities(id) ON DELETE CASCADE,
  to_entity_id UUID REFERENCES memory_entities(id) ON DELETE CASCADE,
  relation_type TEXT NOT NULL, -- works_at, prefers, knows, etc.
  metadata JSONB DEFAULT '{}',
  created_at TIMESTAMPTZ DEFAULT NOW(),
  UNIQUE(from_entity_id, to_entity_id, relation_type)
);

-- Indexes
CREATE INDEX memory_entities_embedding_idx ON memory_entities
  USING hnsw (embedding vector_cosine_ops);
CREATE INDEX memory_observations_embedding_idx ON memory_observations
  USING hnsw (embedding vector_cosine_ops);
CREATE INDEX memory_entities_type_idx ON memory_entities(entity_type);
CREATE INDEX memory_observations_entity_idx ON memory_observations(entity_id);
```

### New MCP Tools

```typescript
// Tool: remember_fact
// Stores a fact about an entity (creates entity if needed)
server.tool('remember_fact', {
  entityName: z.string().describe('Name of the entity (e.g., "Jeff", "Project Alpha")'),
  entityType: z.string().describe('Type: person, concept, project, preference, fact'),
  observation: z.string().describe('The fact to remember'),
  validUntil: z.string().optional().describe('ISO date if this fact expires'),
}, async ({ entityName, entityType, observation, validUntil }) => {
  // Create/find entity, add observation with embedding
});

// Tool: recall_memories
// Semantic search across memories
server.tool('recall_memories', {
  query: z.string().describe('What to remember about'),
  entityTypes: z.array(z.string()).optional().describe('Filter by entity types'),
  limit: z.number().default(10),
}, async ({ query, entityTypes, limit }) => {
  // Hybrid search across entities and observations
});

// Tool: relate_entities
// Create relationships between entities
server.tool('relate_entities', {
  fromEntity: z.string(),
  relation: z.string().describe('Active voice relation (e.g., "works_at", "prefers")'),
  toEntity: z.string(),
}, async ({ fromEntity, relation, toEntity }) => {
  // Create or update relation
});

// Tool: get_entity_context
// Get full context about an entity including relations
server.tool('get_entity_context', {
  entityName: z.string(),
  includeRelated: z.boolean().default(true),
}, async ({ entityName, includeRelated }) => {
  // Return entity with observations and related entities
});
```

---

## Phase 2: Conversation Memory

**Objective:** Enable persistence of conversation context across sessions.

### Schema Addition

```sql
-- Conversation sessions
CREATE TABLE conversation_sessions (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  session_key TEXT UNIQUE, -- Optional external identifier
  summary TEXT, -- Rolling summary of conversation
  summary_embedding VECTOR(1536),
  metadata JSONB DEFAULT '{}',
  last_activity TIMESTAMPTZ DEFAULT NOW(),
  created_at TIMESTAMPTZ DEFAULT NOW()
);

-- Conversation turns (for retrieval)
CREATE TABLE conversation_turns (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  session_id UUID REFERENCES conversation_sessions(id) ON DELETE CASCADE,
  role TEXT NOT NULL, -- user, assistant
  content TEXT NOT NULL,
  embedding VECTOR(1536),
  turn_index INTEGER NOT NULL,
  created_at TIMESTAMPTZ DEFAULT NOW()
);

-- Index for semantic search across conversations
CREATE INDEX conversation_turns_embedding_idx ON conversation_turns
  USING hnsw (embedding vector_cosine_ops);
```

### New MCP Tools

```typescript
// Tool: save_conversation_context
// Periodically save conversation summary
server.tool('save_conversation_context', {
  sessionKey: z.string().optional(),
  summary: z.string().describe('Summary of recent conversation'),
  keyFacts: z.array(z.string()).optional().describe('Key facts to extract as memories'),
}, async ({ sessionKey, summary, keyFacts }) => {
  // Save summary, optionally extract facts to memory_observations
});

// Tool: recall_conversation
// Find relevant past conversations
server.tool('recall_conversation', {
  query: z.string().describe('What to find in past conversations'),
  limit: z.number().default(5),
}, async ({ query, limit }) => {
  // Semantic search across conversation summaries and turns
});
```

---

## Phase 3: Automatic Memory Formation

**Objective:** Automatically extract and store memories from interactions.

### Implementation Options

#### Option A: LLM-Driven Extraction (Recommended)

Add a background process that:
1. Analyzes new notes and conversation turns
2. Uses LLM to extract entities and facts
3. Deduplicates against existing memories
4. Stores with confidence scores

```typescript
// Memory extraction prompt
const EXTRACTION_PROMPT = `
Analyze this text and extract:
1. Named entities (people, organizations, projects, concepts)
2. Facts about these entities
3. Relationships between entities
4. User preferences or recurring patterns

Return as JSON:
{
  "entities": [{ "name": "", "type": "", "observations": [""] }],
  "relations": [{ "from": "", "relation": "", "to": "" }]
}
`;
```

#### Option B: Rule-Based Extraction

Use patterns to extract:
- Names (proper nouns, @mentions)
- Preferences ("I prefer", "I like", "I always")
- Facts with temporal markers ("started in 2024", "works at")

### Integration with Existing add_note Tool

Enhance `add_note` to optionally trigger memory extraction:

```typescript
server.tool('add_note', {
  title: z.string(),
  content: z.string(),
  tags: z.array(z.string()).optional(),
  extractMemories: z.boolean().default(false), // NEW
}, async ({ title, content, tags, extractMemories }) => {
  // Existing logic...

  if (extractMemories) {
    await queueMemoryExtraction(documentId);
  }
});
```

---

## Phase 4: Memory-Aware Search

**Objective:** Integrate memory context into existing search.

### Enhanced Search Tool

```typescript
server.tool('search_with_context', {
  query: z.string(),
  includeMemories: z.boolean().default(true),
  includeDocuments: z.boolean().default(true),
  memoryWeight: z.number().default(0.3),
}, async ({ query, includeMemories, includeDocuments, memoryWeight }) => {
  const results = [];

  if (includeDocuments) {
    results.push(...await hybridSearch(query));
  }

  if (includeMemories) {
    results.push(...await memorySearch(query));
  }

  // Fuse and rank results
  return fuseResults(results, memoryWeight);
});
```

---

## Implementation Priorities

| Priority | Feature | Effort | Value |
|----------|---------|--------|-------|
| 1 | Entity memory schema + tools | Medium | High |
| 2 | `remember_fact` / `recall_memories` tools | Medium | High |
| 3 | Entity relationships | Low | Medium |
| 4 | Conversation session storage | Medium | Medium |
| 5 | Automatic memory extraction | High | High |
| 6 | Memory-aware search fusion | Medium | Medium |

---

## Alternative: Integrate Mem0

Instead of building from scratch, Textrawl could integrate with Mem0:

```typescript
import { Memory } from 'mem0ai';

const memory = new Memory({
  vector_store: {
    provider: 'supabase', // Use existing Supabase
    config: { /* existing config */ }
  }
});

// In MCP tool
server.tool('remember', {
  content: z.string(),
  userId: z.string().optional(),
}, async ({ content, userId }) => {
  await memory.add(content, { user_id: userId });
});

server.tool('recall', {
  query: z.string(),
  userId: z.string().optional(),
}, async ({ query, userId }) => {
  return await memory.search(query, { user_id: userId });
});
```

**Pros:** Production-tested, 26% better retrieval, handles deduplication
**Cons:** Additional dependency, less control over storage

---

## Security Considerations

1. **Memory Isolation**: Add user_id/tenant_id for multi-user scenarios
2. **Memory Expiration**: Implement TTL for sensitive facts
3. **Consent Tracking**: Log memory sources for GDPR compliance
4. **Access Control**: RLS policies on memory tables

---

## Implementation Status: ✅ COMPLETE

Phase 1 (Entity-Based Memory Layer) has been fully implemented.

### File Structure

```
src/
├── db/
│   ├── memory-entities.ts    # Entity CRUD ✅
│   ├── memory-observations.ts # Observation CRUD ✅
│   ├── memory-relations.ts    # Relation CRUD ✅
│   └── memory-search.ts       # Memory retrieval ✅
├── tools/
│   └── memory.ts              # Memory MCP tools ✅
scripts/
├── setup-db-memory.sql        # Memory schema (OpenAI, 1536 dim) ✅
└── setup-db-memory-ollama.sql # Memory schema (Ollama, 1024 dim) ✅
```

---

## Developer Experience (DX) Workflows

### Workflow A: OpenAI Embeddings (Cloud)

Best for: Production deployments, developers without GPU, teams wanting managed infrastructure.

```bash
# 1. Environment setup
cp .env.example .env
# Edit .env:
#   EMBEDDING_PROVIDER=openai
#   OPENAI_API_KEY=sk-...
#   SUPABASE_URL=https://xxx.supabase.co
#   SUPABASE_SERVICE_KEY=eyJ...

# 2. Database setup (run in Supabase SQL Editor)
# First: scripts/setup-db.sql
# Then:  scripts/setup-db-memory.sql

# 3. Start server
npm install
npm run dev
```

### Workflow B: Ollama Embeddings (Local)

Best for: Privacy-focused users, offline development, cost optimization, GPU-equipped machines.

```bash
# 1. Start Ollama with embedding model
ollama pull nomic-embed-text  # or mxbai-embed-large
ollama serve

# 2. Environment setup
cp .env.example .env
# Edit .env:
#   EMBEDDING_PROVIDER=ollama
#   OLLAMA_BASE_URL=http://localhost:11434
#   OLLAMA_MODEL=nomic-embed-text
#   SUPABASE_URL=https://xxx.supabase.co
#   SUPABASE_SERVICE_KEY=eyJ...

# 3. Database setup (run in Supabase SQL Editor)
# First: scripts/setup-db-ollama.sql
# Then:  scripts/setup-db-memory-ollama.sql

# 4. Start server
npm install
npm run dev
```

### Testing Memory Tools

```bash
# Start MCP Inspector to test tools interactively
npm run inspector
# Open http://localhost:5173

# Test remember_fact
# Test recall_memories
# Test relate_entities
# Test get_entity_context
```

---

## Feature Toggle (ENABLE_MEMORY)

Memory can be completely disabled per developer/deployment:

```bash
# .env
ENABLE_MEMORY=false   # Disables all memory tools
ENABLE_MEMORY=true    # Default - enables memory tools
```

When disabled:
- Memory tools (`remember_fact`, `recall_memories`, etc.) are not registered
- No embedding calls for memory operations
- No queries to memory tables
- Zero additional cost

When re-enabled:
- ⚠️ **NO automatic catch-up** - Memory only stores what's explicitly passed through `remember_fact`
- Existing memories remain intact in the database
- New facts can be added immediately

### Catch-Up Limitation

The current implementation does NOT automatically extract memories from:
- Existing documents in the knowledge base
- Past conversations
- Notes added while memory was disabled

**Why?** Automatic extraction requires LLM calls to analyze content, which would be:
- Expensive at scale
- Potentially inaccurate without human review
- A separate feature (Phase 2)

---

## Cost Analysis (2026 Pricing)

### Cloud: OpenAI Embeddings

| Component | Cost | Notes |
|-----------|------|-------|
| Embeddings | ~$0.02 / 1M tokens | text-embedding-3-small |
| Per `remember_fact` | ~$0.00001 | ~50 tokens avg |
| Per `recall_memories` | ~$0.00001 | Query embedding |
| 1,000 memories/month | ~$0.02 | Negligible |
| 100,000 memories/month | ~$2.00 | Still cheap |

### Cloud: Supabase

| Tier | Cost | Limits |
|------|------|--------|
| Free | $0 | 500MB DB, 50K rows |
| Pro | $25/month | 8GB DB, unlimited rows |
| Team | $599/month | 128GB DB, priority support |

**Recommendation:** Free tier sufficient for personal use (thousands of memories).

### Local: Ollama Embeddings

| Component | Cost | Notes |
|-----------|------|-------|
| Embeddings | **$0** | Runs locally |
| Hardware | Existing | CPU works, GPU faster |
| Electricity | ~$0.10/day | If running 24/7 |

### Total Monthly Cost Examples

| Scenario | OpenAI + Supabase Free | Ollama + Supabase Free |
|----------|------------------------|------------------------|
| Light (100 memories) | ~$0.01 | $0 |
| Moderate (10K memories) | ~$0.25 | $0 |
| Heavy (100K memories) | ~$2.50 | $0 |
| Production (1M memories) | ~$25 + $25 Supabase | $0 + $25 Supabase |

---

## Local Running Requirements

### Minimum Hardware (Ollama)

| Component | Minimum | Recommended |
|-----------|---------|-------------|
| CPU | 4 cores | 8+ cores |
| RAM | 8GB | 16GB+ |
| Storage | 10GB | 50GB+ |
| GPU | Not required | NVIDIA 8GB+ VRAM |

**Note:** `nomic-embed-text` is a small model (~270MB). Runs fine on CPU.

### Ollama Performance (Embeddings)

| Hardware | Embeddings/sec | Latency |
|----------|----------------|---------|
| M1 MacBook Air | ~50/sec | 20ms |
| Intel i7 (CPU) | ~30/sec | 35ms |
| NVIDIA RTX 3060 | ~200/sec | 5ms |
| NVIDIA RTX 4090 | ~500/sec | 2ms |

### Self-Hosted Supabase Alternative

For fully local operation, you can run PostgreSQL + pgvector:

```bash
# Docker (simplest)
docker run -d --name pgvector \
  -e POSTGRES_PASSWORD=postgres \
  -p 5432:5432 \
  pgvector/pgvector:pg16

# Then update .env
SUPABASE_URL=http://localhost:5432
# Use direct Postgres connection instead of Supabase client
```

**Note:** This requires modifying the database client code to use `pg` instead of `@supabase/supabase-js`. Not currently supported out of the box.

---

## DX Decision Matrix

| Situation | Recommended Setup |
|-----------|-------------------|
| Quick prototype | OpenAI + Supabase Free |
| Privacy-focused | Ollama + Supabase Free |
| Offline development | Ollama + local Postgres |
| Production (low volume) | OpenAI + Supabase Free |
| Production (high volume) | Ollama on GPU + Supabase Pro |
| Enterprise | Ollama on-prem + self-hosted Postgres |

---

## Future Enhancements

1. **Conversation Memory**: Persist conversation context across sessions
2. **Automatic Extraction**: LLM-based entity/fact extraction from notes
3. **Memory-Aware Search**: Fuse document and memory results
4. **Memory Decay**: Confidence degradation over time
5. **Memory Backfill**: Extract entities from existing documents when enabled

---

## References

- [Anthropic MCP Memory Server](https://github.com/modelcontextprotocol/servers/tree/main/src/memory)
- [Mem0 Documentation](https://docs.mem0.ai/)
- [Mem0 Research Paper (2025)](https://arxiv.org/abs/2504.19413)
- [MemGPT/Letta Architecture](https://docs.letta.com/concepts/memgpt/)
- [MCP Specification 2025-06-18](https://modelcontextprotocol.io/specification/2025-06-18)
- [LLM Memory Systems Comparison](https://www.marktechpost.com/2025/11/10/comparing-memory-systems-for-llm-agents-vector-graph-and-event-logs/)
- [AI Memory Benchmarks 2025](https://guptadeepak.com/the-ai-memory-wars-why-one-system-crushed-the-competition-and-its-not-openai/)
