# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Project Overview

Textrawl is a Personal Knowledge MCP (Model Context Protocol) Server that provides hybrid semantic + full-text search over documents. It allows Claude to search, retrieve, and add documents to a knowledge base backed by Supabase PostgreSQL with vector embeddings.

## Development Commands

```bash
npm run setup       # Generate .env with secure token + enter credentials
npm run dev         # Watch mode dev server (tsx)
npm run build       # TypeScript compile + esbuild bundle to dist/
npm run start       # Run production build
npm run typecheck   # Type-check without emitting
npm run inspector   # MCP Inspector at http://localhost:5173

# CLI conversion tools (see docs/cli/ for full documentation)
npm run convert -- mbox ~/Mail/archive.mbox    # Convert MBOX to markdown
npm run convert -- html ./saved-pages/ -r      # Convert HTML recursively
npm run upload -- ./converted/                 # Upload to Supabase
npm run ui                                     # Web UI at http://localhost:3001
```

**Note:** CLI scripts require `--` before arguments (npm run convert `--` mbox file.mbox)

**Requirements:** Node.js >= 22.0.0

**Testing:** No test suite yet. Use `npm run inspector` to manually test MCP tools.

## Environment Setup

Copy `.env.example` to `.env` and configure:
- `SUPABASE_URL` / `SUPABASE_SERVICE_KEY` - Database connection
- `EMBEDDING_PROVIDER` - `openai` (default) or `ollama`
- `OPENAI_API_KEY` - Required if using OpenAI (text-embedding-3-small, 1536 dimensions)
- `OLLAMA_BASE_URL` / `OLLAMA_MODEL` - Required if using Ollama
- `API_BEARER_TOKEN` - Optional auth token (min 32 chars)
- `UI_PORT` - Web UI port (default: 3001)
- `ENABLE_MEMORY` - Enable/disable memory tools (default: true)
- `COMPACT_RESPONSES` - Token-efficient response format (default: true)
- `CHUNKING_MODE` - `fixed` (default) or `semantic` for embedding-based topic splitting
- `SEMANTIC_SIMILARITY_THRESHOLD` - Threshold for semantic chunking (default: 0.5)

### Ollama Model Options

| Model | Dimensions | Schema | Notes |
|-------|-----------|--------|-------|
| `nomic-embed-text` | 1024 | `setup-db-ollama.sql` | Original, good performance |
| `nomic-embed-text-v2-moe` | 768 | `setup-db-ollama-v2.sql` | **Recommended**: MoE architecture, multilingual, better performance |
| `mxbai-embed-large` | 1024 | `setup-db-ollama.sql` | Alternative option |

Database schema must be initialized via `scripts/setup-db.sql` (OpenAI), `scripts/setup-db-ollama.sql` (Ollama v1), or `scripts/setup-db-ollama-v2.sql` (Ollama v2) in Supabase SQL Editor. For persistent memory features, also run the matching memory schema:
- OpenAI: `scripts/setup-db-memory.sql` (1536 dimensions)
- Ollama v1: `scripts/setup-db-memory-ollama.sql` (1024 dimensions)

**Important:** Different embedding models use different dimensions. You cannot mix models without re-embedding all documents.

## Architecture

### Request Flow

```text
Express Server
├── POST /mcp              → MCP JSON-RPC handler (StreamableHTTPServerTransport)
├── POST /api/upload       → File upload → text extraction → chunking → embeddings
└── GET /health/*          → Health/readiness probes
```

**Rate limits:** API: 100 req/min, Upload: 10 req/min

**MCP Transport:** Uses stateless `StreamableHTTPServerTransport` (no session persistence) for Cloud Run/serverless compatibility. Each request creates a fresh server instance.

### MCP Tools

**Document Tools:**
- `search_knowledge` - Hybrid search with weighted RRF fusion (see below)
- `get_document` / `list_documents` - Document retrieval
- `update_document` - Update document title and/or tags
- `add_note` - Create markdown notes with automatic chunking and embedding

**Weighted RRF in search_knowledge:**
The `search_knowledge` tool supports weighted Reciprocal Rank Fusion:
- `fullTextWeight` (0-2, default: 1.0) - Weight for keyword matching
- `semanticWeight` (0-2, default: 1.0) - Weight for semantic similarity
- Set `semanticWeight: 1.5, fullTextWeight: 0.5` to prioritize semantic matches
- Set `fullTextWeight: 1.5, semanticWeight: 0.5` to prioritize exact keyword matches

**Memory Tools (Persistent Memory):**
- `remember_fact` - Store facts about entities (people, concepts, projects, etc.)
- `recall_memories` - Semantic search across stored memories
- `relate_entities` - Create relationships between entities
- `get_entity_context` - Get all memories and relations for an entity
- `list_entities` - List all known entities
- `forget_entity` - Delete an entity and all its memories
- `memory_stats` - Get memory statistics

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

### Logging
**All logs must use `console.error()` (stderr)** - stdout is reserved for MCP JSON-RPC communication. Never use `console.log()`. Use the `logger` from `src/utils/logger.ts`.

### ESM Imports
This is an ES module project. All imports must use `.js` extensions even for TypeScript files:
```typescript
import { logger } from '../utils/logger.js';  // Correct
import { logger } from '../utils/logger';     // Wrong
```

### MCP Tool Pattern
Tools are registered using `server.tool()` with inline Zod schemas and return `{ content: [{ type: 'text', text: JSON.stringify(...) }] }`:
```typescript
server.tool('tool_name', {
  param: z.string().describe('Description'),
}, async ({ param }) => {
  return { content: [{ type: 'text', text: JSON.stringify(result, null, 2) }] };
});
```

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

## Documentation Website

The documentation site is in `website/` (Next.js + Fumadocs):

```bash
cd website
npm install
npm run dev      # Dev server at http://localhost:3000
npm run build    # Build to website/.next/
```

**Stack:** Next.js 15, Fumadocs (MDX documentation framework), React 19, Tailwind CSS 4.

**Content:** Documentation source files are in `/docs` (referenced via `source.config.ts`).

Deploy to Vercel with custom domain. See `.github/workflows/deploy-website.yml`.

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
- Run `npm run inspector` and test protected endpoints
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
