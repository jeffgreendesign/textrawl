# Textrawl

[![License: MIT](https://img.shields.io/badge/License-MIT-blue.svg)](LICENSE)
[![Node.js](https://img.shields.io/badge/node-%3E%3D22-brightgreen?logo=node.js)](https://nodejs.org)
[![TypeScript](https://img.shields.io/badge/TypeScript-5.x-3178C6?logo=typescript&logoColor=white)](https://www.typescriptlang.org)
[![PostgreSQL](https://img.shields.io/badge/PostgreSQL-pgvector-4169E1?logo=postgresql&logoColor=white)](https://www.postgresql.org)
[![Neon](https://img.shields.io/badge/Neon-000000?logo=neon&logoColor=white)](https://neon.tech)
[![OpenAI](https://img.shields.io/badge/OpenAI-412991?logo=openai&logoColor=white)](https://openai.com)
[![Ollama](https://img.shields.io/badge/Ollama-000000?logo=ollama&logoColor=white)](https://ollama.com)
[![MCP](https://img.shields.io/badge/MCP-Compatible-8A2BE2)](https://modelcontextprotocol.io)

**Your second brain, wired for AI.**

Textrawl is a personal knowledge server with persistent memory, searchable documents, and proactive insights. Import your emails, PDFs, and notes — then ask questions, recall past conversations, and discover connections you missed. Access it all through MCP, the web dashboard, or the REST API.

## How It Works

```text
┌──────────────┐         ┌───────────────────────────────────────────┐
│              │         │           Your Second Brain               │
│  MCP Client  │◄───────►│                                           │
│  (Claude,    │   MCP   │   Documents    Memory     Conversations   │
│   ChatGPT)   │         │   ┌────────┐  ┌───────┐  ┌────────────┐  │
└──────────────┘         │   │ Emails │  │ Facts │  │Past sessions│  │
                         │   │ PDFs   │  │People │  │ Summaries  │  │
┌──────────────┐         │   │ Notes  │  │ Links │  │ Context    │  │
│   Dashboard  │◄───────►│   └───┬────┘  └──┬────┘  └─────┬──────┘  │
│  (Web UI)    │  REST   │       └──────────┼──────────────┘         │
└──────────────┘         │                  ▼                        │
                         │     ┌───────────────────────────┐         │
                         │     │  Hybrid Search + Fusion   │         │
                         │     └───────────────────────────┘         │
                         │                  │                        │
                         │                  ▼                        │
                         │      Insights · Daily Briefing            │
                         └───────────────────────────────────────────┘
                                            ▲
                                            │
                                 ┌──────────┴──────────┐
                                 │                     │
                            Desktop App            CLI Tools
                           (drag & drop)        (batch import)
```

## Why Textrawl?

**Beyond keyword search.** Most search tools only match exact words. Textrawl combines semantic understanding (finds "automobile" when you search "car") with traditional keyword matching — so you get relevant results without missing exact phrases.

**Your data, your choice.** Use OpenAI's embeddings for best accuracy, Google AI for multimodal support, or run completely locally with Ollama — no API costs, no data leaving your machine.

**Import everything.** Emails from Gmail exports, PDFs from your research, saved web pages, images, audio files, Google Takeout archives — Textrawl converts them all into searchable knowledge.

## Features

| Feature | Description |
|---------|-------------|
| **Hybrid Search** | Vector similarity + full-text search with Reciprocal Rank Fusion |
| **Persistent Memory** | Remember facts about people, projects, and concepts across sessions |
| **Conversation Recall** | Save and query past conversation context across sessions |
| **Proactive Insights** | Automatically discover connections, patterns, and outliers in your knowledge |
| **Daily Briefing** | Summary of recent additions, new insights, and resurfaced knowledge |
| **Unified RAG** | `ask` tool searches documents, memory, and conversations in one query |
| **Web Dashboard** | Command center with knowledge explorer, timeline, agent orchestration, and applets |
| **Multimodal** | Process images (Claude vision) and audio (Whisper transcription) alongside documents |
| **Desktop App** | Drag-and-drop file conversion and upload (macOS, Windows, Linux) |
| **Multi-Format** | PDF, DOCX, XLSX, PPTX, HTML, MBOX/EML emails, Google Takeout |
| **MCP + REST + WebSocket** | MCP tools, REST API, and real-time WebSocket events |
| **Agent Discovery** | A2A protocol at `/.well-known/agent.json` for agent-to-agent interaction |
| **Flexible Embeddings** | OpenAI, Google AI, or Ollama (free, local) |
| **Smart Chunking** | Paragraph-aware splitting with overlap for context |
| **CLI Tools** | Batch processing for large archives |
| **Cloud Ready** | Deploy to Docker, Cloud Run, or any container platform |

## Quick Start

### 1. Set Up the Server

```bash
git clone https://github.com/jeffgreendesign/textrawl.git
cd textrawl
pnpm install
pnpm setup    # Interactive setup for credentials
pnpm dev      # Start the server
```

### 2. Set Up Your Database

1. Create a free project at [neon.tech](https://neon.tech)
2. Copy the **pooled connection string** from the Neon dashboard into `DATABASE_URL` in `.env`
3. Run the base schema against your database:

   ```bash
   psql $DATABASE_URL -f scripts/setup-db.sql
   ```

   (Use `setup-db-ollama.sql` for Ollama / `setup-db-ollama-v2.sql` for `nomic-embed-text-v2-moe` / `setup-db-google.sql` for Google AI)
4. (Optional) For memory tools: `psql $DATABASE_URL -f scripts/setup-db-memory.sql`
5. (Optional) For conversation tools: `psql $DATABASE_URL -f scripts/setup-db-conversation.sql`
6. (Optional) For Row Level Security hardening: `psql $DATABASE_URL -f scripts/security-rls.sql`

### 3. Connect Claude Desktop

Add to your Claude config (`~/Library/Application Support/Claude/claude_desktop_config.json`). Create this file if it doesn't exist:

```json
{
  "mcpServers": {
    "textrawl": {
      "command": "npx",
      "args": [
        "mcp-remote",
        "http://localhost:3000/mcp",
        "--header",
        "Accept: application/json, text/event-stream"
      ]
    }
  }
}
```

**Note:** Requires Node.js 22+. If using nvm, ensure your default is set: `nvm alias default 22`

If you've set `API_BEARER_TOKEN` in `.env`, add the auth header:

```json
"--header",
"Authorization: Bearer YOUR_TOKEN_HERE"
```

Restart Claude Desktop - you'll now see Textrawl's tools available.

### 3b. Connect ChatGPT Desktop (Alternative)

ChatGPT Desktop supports MCP servers natively (Pro/Plus required):

1. Open **Settings → Connectors → Advanced → Developer mode**
2. Add a new connector with your server URL: `http://localhost:3000/mcp`
3. If using auth, add the `Authorization: Bearer YOUR_TOKEN` header

See [OpenAI MCP documentation](https://platform.openai.com/docs/mcp) for details.

### 4. Add Your Documents

**Option A: Desktop App** (easiest)

```bash
pnpm desktop:dev
```

Drag files onto the window to convert and upload.

**Option B: CLI** (for batch imports)

```bash
pnpm convert -- mbox ~/Mail/archive.mbox
pnpm upload -- ./converted/
```

## Documentation

| Guide | Description |
|-------|-------------|
| [Database Sizing](docs/guides/supabase-requirements.mdx) | Vector dimensions, index counts, and storage estimates by embedding provider |
| [CLI Tools](docs/cli/) | Batch conversion and upload from command line |
| [Security](docs/guides/security-hardening.mdx) | Row Level Security and access controls |

---

## Configuration

| Variable | Required | Description |
|----------|----------|-------------|
| `DATABASE_URL` | Yes | Neon (or any PostgreSQL) pooled connection string |
| `DATABASE_URL_UNPOOLED` | No | Direct connection for schema migrations (optional) |
| `EMBEDDING_PROVIDER` | No | `openai` (default), `ollama`, or `google` |
| `OPENAI_API_KEY` | If OpenAI | For text-embedding-3-small (1536d) |
| `OLLAMA_BASE_URL` | If Ollama | Default: `http://localhost:11434` |
| `OLLAMA_MODEL` | If Ollama | Default: `nomic-embed-text` |
| `GOOGLE_AI_API_KEY` | If Google | For gemini-embedding-2-preview (3072d) |
| `GOOGLE_EMBEDDING_MODEL` | If Google | Default: `gemini-embedding-2-preview` |
| `API_BEARER_TOKEN` | Prod only | Min 32 chars (`openssl rand -hex 32`) |
| `PORT` | No | Default: 3000 |
| `LOG_LEVEL` | No | debug, info, warn, error |
| `ALLOWED_ORIGINS` | No | Comma-separated CORS origins |
| `ENABLE_MEMORY` | No | Enable memory tools (default: true); requires `setup-db-memory.sql` |
| `ENABLE_CONVERSATIONS` | No | Enable conversation memory tools (default: true); requires `setup-db-conversation.sql` |
| `ENABLE_INSIGHTS` | No | Enable proactive insight tools (default: true) |
| `ENABLE_MEMORY_EXTRACTION` | No | Enable LLM-based memory extraction (default: false) |
| `ANTHROPIC_API_KEY` | If extraction | Required for `extract_memories` tool |
| `EXTRACTION_MODEL` | No | Model for extraction (default: claude-haiku-4-5-20251001) |
| `INSIGHT_MODEL` | No | Model for insight synthesis (default: claude-sonnet-4-6) |
| `COMPACT_RESPONSES` | No | Token-efficient responses (default: true) |
| `CHUNKING_MODE` | No | `fixed` (default) or `semantic` (embedding-based splits) |
| `SEMANTIC_SIMILARITY_THRESHOLD` | No | Semantic split sensitivity 0–1 (default: 0.5) |
| `REDIS_URL` | No | Redis URL for shared rate limiting across instances |
| `GOOGLE_CLIENT_ID` | OAuth | OAuth 2.0 client ID (all four OAuth vars required together) |
| `GOOGLE_CLIENT_SECRET` | OAuth | OAuth 2.0 client secret |
| `OAUTH_JWT_SECRET` | OAuth | Min 32-char secret for JWT signing |
| `OAUTH_ALLOWED_EMAILS` | OAuth | Comma-separated email allowlist (optional) |
| `OAUTH_SERVER_URL` | OAuth | Public server URL for OAuth redirect |
| `PG_REPORT_DIR` | No | pg_analyze report directory (default: ./reports/pg-analysis) |

## MCP Tools (26 tools)

Read-only tools (`search`, `get_document`, `list_documents`, `query_memory`, `query_conversations`, `get_stats`, `health_check`) include `outputSchema` and return `structuredContent` for programmatic consumption alongside the text `content` response.

### Document Tools

| Tool | Description |
|------|-------------|
| `search` | Hybrid semantic + full-text search. Set `includeMemories`/`includeConversations` for cross-source fusion. |
| `get_document` | Retrieve document by ID |
| `list_documents` | List with pagination and filtering |
| `update_document` | Update title and/or tags |
| `add_note` | Add markdown note to knowledge base |

### Memory Tools (Persistent Memory)

Enable with `ENABLE_MEMORY=true` (default). Requires `scripts/setup-db-memory.sql` or `setup-db-memory-ollama.sql`.

| Tool | Description |
|------|-------------|
| `remember_fact` | Store facts about entities (people, projects, concepts) |
| `build_knowledge` | Store multiple facts and relations in a single batch call |
| `query_memory` | Query the memory graph (`mode: 'search' \| 'entity' \| 'list'`) |
| `relate_entities` | Create relationships between entities |
| `forget_entity` | Delete an entity and all its memories |
| `extract_memories` | Extract entities and facts from text using LLM |

### Conversation Tools (Conversation Memory)

Enable with `ENABLE_CONVERSATIONS=true` (default). Requires running one of the conversation schema scripts:

- `scripts/setup-db-conversation.sql` (OpenAI embeddings, 1536d)
- `scripts/setup-db-conversation-ollama.sql` (Ollama v1 - nomic-embed-text, 1024d)
- `scripts/setup-db-conversation-ollama-v2.sql` (Ollama v2 - nomic-embed-text-v2-moe, 768d)
- `scripts/setup-db-conversation-google.sql` (Google AI - gemini-embedding-2-preview, 3072d)

| Tool | Description |
|------|-------------|
| `save_conversation_context` | Save conversation summary and turns for recall |
| `query_conversations` | Query past conversations (`mode: 'search' \| 'get' \| 'list'`) |
| `delete_conversation` | Delete a conversation session |

### Insight Tools (Proactive Discovery)

Enable with `ENABLE_INSIGHTS=true` (default).

| Tool | Description |
|------|-------------|
| `get_insights` | View discovered cross-source connections and patterns |
| `discover_connections` | Trigger an insight scan across the knowledge base |
| `dismiss_insight` | Dismiss an insight from the queue |

### Stats

| Tool | Description |
|------|-------------|
| `get_stats` | Statistics across all features (`scope: 'all' \| 'knowledge' \| 'memory' \| 'conversations' \| 'insights'`) |
| `health_check` | Check the health of all subsystems — returns pass/fail per component with overall status (`verbose` for latency and counts) |

### Unified Tools

| Tool | Description |
|------|-------------|
| `ask` | Unified RAG search across all knowledge sources (documents, memory, conversations, insights) |
| `daily_briefing` | Generate a daily briefing with recent additions, new insights, and resurfaced knowledge |
| `save_url` | Fetch a URL, convert HTML to markdown, extract metadata, and save as a document |
| `timeline` | Browse knowledge chronologically within a date range, optionally filtered by topic |

### Postgres Analysis Tools

Enabled when `DATABASE_URL` is configured. Connects directly to Postgres.

| Tool | Description |
|------|-------------|
| `pg_analyze` | Run comprehensive Postgres health analysis with table stats, index health, vacuum status, bloat estimates, and Textrawl-specific checks |
| `pg_recommendations` | Get actionable optimization recommendations filtered by severity |
| `pg_report_history` | View past analysis reports and compare trends over time |

### Search Parameters

| Parameter | Type | Default | Description |
|-----------|------|---------|-------------|
| `query` | string | required | Search query |
| `limit` | number | 10 | Max results (1-50) |
| `fullTextWeight` | number | 1.0 | Keyword weight (0-2) |
| `semanticWeight` | number | 1.0 | Semantic weight (0-2) |
| `minScore` | number | 0 | Min relevance threshold (0-1) |
| `tags` | string[] | - | Filter by tags (AND logic) |
| `sourceType` | string | - | `note`, `file`, or `url` |

## REST API

### Upload Documents

```bash
curl -X POST http://localhost:3000/api/upload \
  -H "Authorization: Bearer YOUR_TOKEN" \
  -F "file=@document.pdf" \
  -F "title=Optional Title" \
  -F "tags=tag1,tag2"
```

**Limits:** 10MB max file size, 10 uploads/min
**Formats:** `.pdf`, `.docx`, `.txt`, `.md`

**Response:**

```json
{
  "success": true,
  "documentId": "uuid",
  "title": "Document Title",
  "tags": ["tag1", "tag2"],
  "chunksCreated": 12
}
```

### Health Checks

- `GET /health` - Basic health
- `GET /health/ready` - Readiness probe (checks DB)
- `GET /health/live` - Liveness probe

## Deployment

### Docker Compose

```bash
docker-compose up -d
docker-compose logs -f
```

### Google Cloud Run

```bash
# Create secrets in Secret Manager first
export GCP_PROJECT_ID=your-project-id
./scripts/deploy.sh
```

## Development

```bash
pnpm dev            # Watch mode
pnpm build          # Production build
pnpm start          # Run production
pnpm typecheck      # Type check
pnpm lint           # Biome lint check
pnpm quality        # Lint + typecheck combined
pnpm inspector      # MCP Inspector
pnpm setup          # Generate .env with secure token
pnpm desktop:dev    # Run desktop app
pnpm docs:dev       # Run docs site
```

### Local Database (Optional)

Run PostgreSQL + pgvector locally:

```bash
# Start local Postgres with pgvector
docker-compose -f docker-compose.local.yml up -d

# Initialize the database schema
docker exec -i textrawl-postgres psql -U postgres -d textrawl < scripts/setup-db.sql

# Optional: Start pgAdmin at http://localhost:5050
docker-compose -f docker-compose.local.yml --profile tools up -d
```

### Local Embeddings with Ollama (No API Key Required)

Run embeddings locally with [Ollama](https://ollama.com) instead of OpenAI:

```bash
# Start Postgres + Ollama
docker-compose -f docker-compose.local.yml --profile ollama up -d

# Pull the embedding model (~274MB)
docker exec textrawl-ollama ollama pull nomic-embed-text

# Use the Ollama-specific schema (1024 dimensions)
docker exec -i textrawl-postgres psql -U postgres -d textrawl < scripts/setup-db-ollama.sql
```

Set in `.env`:

```bash
EMBEDDING_PROVIDER=ollama
OLLAMA_BASE_URL=http://localhost:11434
OLLAMA_MODEL=nomic-embed-text
```

**Supported Ollama models:** `nomic-embed-text` (1024d), `nomic-embed-text-v2-moe` (768d, recommended for new installs), `mxbai-embed-large` (1024d)

> **Note:** Each provider uses different embedding dimensions: OpenAI 1536d, Ollama 1024d (or 768d for v2-moe), Google AI 768d. Use the matching schema: `setup-db.sql` (OpenAI), `setup-db-ollama.sql` (Ollama 1024d), `setup-db-ollama-v2.sql` (Ollama 768d), or `setup-db-google.sql` (Google AI). You cannot mix providers without re-embedding all documents.

## Troubleshooting

| Issue | Solution |
|-------|----------|
| Can't connect to database | Check `DATABASE_URL` is set to your Neon pooled connection string |
| No search results | Check `chunks` table has embeddings; lower `minScore` |
| MCP tools not in Claude | Restart Claude Desktop; check `curl http://localhost:3000/health` |
| Rate limit exceeded | API: 100/min, Upload: 10/min |
| CodeQL Analyze job fails with SARIF/default setup error | This repo uses advanced CodeQL workflow (`.github/workflows/codeql.yml`); keep GitHub Code Scanning Default Setup disabled in repo settings |

## Contributing

Contributions welcome! See [CONTRIBUTING.md](CONTRIBUTING.md) for guidelines.

## License

MIT - see [LICENSE](LICENSE)
