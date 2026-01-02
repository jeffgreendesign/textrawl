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

# CLI conversion tools (see docs/CLI.md for full documentation)
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
- `OLLAMA_BASE_URL` / `OLLAMA_MODEL` - Required if using Ollama (nomic-embed-text, 1024 dimensions)
- `API_BEARER_TOKEN` - Optional auth token (min 32 chars)
- `UI_PORT` - Web UI port (default: 3001)

Database schema must be initialized via `scripts/setup-db.sql` (OpenAI) or `scripts/setup-db-ollama.sql` (Ollama) in Supabase SQL Editor.

**Important:** OpenAI and Ollama use different embedding dimensions. You cannot mix providers without re-embedding all documents.

## Architecture

### Request Flow
```
Express Server
├── POST /mcp              → MCP JSON-RPC handler (StreamableHTTPServerTransport)
├── POST /api/upload       → File upload → text extraction → chunking → embeddings
└── GET /health/*          → Health/readiness probes
```

**Rate limits:** API: 100 req/min, Upload: 10 req/min

**MCP Transport:** Uses stateless `StreamableHTTPServerTransport` (no session persistence) for Cloud Run/serverless compatibility. Each request creates a fresh server instance.

### MCP Tools
- `search_knowledge` - Hybrid search with configurable FTS/semantic weights (RRF fusion)
- `get_document` / `list_documents` - Document retrieval
- `update_document` - Update document title and/or tags
- `add_note` - Create markdown notes with automatic chunking and embedding

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

### Database Security
Row Level Security (RLS) is enabled with defense-in-depth policies:
- RLS enabled with restrictive policies denying `anon`/`authenticated` roles
- All permissions revoked from `anon`/`authenticated`
- App uses service role key which bypasses RLS (intentional for single-tenant design)

Run `scripts/security-rls.sql` after schema setup. See `docs/SECURITY.md` for details.

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
- 512 tokens (~2048 chars) max chunk size
- 50 token overlap for context preservation
- Paragraph-aware splitting on `\n\n`

### Error Handling
Custom error hierarchy in `src/utils/errors.ts` - use specific error types (`NotFoundError`, `ValidationError`, etc.) for proper HTTP status codes.

### External Dependencies
`pdf-parse` is externalized in esbuild (native module) - must be in `node_modules` at runtime.
