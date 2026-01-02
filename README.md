# Textrawl

[![License: MIT](https://img.shields.io/badge/License-MIT-blue.svg)](LICENSE)
[![Node.js](https://img.shields.io/badge/node-%3E%3D22-brightgreen?logo=node.js)](https://nodejs.org)
[![TypeScript](https://img.shields.io/badge/TypeScript-5.x-3178C6?logo=typescript&logoColor=white)](https://www.typescriptlang.org)
[![PostgreSQL](https://img.shields.io/badge/PostgreSQL-pgvector-4169E1?logo=postgresql&logoColor=white)](https://www.postgresql.org)
[![Supabase](https://img.shields.io/badge/Supabase-3FCF8E?logo=supabase&logoColor=white)](https://supabase.com)
[![OpenAI](https://img.shields.io/badge/OpenAI-412991?logo=openai&logoColor=white)](https://openai.com)
[![Ollama](https://img.shields.io/badge/Ollama-000000?logo=ollama&logoColor=white)](https://ollama.com)
[![MCP](https://img.shields.io/badge/MCP-Compatible-8A2BE2)](https://modelcontextprotocol.io)

Personal Knowledge MCP Server - semantic search over your documents from Claude.

## Features

- **Hybrid Search** - Vector similarity + full-text search with Reciprocal Rank Fusion
- **Multi-format Support** - PDF, Word (.docx), Markdown, and plain text
- **File Conversion** - Import emails (MBOX/EML), HTML, Google Takeout archives
- **MCP Integration** - Works with Claude Desktop and other MCP clients
- **Smart Chunking** - Paragraph-aware splitting with overlap for context

## Table of Contents

- [Prerequisites](#prerequisites)
- [Quick Start](#quick-start)
- [Configuration](#configuration)
- [MCP Tools](#mcp-tools)
- [REST API](#rest-api)
- [CLI Tools](docs/CLI.md) - File conversion and upload utilities
- [Claude Desktop Setup](#claude-desktop-setup)
- [Deployment](#deployment)
- [Development](#development)
- [Troubleshooting](#troubleshooting)
- [Contributing](#contributing)
- [License](#license)

## Prerequisites

- Node.js >= 22.0.0
- [Supabase](https://supabase.com) account (PostgreSQL with pgvector)
- Embeddings: [OpenAI](https://platform.openai.com) API key **OR** [Ollama](https://ollama.com) (free, local)

## Quick Start

```bash
npm install
npm run setup           # Generate .env with secure token + enter credentials
npm run dev             # Start dev server
npm run inspector       # Test with MCP Inspector at http://localhost:5173
```

### Supabase Setup

1. Create project at [supabase.com](https://supabase.com)
2. Run `scripts/setup-db.sql` in SQL Editor (or `setup-db-ollama.sql` for Ollama)
3. Run `scripts/security-rls.sql` to enable Row Level Security
4. Create private storage bucket named `documents`
5. Get credentials from Settings > API (use **service role key**, not anon key)

> **Security Note**: The security script enables RLS and blocks access from `anon`/`authenticated` roles. This is defense-in-depth since the app uses the service role key. See [docs/SECURITY.md](docs/SECURITY.md).

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

## Claude Desktop Setup

**Config location:**
- macOS: `~/Library/Application Support/Claude/claude_desktop_config.json`
- Windows: `%APPDATA%\Claude\claude_desktop_config.json`
- Linux: `~/.config/Claude/claude_desktop_config.json`

```json
{
  "mcpServers": {
    "textrawl": {
      "url": "http://localhost:3000/mcp"
    }
  }
}
```

For remote deployment, add `"headers": { "Authorization": "Bearer YOUR_TOKEN" }`.

Restart Claude Desktop after config changes.

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

# File conversion tools (see docs/CLI.md)
npm run convert     # Convert files (mbox, eml, html, takeout)
npm run upload      # Upload converted markdown to Supabase
npm run ui          # Web UI for conversion at localhost:3001
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

For local Postgres, you'll still need to configure the Supabase client to connect to `localhost:5432` or use a direct PostgreSQL adapter (contribution welcome!).

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
