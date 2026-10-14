# Changelog

All notable changes to Textrawl are documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/).

## [0.4.1](https://github.com/jeffgreendesign/textrawl/compare/textrawl-v0.4.0...textrawl-v0.4.1) (2026-10-14)


### Features

* **cli:** support Google AI embedding provider in upload config ([365bf62](https://github.com/jeffgreendesign/textrawl/commit/365bf62d17f823b5757c6abe34dba1789cd85dfb))
* **config:** move insight/extraction models to the current generation ([baf0917](https://github.com/jeffgreendesign/textrawl/commit/baf0917979017f6ed7b06d49557df6d7420d9aed))
* **dashboard:** migrate knowledge table to @tanstack/react-table 9 ([#176](https://github.com/jeffgreendesign/textrawl/issues/176)) ([9f1eee5](https://github.com/jeffgreendesign/textrawl/commit/9f1eee59c5b5ed02677b5328a429485f0a9a6f50))
* **deps:** upgrade dashboard and website to Next.js 16 and the docs site to Fumadocs 16 ([#177](https://github.com/jeffgreendesign/textrawl/issues/177)) ([5926669](https://github.com/jeffgreendesign/textrawl/commit/59266698d1ef2b24bc74c5dba869f65f9348a6a5))
* **desktop:** point uploads at Neon with configurable embedding provider ([a09a784](https://github.com/jeffgreendesign/textrawl/commit/a09a784df72f273ca22538457d4bd12338c0f565))
* **insights:** add pnpm insights:backfill CLI ([052930b](https://github.com/jeffgreendesign/textrawl/commit/052930b5f273f6739a4ad8ed3769f00d1367ca86))
* **insights:** add synchronous POST /api/insights/scan endpoint ([965112f](https://github.com/jeffgreendesign/textrawl/commit/965112f86d7ae96eb39dda39f97ea0abe1517acb))
* **insights:** dedicated INSIGHT_SCAN_TOKEN for the scan endpoint ([4d287d1](https://github.com/jeffgreendesign/textrawl/commit/4d287d15d1eb701a279b4e0e6a3da3a0c802e254))
* **utils:** add source-span resolver for claim-packet provenance ([13f803b](https://github.com/jeffgreendesign/textrawl/commit/13f803b23d418e7f70b1d9bb220c19326785b4b7))


### Bug Fixes

* **ci:** deploy docs from repo root to match Vercel root directory ([4384028](https://github.com/jeffgreendesign/textrawl/commit/4384028d18a141ff53accdf3cbe6e0d439b365ef))
* **ci:** install current Vercel CLI in docs deploy ([52c126e](https://github.com/jeffgreendesign/textrawl/commit/52c126e7db3f8123b6eb5f764af95ecd5991c3e2))
* **db:** await pgvector HNSW tuning before serving queries ([cb848a6](https://github.com/jeffgreendesign/textrawl/commit/cb848a6b218f7595cd7787e05a18d226242a3ed1))
* **deps:** bound Dependabot groups to minor and patch updates ([#132](https://github.com/jeffgreendesign/textrawl/issues/132)) ([ffe79b1](https://github.com/jeffgreendesign/textrawl/commit/ffe79b1504cf90abb06fff35faeb05250e9d7d18))
* **deps:** bump csv-parse to 7 in the desktop app ([#175](https://github.com/jeffgreendesign/textrawl/issues/175)) ([b353e7c](https://github.com/jeffgreendesign/textrawl/commit/b353e7cbf7c2bfa5c733058405b6217e6bbf57f4))
* **deps:** move p-limit to dependencies so the server container starts ([#165](https://github.com/jeffgreendesign/textrawl/issues/165)) ([fc0b470](https://github.com/jeffgreendesign/textrawl/commit/fc0b470097b216867bf21dd3ba487eefccbcbaac))
* **deps:** patch multer DoS and file-size-bypass advisories ([#128](https://github.com/jeffgreendesign/textrawl/issues/128)) ([b8306c9](https://github.com/jeffgreendesign/textrawl/commit/b8306c9d55244764798ef92eb6af06528e9f88d0))
* **deps:** patch Next.js RCE and SSRF advisories in dashboard and website ([#127](https://github.com/jeffgreendesign/textrawl/issues/127)) ([4dea703](https://github.com/jeffgreendesign/textrawl/commit/4dea703ddb35df1171459dcd312370458aecdef9))
* **deps:** point Dependabot npm at the workspace root only ([#154](https://github.com/jeffgreendesign/textrawl/issues/154)) ([49f397c](https://github.com/jeffgreendesign/textrawl/commit/49f397ccbca87be0ebc803d6e1e6056e7f3334c5))
* **google:** make the Google AI embedding provider usable ([b8dc9ce](https://github.com/jeffgreendesign/textrawl/commit/b8dc9ce41aa90f5755b9ee45cbb8849b1df787bc))
* **google:** make the Google AI embedding provider usable ([81ea557](https://github.com/jeffgreendesign/textrawl/commit/81ea557d1ecde96045bf2554853634a97fd20720))
* **google:** self-migrate existing installs; make schema re-runs idempotent ([3d6ef46](https://github.com/jeffgreendesign/textrawl/commit/3d6ef46e0f4553b8ba6f9bb8aaf4c38ed8617083))
* **insights:** add stale-lock recovery to the scan queue ([081a259](https://github.com/jeffgreendesign/textrawl/commit/081a2591f604df9b32a7a33c3f14d96c0d6d82f9))
* **insights:** correct similarity field + cross-doc query + entities JSON ([91019c1](https://github.com/jeffgreendesign/textrawl/commit/91019c16bcf59c903ea0a25706e3eaa324483e95))
* **insights:** parse DB-read embeddings so semantic_search works ([5bf9e07](https://github.com/jeffgreendesign/textrawl/commit/5bf9e07662978c2bc57ec3152575636e34f66589))
* **release:** sync release-please manifest to 0.4.0 ([bb03633](https://github.com/jeffgreendesign/textrawl/commit/bb03633ac8c46c56ed826d35ed0110acf84327b3))
* resolve failed CI runs (release-please manifest + docs deploy CLI) ([c6227b1](https://github.com/jeffgreendesign/textrawl/commit/c6227b1c32ee07742d00aafae27f5227c533a3c8))
* **review:** address CodeRabbit + CodeQL findings on PR [#119](https://github.com/jeffgreendesign/textrawl/issues/119) ([13334f9](https://github.com/jeffgreendesign/textrawl/commit/13334f90563a0a162eefca4e2851a2d6ae5c93e3))


### Performance

* **ingest,search:** bounded embedding concurrency + tunable HNSW ef_search ([69f2da9](https://github.com/jeffgreendesign/textrawl/commit/69f2da923ce57a3869dab38e008e0125a51af798))
* **search:** parallelize cross-source searches and cache query embeddings ([faead7e](https://github.com/jeffgreendesign/textrawl/commit/faead7e1ae3f3203403fc4d2779194b784b63c37))
* **search:** parallelize cross-source searches and cache query embeddings ([86b07a3](https://github.com/jeffgreendesign/textrawl/commit/86b07a377bf184ddbcf59b8b20575b9cfefba2ad))
* **search:** push categorical filters into hybrid_search SQL + pgvector 0.8 iterative scans ([935b363](https://github.com/jeffgreendesign/textrawl/commit/935b363f5ea4f585ea309750b11b1148e89038d5))


### Refactoring

* **insights:** remove dead/broken in-process scan paths ([af46c8c](https://github.com/jeffgreendesign/textrawl/commit/af46c8c3a7d38f019274bbf591dcaf449e5070c9))
* **insights:** shared scan core, concurrent neighbor search, dedup ([bd24b7d](https://github.com/jeffgreendesign/textrawl/commit/bd24b7dc834b18261075a28616b9e6f0b404b0c7))
* **pdf:** replace unmaintained pdf-parse with unpdf (server + CLI) ([196eb8c](https://github.com/jeffgreendesign/textrawl/commit/196eb8c669391a2eaaec32e7feaaf7c4bd3f304b))


### Documentation

* **cli:** correct split --output default to match CLI sentinel behavior ([fbdac20](https://github.com/jeffgreendesign/textrawl/commit/fbdac20c1c9f1e907298cb425375f08fb7cb0e5e))
* **readme:** drop feature claims with no implementation ([47a047c](https://github.com/jeffgreendesign/textrawl/commit/47a047cab52a88135def3173c803ed511b3d49a2))


### Miscellaneous

* add Dependabot config ([#103](https://github.com/jeffgreendesign/textrawl/issues/103)) ([eaa31f3](https://github.com/jeffgreendesign/textrawl/commit/eaa31f3f18711bda4b784d001a107d4af689ce32))
* **ci:** serialize release-please runs ([#162](https://github.com/jeffgreendesign/textrawl/issues/162)) ([b6f4f62](https://github.com/jeffgreendesign/textrawl/commit/b6f4f62a283653bb133b8f63b9a0e5603dae212c))
* **cleanup:** drop dead services, complete the tools barrel, unpin hono ([43b8b1d](https://github.com/jeffgreendesign/textrawl/commit/43b8b1d98220b80ec09107998c5387107330a56a))
* **deps-dev:** bump electron from 39.8.10 to 41.10.6 ([#152](https://github.com/jeffgreendesign/textrawl/issues/152)) ([56a0040](https://github.com/jeffgreendesign/textrawl/commit/56a00408a1729a9bfa1cdd45493879a2bcf23362))
* **deps-dev:** bump esbuild from 0.28.1 to 0.28.2 ([#138](https://github.com/jeffgreendesign/textrawl/issues/138)) ([78da3d3](https://github.com/jeffgreendesign/textrawl/commit/78da3d3b4ca123d1751ea6438f043c9c63f9dc63))
* **deps-dev:** bump sanitize-html from 2.17.6 to 2.17.7 ([#142](https://github.com/jeffgreendesign/textrawl/issues/142)) ([385a6df](https://github.com/jeffgreendesign/textrawl/commit/385a6df1885d3af12ec03fff63706bdac967db81))
* **deps-dev:** bump the development-dependencies group with 13 updates ([#158](https://github.com/jeffgreendesign/textrawl/issues/158)) ([49f45b7](https://github.com/jeffgreendesign/textrawl/commit/49f45b75361c33e5559bb69fc1d86a636e5d49e0))
* **deps-dev:** bump the npm_and_yarn group across 1 directory with 2 updates ([#125](https://github.com/jeffgreendesign/textrawl/issues/125)) ([19a92f9](https://github.com/jeffgreendesign/textrawl/commit/19a92f9c0d896ea3d1b26cc6c1ac0418b1ea6f02))
* **deps:** bump dotenv from 17.4.2 to 18.0.7 ([#170](https://github.com/jeffgreendesign/textrawl/issues/170)) ([b2dc127](https://github.com/jeffgreendesign/textrawl/commit/b2dc127d79a5fc6a6132c0c55b325428611ffc13))
* **deps:** bump next from 15.5.25 to 15.5.27 ([#163](https://github.com/jeffgreendesign/textrawl/issues/163)) ([59f05cc](https://github.com/jeffgreendesign/textrawl/commit/59f05ccc853e7cf8615b8bae3f5dcd1ffef99519))
* **deps:** bump the github-actions group across 1 directory with 6 updates ([#166](https://github.com/jeffgreendesign/textrawl/issues/166)) ([98490d7](https://github.com/jeffgreendesign/textrawl/commit/98490d70437f785eae3117052d44f18548510977))
* **deps:** bump the production-dependencies group across 1 directory with 23 updates ([#151](https://github.com/jeffgreendesign/textrawl/issues/151)) ([2a0f252](https://github.com/jeffgreendesign/textrawl/commit/2a0f252f790a4cd1e36acbbe311fb34ddb5c6713))
* **deps:** bump the production-dependencies group across 1 directory with 8 updates ([#172](https://github.com/jeffgreendesign/textrawl/issues/172)) ([ec8bf15](https://github.com/jeffgreendesign/textrawl/commit/ec8bf154101987636304b785331f5f8bf042c10a))
* **deps:** bump the production-dependencies group with 6 updates ([#157](https://github.com/jeffgreendesign/textrawl/issues/157)) ([2b353f0](https://github.com/jeffgreendesign/textrawl/commit/2b353f07ec09065aa0582eb42e7de53c6fa837c4))
* **deps:** major-version upgrades across server and CLI ([e79c997](https://github.com/jeffgreendesign/textrawl/commit/e79c9977b615bc6c287362e51fa00a145cb3ecc4))
* **deps:** patch security advisories on reachable dependencies ([7b508ab](https://github.com/jeffgreendesign/textrawl/commit/7b508abaa3c825608599ad817311efdfbbecfcb5))
* **deps:** upgrade Biome 1.9 -&gt; 2.5 ([98f0ed5](https://github.com/jeffgreendesign/textrawl/commit/98f0ed5b4d4fe9c60143ca1582293c57411113d9))
* **deps:** upgrade TypeScript 5.7 -&gt; 7.0 ([d2f8875](https://github.com/jeffgreendesign/textrawl/commit/d2f8875ff6c0a1c8e9b88ff651836548b6593b07))
* **deps:** upgrade zod v3 -&gt; v4 ([6f245de](https://github.com/jeffgreendesign/textrawl/commit/6f245de24887d2dbf4ea3e6bdfcfc1300e7d84db))
* **insights:** record applied stale-lock migration ([3721159](https://github.com/jeffgreendesign/textrawl/commit/3721159dd1edc5614f2e8dffceca49788f2931dc))
* **release:** anchor release-please at the 0.4.0 commit ([#178](https://github.com/jeffgreendesign/textrawl/issues/178)) ([6fc945d](https://github.com/jeffgreendesign/textrawl/commit/6fc945d203dd23ac33178074054f17b4928c9886))

## [0.4.0] - 2026-06-13

### Added

- **Large-upload pipeline**: GCS-backed resumable upload sessions (server initiates the session, the browser PUTs directly to the returned URI) with `/api/upload/init` and `/api/upload/complete`, an idempotent upload state machine, and the `uploads` / `upload_entries` metadata schema (`scripts/setup-db-uploads.sql`)
- **Cloud Tasks processing**: background processing queue with OIDC authentication and dedupe, plus an internal Cloud Run processing endpoint for async single-file ingestion
- **Processor handler registry**: pluggable converter registry covering Tier-1 file types (pdf, docx, html, xlsx, csv, json, text) with safe streaming ZIP extraction
- **Dashboard resumable upload UX**: large-upload flow that resolves at `queued` so processing runs in the background, an honest file-type support matrix, and clear structured upload errors
- **`scan` and `split` CLI commands**: analyze converted markdown for upload readiness and split oversized files at heading boundaries before upload
- **Social export converters**: Spotify, Reddit, Facebook, and Instagram data-export converters
- **Optional Redis-backed rate limiting**: set `REDIS_URL` to share rate-limit counters across server instances (falls back to in-memory)
- **`health_check` MCP tool**: per-component diagnostic (database, documents, chunks, memory, conversations, insights) — tool count is now 26

### Changed

- **Google AI embedding default** → `gemini-embedding-2-preview` (3072 dimensions). **Breaking**: changing from the previous `text-embedding-004` (768d) requires re-embedding all documents with `scripts/setup-db-google.sql`
- **Default `EXTRACTION_MODEL`** → `claude-haiku-4-5-20251001`
- **Provider resilience**: retry transient embedding/Anthropic failures with exponential backoff; Ollama fetch timeout with typed provider errors
- **Bounded ingestion memory**: cap memory across the upload→process pipeline and defer per-document memory extraction off the processing critical path

### Fixed

- Chunker O(n) force-split to stop OOM on large single-paragraph text
- Keep OpenAI embedding batches under the 300K-token request cap
- Tolerate truncated/fenced LLM JSON during memory extraction; raise extraction `max_tokens`
- Return structured JSON for Multer/413/file-type upload errors; wire `MAX_SINGLE_FILE_SIZE_MB` into the multer limit
- Dashboard: derive the WebSocket URL from the API base (no localhost fallback in production), route ZIP uploads through the resumable path, and suppress the React #418 hydration warning
- Move `unzipper` to runtime dependencies so ZIP processing boots on Cloud Run
- Remove a dead xlsx budget assignment flagged by CodeQL

### Documentation

- Synced docs to code: replaced Supabase setup with Neon / `DATABASE_URL` across installation, configuration, RUNBOOK, troubleshooting, Docker and Cloud Run guides, and per-tool error tables
- Corrected the Google AI embedding model and dimensions (3072d) across all documentation
- Added the `health_check` tool reference and updated the tool count from 25 to 26
- Added `scan` and `split` CLI reference pages and documented the Spotify/Reddit/Facebook/Instagram converters
- Added an Agent-to-Agent (A2A) protocol reference page
- Archived completed implementation plans (`docs/plans/`) and the improvement tracker to `docs/archive/`

### Dependencies

- Add `@google-cloud/storage` for GCS resumable uploads
- Add `@google-cloud/tasks` and `google-auth-library` for Cloud Tasks queueing and OIDC
- Add `redis` and `rate-limit-redis` for optional shared rate limiting
- Move `unzipper` to runtime dependencies

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
