# Decisions (AX-focused)

## Accepted now (least-change defaults)

1. **Canonical gates command: `pnpm verify`**
   - Includes lint, markdown lint, typecheck, test, build, docs build.
   - CI calls this single command.

2. **Fast local pre-commit gate: `pnpm verify:fast`**
   - No network-dependent checks by default.
   - Keeps local feedback quick while still enforcing core hygiene.

3. **No product behavior changes in this AX pass**
   - MCP tool names/schemas remain stable.
   - Existing auth/rate-limit/feature-flag behavior unchanged.

## Decisions deferred (need product input)

1. **Default Ollama model migration (`nomic-embed-text` → `nomic-embed-text-v2-moe`)**
   - Tradeoff: better multilingual quality vs required schema/vector migration.

2. **RLS policy strictness for multi-tenant deployments**
   - Tradeoff: stronger tenant isolation vs current single-tenant service-role simplicity.

3. **Cross-source search default (`includeMemories/includeConversations`)**
   - Tradeoff: richer recall vs extra latency/token cost.

## Why

- Keep backward compatibility and avoid unrequested core behavior changes.
- Align with MCP compatibility expectations and stable tool contracts. <https://modelcontextprotocol.io>
- Keep Supabase service-role usage constrained to trusted server contexts. <https://supabase.com/docs/guides/api/api-keys>
