# Textrawl

[![License: MIT](https://img.shields.io/badge/License-MIT-blue.svg)](LICENSE)
[![Node.js](https://img.shields.io/badge/node-%3E%3D22-brightgreen?logo=node.js)](https://nodejs.org)
[![TypeScript](https://img.shields.io/badge/TypeScript-5.x-3178C6?logo=typescript&logoColor=white)](https://www.typescriptlang.org)
[![PostgreSQL](https://img.shields.io/badge/PostgreSQL-pgvector-4169E1?logo=postgresql&logoColor=white)](https://www.postgresql.org)
[![Supabase](https://img.shields.io/badge/Supabase-3FCF8E?logo=supabase&logoColor=white)](https://supabase.com)
[![OpenAI](https://img.shields.io/badge/OpenAI-412991?logo=openai&logoColor=white)](https://openai.com)
[![Ollama](https://img.shields.io/badge/Ollama-000000?logo=ollama&logoColor=white)](https://ollama.com)
[![MCP](https://img.shields.io/badge/MCP-Compatible-8A2BE2)](https://modelcontextprotocol.io)

**Turn your documents into Claude's memory.**

Textrawl is a personal knowledge base that lets Claude search through your emails, PDFs, notes, and web pages. Ask questions about your own documents right from Claude Desktop - no copy-pasting, no context limits.

## How It Works

```
                                    Your Knowledge Base
                                    ┌─────────────────────────────────┐
┌──────────────┐                    │                                 │
│              │                    │   Emails      PDFs      Notes   │
│    Claude    │◄───── search ─────►│     │          │          │     │
│   Desktop    │                    │     ▼          ▼          ▼     │
│              │                    │  ┌──────────────────────────┐   │
└──────────────┘                    │  │   Hybrid Search Engine   │   │
       │                            │  │  (semantic + keywords)   │   │
       │                            │  └──────────────────────────┘   │
       ▼                            │              │                  │
  "What did                         │              ▼                  │
   Sarah say                        │     PostgreSQL + pgvector       │
   about the                        │         (Supabase)              │
   project?"                        │                                 │
                                    └─────────────────────────────────┘
                                                   ▲
                                                   │
                                        ┌──────────┴──────────┐
                                        │                     │
                                   Desktop App            CLI Tools
                                  (drag & drop)        (batch import)
```

## Why Textrawl?

**Beyond keyword search.** Most search tools only match exact words. Textrawl combines semantic understanding (finds "automobile" when you search "car") with traditional keyword matching - so you get relevant results without missing exact phrases.

**Your data, your choice.** Use OpenAI's embeddings for best accuracy, or run completely locally with Ollama - no API costs, no data leaving your machine.

**Import everything.** Emails from Gmail exports, PDFs from your research, saved web pages, Google Takeout archives - Textrawl converts them all into searchable knowledge.

## Features

| Feature | Description |
|---------|-------------|
| **Hybrid Search** | Vector similarity + full-text search with Reciprocal Rank Fusion |
| **Desktop App** | Drag-and-drop file conversion and upload (macOS, Windows, Linux) |
| **Multi-Format** | PDF, DOCX, XLSX, PPTX, HTML, MBOX/EML emails, Google Takeout |
| **MCP Integration** | Works natively with Claude Desktop and other MCP clients |
| **Flexible Embeddings** | OpenAI (cloud) or Ollama (free, local) |
| **Smart Chunking** | Paragraph-aware splitting with overlap for context |
| **CLI Tools** | Batch processing for large archives |
| **Cloud Ready** | Deploy to Docker, Cloud Run, or any container platform |

## Quick Start

### 1. Set Up the Server

```bash
git clone https://github.com/your-username/textrawl.git
cd textrawl
npm install
npm run setup    # Interactive setup for credentials
npm run dev      # Start the server
```

### 2. Set Up Supabase

1. Create a free project at [supabase.com](https://supabase.com)
2. Run `scripts/setup-db.sql` in the SQL Editor (or `setup-db-ollama.sql` for Ollama)
3. Run `scripts/security-rls.sql` for security hardening
4. Copy your project URL and service role key to `.env`

### 3. Connect Claude Desktop

Add to your Claude config (`~/Library/Application Support/Claude/claude_desktop_config.json`):

```json
{
  "mcpServers": {
    "textrawl": {
      "url": "http://localhost:3000/mcp"
    }
  }
}
```

Restart Claude Desktop - you'll now see Textrawl's tools available.

### 4. Add Your Documents

**Option A: Desktop App** (easiest)
```bash
cd desktop && npm install && npm run dev
```
Drag files onto the window to convert and upload.

**Option B: CLI** (for batch imports)
```bash
npm run convert -- mbox ~/Mail/archive.mbox
npm run upload -- ./converted/
```

## Documentation

| Guide | Description |
|-------|-------------|
| [CLI Tools](docs/CLI.md) | Batch conversion and upload from command line |
| [Desktop App](docs/DESKTOP.md) | Electron app for drag-and-drop imports |
| [Security](docs/SECURITY.md) | Row Level Security and access controls |

---

## Configuration

| Variable | Required | Description |
|----------|----------|-------------|
| `SUPABASE_URL` | Yes | `https://your-project.supabase.co` |
| `SUPABASE_SERVICE_KEY` | Yes | Service role key |
| `EMBEDDING_PROVIDER` | No | `openai` (default) or `ollama` |
| `OPENAI_API_KEY` | If OpenAI | For text-embedding-3-small |
| `OLLAMA_BASE_URL` | If Ollama | Default: `http://localhost:11434` |
| `OLLAMA_MODEL` | If Ollama | Default: `nomic-embed-text` |
| `API_BEARER_TOKEN` | Prod only | Min 32 chars (`openssl rand -hex 32`) |
| `PORT` | No | Default: 3000 |
| `LOG_LEVEL` | No | debug, info, warn, error |
| `ALLOWED_ORIGINS` | No | Comma-separated CORS origins |

## MCP Tools

| Tool | Description |
|------|-------------|
| `search_knowledge` | Hybrid semantic + full-text search |
| `get_document` | Retrieve document by ID |
| `list_documents` | List with pagination and filtering |
| `update_document` | Update title and/or tags |
| `add_note` | Add markdown note to knowledge base |

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
npm run dev         # Watch mode
npm run build       # Production build
npm run start       # Run production
npm run typecheck   # Type check
npm run inspector   # MCP Inspector
npm run setup       # Generate .env with secure token
```

### Local Database (Optional)

Run PostgreSQL + pgvector locally instead of using Supabase:

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

**Supported Ollama models:** `nomic-embed-text` (recommended), `mxbai-embed-large`

> **Note:** OpenAI uses 1536-dimension embeddings, Ollama models use 1024. Use `setup-db.sql` for OpenAI or `setup-db-ollama.sql` for Ollama. You cannot mix providers without re-embedding all documents.

## Troubleshooting

| Issue | Solution |
|-------|----------|
| Invalid Supabase URL | Format: `https://your-project.supabase.co` (no trailing slash) |
| Missing service role key | Use service role key from Settings > API, not anon key |
| No search results | Check `chunks` table has embeddings; lower `minScore` |
| MCP tools not in Claude | Restart Claude Desktop; check `curl http://localhost:3000/health` |
| Rate limit exceeded | API: 100/min, Upload: 10/min |

## Contributing

Contributions welcome! See [CONTRIBUTING.md](CONTRIBUTING.md) for guidelines.

## License

MIT - see [LICENSE](LICENSE)
