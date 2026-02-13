# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Project Overview

Textrawl is a Personal Knowledge MCP (Model Context Protocol) Server that provides hybrid semantic + full-text search over documents. It allows Claude to search, retrieve, and add documents to a knowledge base backed by Supabase PostgreSQL with vector embeddings.

## Development Commands

**Package manager:** pnpm (v9.15+). Do not use npm.

```bash
pnpm setup          # Generate .env with secure token + enter credentials
pnpm dev            # Watch mode dev server (tsx)
pnpm build          # TypeScript compile + esbuild bundle to dist/
pnpm start          # Run production build
pnpm typecheck      # Type-check without emitting
pnpm lint           # Biome lint check
pnpm lint:fix       # Biome lint with auto-fix
pnpm lint:md        # Markdown lint check (markdownlint-cli2)
pnpm lint:md:fix    # Markdown lint with auto-fix
pnpm quality        # Lint + markdown lint + typecheck combined
pnpm inspector      # MCP Inspector at http://localhost:5173

# CLI conversion tools (see docs/cli/ for full documentation)
pnpm convert -- mbox ~/Mail/archive.mbox    # Convert MBOX to markdown
pnpm convert -- html ./saved-pages/ -r      # Convert HTML recursively
pnpm upload -- ./converted/                 # Upload to Supabase
pnpm ui                                     # Web UI at http://localhost:3001

# Documentation website
pnpm docs:dev       # Dev server at http://localhost:3000
pnpm docs:build     # Build website

# Desktop app (Electron)
pnpm desktop:dev    # Build and run desktop app
pnpm desktop:build  # Build desktop app bundles
pnpm desktop:dist   # Create production distribution
```

### Workspace Structure

This is a pnpm workspace monorepo. All packages use pnpm — do not use npm.

- **Root**: MCP server, CLI tools
- **`website/`**: Next.js documentation site
- **`desktop/`**: Electron desktop app (`shamefully-hoist=true` via `desktop/.npmrc` for Electron/native module compatibility)

Install all dependencies from root with `pnpm install`.

**Note:** CLI scripts require `--` before arguments (pnpm convert `--` mbox file.mbox)

**Requirements:** Node.js >= 22.0.0

**Testing:** No test suite yet. Use `pnpm inspector` to manually test MCP tools.

### Pre-commit Hooks (Husky)

Commits run `pnpm lint`, `pnpm lint:md`, `./scripts/security-check.sh`, and `pnpm typecheck`. All four must pass.

## Environment Setup

Copy `.env.example` to `.env` and configure:

- `SUPABASE_URL` / `SUPABASE_SERVICE_KEY` - Database connection
- `EMBEDDING_PROVIDER` - `openai` (default) or `ollama`
- `OPENAI_API_KEY` - Required if using OpenAI (text-embedding-3-small, 1536 dimensions)
- `OLLAMA_BASE_URL` / `OLLAMA_MODEL` - Required if using Ollama
- `API_BEARER_TOKEN` - Optional auth token (min 32 chars)
- `UI_PORT` - Web UI port (default: 3001)
- `ENABLE_MEMORY` - Enable/disable memory tools (default: true)
- `ENABLE_CONVERSATIONS` - Enable/disable conversation memory tools (default: true)
- `ENABLE_INSIGHTS` - Enable/disable proactive insight tools (default: true)
- `ENABLE_MEMORY_EXTRACTION` - Enable LLM-based memory extraction (default: false)
- `ANTHROPIC_API_KEY` - Required for memory extraction (Claude API)
- `EXTRACTION_MODEL` - Model for extraction (default: claude-3-haiku-20240307)
- `COMPACT_RESPONSES` - Token-efficient response format (default: true)
- `CHUNKING_MODE` - `fixed` (default) or `semantic` for embedding-based topic splitting
- `SEMANTIC_SIMILARITY_THRESHOLD` - Threshold for semantic chunking (default: 0.5)
- `REDIS_URL` - Optional Redis URL for shared rate limiting across instances (e.g. `redis://localhost:6379`)

### Ollama Model Options

| Model | Dimensions | Schema | Notes |
|-------|-----------|--------|-------|
| `nomic-embed-text` | 1024 | `setup-db-ollama.sql` | Original, good performance |
| `nomic-embed-text-v2-moe` | 768 | `setup-db-ollama-v2.sql` | **Recommended**: MoE architecture, multilingual, better performance |
| `mxbai-embed-large` | 1024 | `setup-db-ollama.sql` | Alternative option |

Database schema must be initialized via `scripts/setup-db.sql` (OpenAI), `scripts/setup-db-ollama.sql` (Ollama v1), or `scripts/setup-db-ollama-v2.sql` (Ollama v2) in Supabase SQL Editor.

**Additional schemas by feature:**

| Feature | OpenAI Schema | Ollama v1 Schema | Ollama v2 Schema |
|---------|---------------|------------------|------------------|
| Memory | `setup-db-memory.sql` | `setup-db-memory-ollama.sql` | - |
| Conversations | `setup-db-conversation.sql` | `setup-db-conversation-ollama.sql` | `setup-db-conversation-ollama-v2.sql` |

**Important:** Different embedding models use different dimensions. You cannot mix models without re-embedding all documents.

## Architecture

### Request Flow

```text
Express Server
├── POST /mcp              → MCP JSON-RPC handler (StreamableHTTPServerTransport)
├── POST /api/upload       → File upload → text extraction → chunking → embeddings
└── GET /health/*          → Health/readiness probes
```

**Rate limits:** API: 100 req/min, Upload: 10 req/min. Set `REDIS_URL` for shared counters across instances; otherwise in-memory.

**MCP Transport:** Uses stateless `StreamableHTTPServerTransport` (no session persistence) for Cloud Run/serverless compatibility. Each request creates a fresh server instance.

### MCP Tools (18 tools)

**Document Tools:**

- `search` - Hybrid semantic + full-text search with weighted RRF fusion. Set `includeMemories`/`includeConversations` to also search those sources with weighted fusion.
- `get_document` / `list_documents` - Document retrieval
- `update_document` - Update document title and/or tags
- `add_note` - Create markdown notes with automatic chunking and embedding (supports `extractMemories` parameter)

**Weighted RRF in search:**
The `search` tool supports weighted Reciprocal Rank Fusion:

- `fullTextWeight` (0-2, default: 1.0) - Weight for keyword matching
- `semanticWeight` (0-2, default: 1.0) - Weight for semantic similarity
- Set `semanticWeight: 1.5, fullTextWeight: 0.5` to prioritize semantic matches
- Set `fullTextWeight: 1.5, semanticWeight: 0.5` to prioritize exact keyword matches

**Memory Tools (Persistent Memory):**

- `remember_fact` - Store facts about entities (people, concepts, projects, etc.)
- `build_knowledge` - Store multiple facts and relations in a single batch call
- `query_memory` - Query the memory graph (`mode: 'search' | 'entity' | 'list'`)
- `relate_entities` - Create relationships between entities
- `forget_entity` - Delete an entity and all its memories
- `extract_memories` - Extract entities and facts from text using LLM (requires `ENABLE_MEMORY_EXTRACTION`)

**Conversation Tools (Conversation Memory):**

- `save_conversation_context` - Save conversation summary and turns for recall
- `query_conversations` - Query past conversations (`mode: 'search' | 'get' | 'list'`)
- `delete_conversation` - Delete a conversation session

**Insight Tools (Proactive Discovery):**

- `get_insights` - View discovered cross-source connections and patterns
- `discover_connections` - Trigger an insight scan across the knowledge base
- `dismiss_insight` - Dismiss an insight from the queue

**Stats:**

- `get_stats` - Get statistics across all features (`scope: 'all' | 'knowledge' | 'memory' | 'conversations' | 'insights'`)

### Key Directories

- `src/tools/` - MCP tool definitions with Zod schemas
- `src/db/` - Supabase client and query functions
- `src/services/` - Embedding generation, text chunking, file processing
- `src/api/` - Express routes and middleware
- `src/utils/` - Configuration, custom errors, logger
- `src/types/` - TypeScript type definitions
- `scripts/cli/` - CLI conversion tools and upload utility
- `scripts/ui/` - Web UI for file conversion (MBOX, EML, ZIP, HTML, PDF, DOCX, TXT, MD)

**Upload Manifest:** The upload utility creates `.manifest.json` in each directory to track uploaded files (prevents duplicates). Use `--force` to re-upload.

### Database

PostgreSQL (Supabase) with:

- `documents` table with full-text search (`tsvector`)
- `chunks` table with vector embeddings (`vector[1536]`, HNSW index)
- `hybrid_search()` RPC for Reciprocal Rank Fusion

**Persistent Memory Tables (run `scripts/setup-db-memory.sql`):**

- `memory_entities` - Named entities (people, concepts, projects, etc.)
- `memory_observations` - Atomic facts about entities with embeddings
- `memory_relations` - Directed relationships between entities
- `memory_hybrid_search()` / `memory_semantic_search()` RPCs

**Conversation Memory Tables (run `scripts/setup-db-conversation.sql`):**

- `conversation_sessions` - Conversation sessions with summaries
- `conversation_turns` - Individual messages with embeddings
- `conversation_hybrid_search()` / `conversation_semantic_search()` RPCs

### Database Sizing

See `docs/guides/supabase-requirements.mdx` for compute tier recommendations, storage estimates, and diagnostic queries. Key points:

- 6 HNSW indexes across all feature tables must fit in RAM for optimal performance
- OpenAI 1536d: ~6 KB/vector, ~7 KB/vector index overhead
- Micro (1 GB RAM) handles up to ~30K vectors; Medium (4 GB) recommended for production
- General Purpose (gp3) disk is sufficient; 8 GB included free

### Database Security

Row Level Security (RLS) is enabled with defense-in-depth policies:

- RLS enabled with restrictive policies denying `anon`/`authenticated` roles
- All permissions revoked from `anon`/`authenticated`
- App uses service role key which bypasses RLS (intentional for single-tenant design)

Run `scripts/security-rls.sql` after schema setup. See `docs/guides/security-hardening.mdx` for details.

### Compact Response Format

Memory tools use a token-efficient response format by default (`COMPACT_RESPONSES=true`). This reduces LLM context usage by 40-60% through:

- **No pretty-printing** - JSON without whitespace (~30% savings)
- **Short keys** - `n`, `t`, `o`, `m` instead of `name`, `type`, `observations`, `memories`
- **Truncated UUIDs** - First 8 chars only (still unique enough for display)
- **Minimal data** - Only essential fields returned

**Compact vs Verbose Examples:**

| Tool | Compact | Verbose |
|------|---------|---------|
| `remember_fact` | `{"ok":true,"entity":"a1b2c3d4","obs":"e5f6g7h8"}` | `{"success":true,"message":"Remembered...","entityId":"a1b2c3d4-..."}` |
| `recall_memories` | `{"n":3,"e":[{"n":"Jeff","t":"person","m":[{"c":"prefers dark mode","s":0.92}]}]}` | `{"query":"...","totalMemories":3,"entities":[...]}` |

**Key mappings:**

- `n` = name/count, `t` = type, `o` = observations, `m` = memories
- `c` = content, `s` = score, `r` = relations
- `ok` = success, `dup` = duplicate, `ent`/`obs`/`rel` = entity/observation/relation counts

Set `COMPACT_RESPONSES=false` for human-readable debugging or when readability is preferred over token efficiency.

## Critical Conventions

### Code Style (Biome)

- **Indentation:** Tabs (not spaces)
- **Quotes:** Single quotes
- **Trailing commas:** Always
- **Line width:** 100 characters
- `noExplicitAny` and `noNonNullAssertion` are warnings (not errors)
- Scripts in `desktop/` and `scripts/` have relaxed lint rules

### Logging

**All logs must use `console.error()` (stderr)** - stdout is reserved for MCP JSON-RPC communication. Never use `console.log()`. Use the `logger` from `src/utils/logger.ts`.

### ESM Imports

This is an ES module project. All imports must use `.js` extensions even for TypeScript files:

```typescript
import { logger } from '../utils/logger.js';  // Correct
import { logger } from '../utils/logger';     // Wrong
```

### MCP Tool Pattern

**Preferred:** Use `server.registerTool()` (SDK v1.26.0+) with `title`, `description`, `inputSchema`, `outputSchema`, and `annotations`:

```typescript
server.registerTool('tool_name', {
  title: 'Tool Name',
  description: 'What this tool does',
  inputSchema: {
    param: z.string().describe('Description'),
  },
  outputSchema: {
    result: z.string(),
    count: z.number(),
  },
  annotations: {
    readOnlyHint: true,
    destructiveHint: false,
  },
}, async ({ param }) => {
  const structured = { result: 'value', count: 42 };
  return {
    content: [{ type: 'text', text: JSON.stringify(structured, null, 2) }],
    structuredContent: structured,
  };
});
```

**Structured output:** Read-only tools (`search`, `get_document`, `list_documents`, `query_memory`, `query_conversations`, `get_stats`) define `outputSchema` and return both `content` (text for LLM consumption, compact or verbose) and `structuredContent` (canonical verbose JSON matching the schema). The `structuredContent` object always uses full canonical keys regardless of `COMPACT_RESPONSES`.

**Legacy:** `server.tool()` with inline Zod schemas is still supported. Use for simple tools:

```typescript
server.tool('tool_name', {
  param: z.string().describe('Description'),
}, async ({ param }) => {
  return { content: [{ type: 'text', text: JSON.stringify(result, null, 2) }] };
});
```

**Error responses** MUST include `isError: true` to prevent LLM retry spirals. Use the shared `toolError()` and `configError()` helpers from `src/utils/compact.ts`.

### Text Chunking

Two chunking modes available via `CHUNKING_MODE`:

**Fixed chunking (default):**

- 512 tokens (~2048 chars) max chunk size
- 50 token overlap for context preservation
- Paragraph-aware splitting on `\n\n`
- Fast, no extra API calls

**Semantic chunking (`CHUNKING_MODE=semantic`):**

- Splits at topic boundaries using embedding similarity
- Generates embeddings for sentences, splits where similarity drops
- Better retrieval accuracy (research shows ~87% vs 50% baseline)
- Slower due to extra embedding API calls during upload
- Configure sensitivity with `SEMANTIC_SIMILARITY_THRESHOLD` (0-1, default: 0.5)

### Error Handling

Custom error hierarchy in `src/utils/errors.ts` - use specific error types (`NotFoundError`, `ValidationError`, etc.) for proper HTTP status codes.

### External Dependencies

`pdf-parse` is externalized in esbuild (native module) - must be in `node_modules` at runtime.

## Agent Discovery Files

For AI agents using Textrawl as an MCP server:

- `AGENTS.md` - Tool selection guide, error handling patterns, integration examples
- `.well-known/mcp.json` - MCP capability advertisement (tools, auth, rate limits)
- `llms.txt` - AI sitemap with RFC 2119 language for tool requirements
- `llms-full.txt` - Complete documentation in single file

## Documentation Sync Rules

When adding or modifying MCP tools, **all** of the following files must be updated:

1. **`CLAUDE.md`** - MCP Tools section (tool name + one-line description)
2. **`README.md`** - Tool tables in MCP Tools section
3. **`AGENTS.md`** - Tool selection guide + RFC 2119 parameter schemas
4. **`llms.txt`** - Tool name, description, and parameters
5. **`llms-full.txt`** - Full tool documentation with parameters
6. **`.well-known/mcp.json`** - JSON schema in `tools` array + `capabilities`
7. **`docs/mcp-tools/<tool-name>.mdx`** - Dedicated doc page with parameters, examples, related tools
8. **`docs/mcp-tools/meta.json`** - Add page to navigation under correct section separator

**Naming conventions:**

- Root project files: UPPERCASE (`README.md`, `AGENTS.md`, `CLAUDE.md`, `CONTRIBUTING.md`)
- Root AI files: lowercase (`llms.txt`, `llms-full.txt`)
- All files under `docs/`: lowercase-kebab-case (e.g., `search-knowledge.mdx`, `get-document.mdx`)
- MDX doc pages use tool name with hyphens replacing underscores (e.g., `get_insights` → `get-insights.mdx`)

**Archive:** Completed planning/research docs go in `docs/archive/` with lowercase-kebab names.

## Documentation Website

The documentation site is in `website/` (Next.js 15 + Fumadocs + React 19 + Tailwind CSS 4). Run via `pnpm docs:dev` / `pnpm docs:build` from the project root.

**Content:** Documentation source files are in `/docs` (referenced via `source.config.ts`).

Deploy to Vercel with custom domain. See `.github/workflows/deploy-website.yml`.

### Critical: Search Infrastructure

Fumadocs does **not** include built-in search — it requires an explicit API route. The search route **must** exist at `website/app/api/search/route.ts` and export a `GET` handler created via `createFromSource()`. **Never delete this file.** If search breaks, check:

1. `website/app/api/search/route.ts` exists and exports `{ GET }`
2. It imports `source` from `@/lib/source` and `createFromSource` from `fumadocs-core/search/server`
3. `pnpm docs:build` succeeds and shows `/api/search` in the route table

## Pull Request Workflow

When completing work that's ready for a PR:

1. **Always create the PR directly** using `gh pr create --title "..." --body "..."` - never just provide a link to `/pull/new/branch-name`
2. **Use conventional commit format for PR titles:**
   - `feat:` - New features
   - `fix:` - Bug fixes
   - `docs:` - Documentation changes
   - `refactor:` - Code refactoring
   - `chore:` - Maintenance tasks
3. **Include in the PR body:**
   - Summary of changes (2-4 bullet points)
   - Link to related issue if applicable (e.g., `Closes #123`)
   - Test plan or verification steps
4. **After creating the PR**, report the actual PR URL returned by `gh`

**Example:**

```bash
gh pr create --title "feat: add user authentication" --body "$(cat <<'EOF'
## Summary
- Add JWT-based authentication middleware
- Create login/logout API endpoints
- Add password hashing with bcrypt

Closes #42

## Test Plan
- Run `pnpm inspector` and test protected endpoints
- Verify tokens expire after configured TTL
EOF
)"
```

## Cursor IDE Integration

Cursor rules in `.cursor/rules/`:

- `typescript.mdc` - ESM imports, Node.js patterns
- `mcp-tools.mdc` - Tool registration, Zod schemas
- `database.mdc` - Embeddings, chunking
- `security.mdc` - Logging, RLS
- `documentation.mdc` - Markdown standards
