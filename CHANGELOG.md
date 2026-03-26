# Changelog

All notable changes to Textrawl are documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/).

## [0.3.0] - 2026-03-26

### Added

- **Unified tools**: `ask` (RAG search across all sources), `daily_briefing` (personalized knowledge briefing), `save_url` (web clipping with auto-embedding), `timeline` (chronological knowledge browsing)
- **Google AI embedding provider**: `text-embedding-004` (768d) with `setup-db-google.sql` and `setup-db-insights-google.sql` schemas
- **Dashboard app** (`dashboard/`): Next.js-based knowledge base management UI with React Query, XYFlow, CodeMirror, and Recharts
- **Agent-to-Agent (A2A) protocol**: Discovery at `/.well-known/agent.json` with task acceptance at `/.well-known/agent/tasks`
- **`INSIGHT_MODEL` configuration**: Separate model for insight synthesis (default: `claude-sonnet-4-6-20250514`)
- **Status dashboard**: Interactive HTML dashboard at `/status/dashboard` with service health, tool status, and real-time metrics

### Changed

- **Tool count**: 18 → 25 (added 4 unified tools, kept 3 Postgres analysis tools as documented)
- **Default `EXTRACTION_MODEL`**: Updated from `claude-3-haiku-20240307` to `claude-haiku-4-5-20250501`
- **Default `INSIGHT_DEBOUNCE_SECONDS`**: Changed from 10 to 300
- **`@modelcontextprotocol/sdk`**: Updated to ^1.26.0
- **MCP Apps support**: Added `@modelcontextprotocol/ext-apps` for search and stats UI resources

### Documentation

- Synced all documentation with 25 MCP tools across website, README, AGENTS.md, llms.txt, docs site
- Added Google AI embedding provider to all configuration docs (.env.example, README, configuration.mdx, architecture, concepts, embeddings)
- Created 7 new tool reference pages (ask, daily-briefing, save-url, timeline, pg-analyze, pg-recommendations, pg-report-history)
- Rewrote website MCP showcase with current tool names (replaced all deprecated names)
- Updated model references from Claude 3 to Claude 4.5/4.6 family across all docs
- Added missing env vars to .env.example (ENABLE_INSIGHTS, INSIGHT_MODEL, DATABASE_URL, PG_REPORT_DIR, Google AI vars)
- Fixed website tool count from 22 to 25
- Fixed docs site tool count from 18 to 25

### Dependencies

- Add `@modelcontextprotocol/ext-apps@^1.0.0` for MCP Apps support
- Add `@google/generative-ai@^0.24.1` for Google AI embeddings
- Add `hono@^4.11.7` web framework
- Update Next.js to 15.5.10, React to 19.0.3 in website
- Add dashboard workspace with Next.js 16, React Query, XYFlow, Recharts

## [0.2.0] - 2026-01-31

### Added

- **pnpm migration**: Enforce pnpm as package manager via preinstall hook; add desktop to pnpm workspace and update build config
- **Upload pipeline**: Optimize upload with batched embeddings, retry utility with exponential backoff, and runtime validation for frontmatter fields
- **Proactive insights system**: Discover cross-source connections with `get_insights`, `discover_connections`, `dismiss_insight`, and `insight_stats` tools; includes Ollama schemas (1024d and 768d)
- **OAuth 2.0 authentication**: Add Google OAuth provider with JWT verification, OAuth routes, configuration with validation, rate limiting on OAuth endpoints, and `jose` JWT library
- **Memory system (Phases 2–4)**: Implement `remember_fact`, `recall_memories`, `relate_entities`, `get_entity_context`, `list_entities`, `forget_entity`, `memory_stats`, and `extract_memories` tools
- **COMPACT_RESPONSES**: Token-efficient response format for all MCP tools (40–60% reduction); extend compact mode to all tools with shared helpers
- **Semantic chunking**: Add `nomic-embed-text-v2-moe` support and embedding-based topic splitting via `CHUNKING_MODE=semantic`
- **`knowledge_stats` tool**: Get overall knowledge base statistics
- **`contentType` filter and sorting**: Add to `list_documents` and `search_knowledge` tools
- **Social platform converters**: CLI converters for social platform exports
- **ZIP support**: Add ZIP file handling to Facebook converter
- **File preview/analysis mode**: Preview and analyze files in Web UI before conversion
- **Onboarding checklist**: Add checklist for common data exports
- **Fumadocs navbar**: Add HomeLayout pattern with navbar
- **Favicon**: Add anchor icon favicon set
- **MCP Apps UI**: Support for search and stats tools in MCP Apps interface
- **Desktop app**: Electron desktop app for file conversion with improved progress reporting
- **Web UI file support**: Add PDF, DOCX, TXT, MD file support
- **Documentation site**: Astro/Starlight site, then migrated to Fumadocs (Next.js 15); Vercel deployment workflows
- **Agent discovery files**: `AGENTS.md`, `.well-known/mcp.json`, `llms.txt`, `llms-full.txt` for MCP integration
- **Cursor IDE rules**: TypeScript, MCP tools, database, security, and documentation rules

### Fixed

- **Security**: Path traversal prevention, CodeQL high-severity fixes, CodeRabbit security feedback, ReDoS prevention in sentence splitting, dependabot vulnerability fixes, environment-aware trust proxy, inline path assertions for CodeQL compliance
- **OAuth**: Filter empty entries from email allowlist; fail fast on missing `GOOGLE_CLIENT_ID`
- **Database**: Propagate errors and add schema validation to insight tools; make memory RLS script idempotent and provider-agnostic; add DROP FUNCTION statements and memory table RLS
- **Semantic chunking**: Preserve original offsets in single-sentence fallback; address loop bound injection and oversized chunk handling
- **Memory**: Truncate memory content; match `EXTRACTION_MODEL` default to code
- **CI/CD**: Regenerate pnpm lockfile and fix pre-existing lint errors; resolve all lint, typecheck, and build issues; use `--no-frozen-lockfile` in CI; remove redundant pnpm version from workflows
- **Website**: Broken documentation links; fumadocs CSS imports and styling; dark mode class attribute; font imports (Nyght Serif, Switzer); homepage Get Started link; Next.js security patches (CVE-2025-66478)
- **Desktop**: Improve conversion completion reporting
- **UI server**: Load dotenv before config

### Changed

- **Refactor**: Apply CodeRabbit review suggestions across codebase; separate memory RLS into dedicated script
- **Performance**: Optimize memory tool responses for token efficiency; add latency timing to memory tool operations
- **Style**: Apply biome formatting to CLI upload scripts

### Documentation

- Sync all documentation with 22 implemented MCP tools across website, README, AGENTS.md, llms.txt
- Update website homepage and docs; clean up structure and roadmap
- Add memory tools, compact/verbose response examples, and Ollama references
- Cloud Run deployment guide with secret management
- PR workflow instructions in CLAUDE.md
- Update all npm references to pnpm with project conventions
- Comprehensive docs and playground framework
- January 2026 technology advancement research

### Dependencies

- Pin `@modelcontextprotocol/sdk` to ^1.25.2
- Update dependencies for security vulnerabilities
- Add `jose` JWT library
- Update Next.js to 15.3.8, React for security patches
- Update desktop dependencies
