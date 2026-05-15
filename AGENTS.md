# AGENTS.md

Agent/developer operating guide for Textrawl.

**For the full reference (commands, architecture, conventions, AX rules), see [CLAUDE.md](CLAUDE.md).** This file holds only items that are agent-specific or not yet folded into CLAUDE.md.

## Onboarding (first run)

```bash
pnpm install
pnpm setup
pnpm dev
# optional
pnpm desktop:dev
pnpm inspector
```

## Safety rules

- Never log, print, or commit `SUPABASE_SERVICE_KEY` or `API_BEARER_TOKEN`.
- Keep server-only secrets server-side. Do not place service-role credentials in desktop renderer code, website bundles, or client config files.
- Treat desktop distribution as client-like: only call server APIs from the desktop app, never embed privileged Supabase keys.

## MCP tool inventory

Kept here so `scripts/tool-sync-check.sh` can verify the list stays in sync with `src/tools/` and `README.md`. See CLAUDE.md for groupings and `README.md` for full descriptions.

- Document/search: `search`, `get_document`, `list_documents`, `update_document`, `add_note`
- Memory: `remember_fact`, `build_knowledge`, `query_memory`, `relate_entities`, `forget_entity`, `extract_memories`
- Conversation: `save_conversation_context`, `query_conversations`, `delete_conversation`
- Insights: `get_insights`, `discover_connections`, `dismiss_insight`
- Stats: `get_stats`, `health_check`
- Unified: `ask`, `daily_briefing`, `save_url`, `timeline`
- Postgres: `pg_analyze`, `pg_recommendations`, `pg_report_history`

## Repo-specific gotchas

- **CodeQL mode**: this repo uses the advanced workflow in `.github/workflows/codeql.yml`. Keep GitHub Code Scanning **Default Setup disabled** in repo settings — enabling it causes SARIF processing conflicts.
- **`pnpm`-only**: `preinstall` runs `only-allow pnpm`; npm/yarn installs will fail.
- **MCP stdout**: any `console.log` in the MCP request path corrupts JSON-RPC. Use `logger` from `src/utils/logger.js`.
