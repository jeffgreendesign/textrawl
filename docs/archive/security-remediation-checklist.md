---
title: Security Remediation Checklist
description: Self-contained tasks for remediating findings from the security audit, executable in independent context windows
date: 2026-02-02
---

# Security Remediation Checklist

**Source:** `docs/archive/security-audit-2026-02.md`
**Created:** 2026-02-02

Each task below is self-contained and can be completed in an independent context window. Tasks are ordered by priority. Each task lists the exact files to modify, the current problematic state, and what the fix should look like.

Run `pnpm quality` (lint + typecheck) after any TypeScript changes. SQL changes cannot be automatically tested but should be reviewed for syntax.

---

## Task 1: Inline RLS into base schema files (HIGH)

**Problem:** `scripts/setup-db.sql` and its Ollama variants have zero RLS. Users who skip the separate `security-rls.sql` script have all data exposed through Supabase's public PostgREST API.

**Files to modify:**

- `scripts/setup-db.sql`
- `scripts/setup-db-ollama.sql`
- `scripts/setup-db-ollama-v2.sql`

**What to do:**

Append a new section at the end of each file (before the storage bucket comment in `setup-db.sql`) that matches the pattern already used in `scripts/setup-db-conversation.sql:318-364`. Specifically, for tables `documents` and `chunks`:

```sql
-- Row Level Security
ALTER TABLE documents ENABLE ROW LEVEL SECURITY;
ALTER TABLE chunks ENABLE ROW LEVEL SECURITY;

ALTER TABLE documents FORCE ROW LEVEL SECURITY;
ALTER TABLE chunks FORCE ROW LEVEL SECURITY;

-- Service role access (service_role bypasses RLS, but explicit grant is clearer)
CREATE POLICY "Allow service_role access to documents"
  ON documents FOR ALL TO service_role
  USING (true) WITH CHECK (true);

CREATE POLICY "Allow service_role access to chunks"
  ON chunks FOR ALL TO service_role
  USING (true) WITH CHECK (true);

-- Block anon and authenticated roles
CREATE POLICY "Deny anon access to documents"
  ON documents AS RESTRICTIVE FOR ALL TO anon USING (false);

CREATE POLICY "Deny authenticated access to documents"
  ON documents AS RESTRICTIVE FOR ALL TO authenticated USING (false);

CREATE POLICY "Deny anon access to chunks"
  ON chunks AS RESTRICTIVE FOR ALL TO anon USING (false);

CREATE POLICY "Deny authenticated access to chunks"
  ON chunks AS RESTRICTIVE FOR ALL TO authenticated USING (false);

-- Revoke permissions
REVOKE ALL ON TABLE documents FROM anon, authenticated;
REVOKE ALL ON TABLE chunks FROM anon, authenticated;

-- Revoke function execution from public
REVOKE EXECUTE ON FUNCTION hybrid_search FROM PUBLIC;
REVOKE EXECUTE ON FUNCTION semantic_search FROM PUBLIC;

-- Explicit service_role function grants
GRANT EXECUTE ON FUNCTION hybrid_search TO service_role;
GRANT EXECUTE ON FUNCTION semantic_search TO service_role;
```

**Note:** The function signatures differ by file (vector dimension: 1536, 1024, or 768). Adjust the `REVOKE`/`GRANT` function names to match whatever functions exist in each file.

**Also update:** `scripts/security-rls.sql` header comment to note that RLS is now applied inline, and this script is for existing installations that were set up before the change.

**Verification:** Run each SQL file in a Supabase SQL Editor on a test project and confirm no syntax errors. Verify `SELECT tablename, rowsecurity FROM pg_tables WHERE schemaname = 'public'` shows `true` for documents and chunks.

---

## Task 2: Inline RLS into memory schema files (HIGH)

**Problem:** `scripts/setup-db-memory.sql` has RLS commented out. Its Ollama variant likely has the same issue.

**Files to modify:**

- `scripts/setup-db-memory.sql`
- `scripts/setup-db-memory-ollama.sql`

**What to do:**

Same pattern as Task 1, but for tables `memory_entities`, `memory_observations`, `memory_relations`. Uncomment and fix the existing RLS section at the bottom of `setup-db-memory.sql` (around line 299). For memory functions, use `DO $$ ... EXCEPTION WHEN undefined_function` blocks as already done in `scripts/security-rls-memory.sql:114-145`.

Add `REVOKE EXECUTE ON FUNCTION ... FROM PUBLIC` for all functions defined in each file:

- `memory_semantic_search`
- `memory_hybrid_search`
- `get_entity_context`
- `cleanup_expired_observations`

**Also update:** `scripts/security-rls-memory.sql` header comment to note this is now for existing installations.

---

## Task 3: Scope permissive RLS policies to service_role (HIGH)

**Problem:** All existing permissive policies use `USING (true)` without a `TO <role>` clause, granting access to every Postgres role (including future custom roles).

**Files to modify:**

- `scripts/security-rls.sql:30-34, 54-58`
- `scripts/security-rls-memory.sql:34-38, 59-63, 84-88`
- `scripts/setup-db-conversation.sql:327-328, 330-331`
- `scripts/setup-db-conversation-ollama.sql` (same pattern)
- `scripts/setup-db-conversation-ollama-v2.sql` (same pattern)
- `scripts/setup-db-insights.sql` (no permissive policy exists — add one for service_role)
- `scripts/setup-db-insights-ollama.sql` (same)
- `scripts/setup-db-insights-ollama-v2.sql` (same)

**What to change:**

Every instance of:

```sql
CREATE POLICY "Allow all access to <table>"
  ON <table> FOR ALL
  USING (true) WITH CHECK (true);
```

Should become:

```sql
CREATE POLICY "Allow service_role access to <table>"
  ON <table> FOR ALL TO service_role
  USING (true) WITH CHECK (true);
```

The key addition is `TO service_role`. This ensures only the service role gets the permissive grant.

For the **insight tables** (`scripts/setup-db-insights.sql:141-152`), there is currently no permissive policy — only deny policies. Add a `TO service_role` permissive policy for `insight_queue` and `proactive_insights` for consistency with other tables.

---

## Task 4: Revoke function execute from PUBLIC in schema files (HIGH)

**Problem:** PostgreSQL grants `EXECUTE` to `PUBLIC` by default on all functions. The base schemas create functions without revoking this, leaving them callable by `anon` via PostgREST `/rpc/` endpoints until a separate security script is run.

**Files to modify:**

- `scripts/setup-db.sql` — functions: `hybrid_search`, `semantic_search`, `update_updated_at`
- `scripts/setup-db-ollama.sql` — same functions (different vector dimensions)
- `scripts/setup-db-ollama-v2.sql` — same functions (different vector dimensions)
- `scripts/setup-db-memory.sql` — functions: `memory_semantic_search`, `memory_hybrid_search`, `get_entity_context`, `cleanup_expired_observations`
- `scripts/setup-db-memory-ollama.sql` — same memory functions
- `scripts/setup-db-insights.sql` — functions: `insight_queue_increment`, `insight_queue_check`, `insight_semantic_search`
- `scripts/setup-db-insights-ollama.sql` — same insight functions
- `scripts/setup-db-insights-ollama-v2.sql` — same insight functions

**What to do:**

After each `CREATE OR REPLACE FUNCTION ... $$ ;` block, add:

```sql
REVOKE EXECUTE ON FUNCTION <function_name> FROM PUBLIC;
GRANT EXECUTE ON FUNCTION <function_name> TO service_role;
```

This is already partially done in the conversation schemas. Apply the same pattern everywhere.

**Note:** For overloaded functions (same name, different vector dimensions), make sure to use the full signature in the REVOKE/GRANT.

---

## Task 5: Update hono dependency (HIGH)

**Problem:** `hono` is pinned at `^4.11.4` via a pnpm override in `package.json:88`. Four moderate vulnerabilities (XSS, cache deception, IP spoofing, arbitrary key read) are fixed in `>=4.11.7`.

**Files to modify:**

- `package.json` — line 42 (dependency) and line 88 (pnpm override)

**What to do:**

Change both occurrences of `"hono": "^4.11.4"` to `"hono": "^4.11.7"`.

Then run:

```bash
pnpm install
pnpm quality
```

Verify with `pnpm audit` that hono vulnerabilities are resolved.

---

## Task 6: Evaluate and update remaining vulnerable dependencies (HIGH)

**Problem:** `pnpm audit` reports additional high/moderate vulnerabilities.

**Packages to investigate:**

- `xlsx` (SheetJS) — 2 HIGH: Prototype Pollution, ReDoS. Patched versions show `<0.0.0` meaning no fix available in the npm registry. Evaluate whether this dep is needed; if so, consider `exceljs` or `sheetjs-ce` alternatives.
- `tar` — 3 HIGH: Arbitrary file overwrite, race condition, hardlink path traversal. Patched in `>=7.5.7`. Check which package pulls this in and whether it can be updated.
- `fast-xml-parser` — 1 HIGH: RangeError DoS. Patched in `>=5.3.4`. Check which package pulls this in.
- `esbuild` — 1 MODERATE: SSRF in dev server. Patched in `>0.24.2`. Dev-only risk.
- `electron` — 1 MODERATE: ASAR integrity bypass. Patched in `>=35.7.5`. Desktop app only.
- `next` — 1 MODERATE: Unbounded memory via PPR. Patched in `>=15.6.0-canary.61`. Website only.

**What to do:**

For each package:

1. Run `pnpm why <package>` to find which direct dependency pulls it in
2. Check if the direct dependency has a newer version with the fix
3. If updatable, bump the version in `package.json` or relevant workspace `package.json`
4. If not updatable, add a pnpm override if appropriate, or document as accepted risk
5. Run `pnpm install && pnpm quality` after changes

---

## Task 7: Make security-check.sh block commits on errors (MEDIUM)

**Problem:** `scripts/security-check.sh:92-94` always exits 0, even when security issues are found.

**File to modify:**

- `scripts/security-check.sh`

**What to change:**

Line 94 currently reads:

```bash
exit 0
```

Change the exit logic (lines 85-95) to:

```bash
if [ $ISSUES_FOUND -eq 0 ]; then
    echo -e "${GREEN}Security checks passed!${NC}"
    exit 0
else
    echo ""
    echo -e "${RED}Security checks failed.${NC}"
    echo "Please review the issues above and fix them before committing."
    exit 1
fi
```

**Also expand file type coverage** (line 33, 51, 61): Change `grep -E '\.ts$'` to `grep -E '\.(ts|js|mjs|cjs)$'` in all three pattern-checking sections to also catch JavaScript files.

**Verification:** Stage a file containing `path.join(req.body.foo)` and verify the commit is blocked.

---

## Task 8: Use timing-safe comparison for PKCE (MEDIUM)

**Problem:** `src/api/oauth/pkce.ts:4` uses `===` for PKCE code challenge comparison instead of `timingSafeEqual`.

**File to modify:**

- `src/api/oauth/pkce.ts`

**Current code:**

```typescript
import { createHash } from 'node:crypto';

export function verifyPkce(codeVerifier: string, codeChallenge: string): boolean {
 const computed = createHash('sha256').update(codeVerifier).digest('base64url');
 return computed === codeChallenge;
}
```

**Replace with:**

```typescript
import { createHash, timingSafeEqual } from 'node:crypto';

export function verifyPkce(codeVerifier: string, codeChallenge: string): boolean {
 const computed = createHash('sha256').update(codeVerifier).digest('base64url');
 if (computed.length !== codeChallenge.length) {
  return false;
 }
 return timingSafeEqual(Buffer.from(computed), Buffer.from(codeChallenge));
}
```

**Verification:** `pnpm quality` must pass. Manually test OAuth flow via `pnpm inspector` if OAuth is configured.

---

## Task 9: Shorten OAuth token lifetime (MEDIUM)

**Problem:** Access tokens are valid for 30 days with no revocation mechanism. A compromised token remains usable for the full period.

**File to modify:**

- `src/api/oauth/routes.ts:199, 206`

**What to change:**

Reduce token lifetime from `'30d'` to `'7d'` on line 199:

```typescript
const accessToken = await signJwt({ sub: authCode.email }, '7d');
```

Update `expires_in` on line 206:

```typescript
expires_in: 7 * 24 * 60 * 60, // 7 days in seconds
```

**Note:** A more comprehensive solution would add refresh tokens, but reducing the lifetime is a meaningful standalone improvement.

**Verification:** `pnpm quality` must pass.

---

## Task 10: Add placeholder detection for bearer tokens (MEDIUM)

**Problem:** The `.env.example` placeholder `your-64-character-hex-token-here` (35 chars) passes the 32-char minimum validation and could be accidentally deployed.

**File to modify:**

- `src/utils/config.ts:17-24`

**What to change:**

After the existing `.regex()` check on `API_BEARER_TOKEN`, add a `.refine()`:

```typescript
API_BEARER_TOKEN: z
    .string()
    .min(32, 'API_BEARER_TOKEN must be at least 32 characters')
    .regex(
        /^[a-zA-Z0-9_-]+$/,
        'API_BEARER_TOKEN must contain only alphanumeric characters, underscores, and hyphens',
    )
    .refine(
        (val) => !/^your-|^placeholder|^change-me|^example|^replace/i.test(val),
        'API_BEARER_TOKEN appears to be a placeholder value — generate a real token with: openssl rand -hex 32',
    )
    .optional(),
```

**Verification:** `pnpm quality` must pass. Test that setting `API_BEARER_TOKEN=your-64-character-hex-token-here` in `.env` causes a startup validation failure.

---

## Task 11: Document Redis requirement for multi-instance rate limiting (MEDIUM)

**Problem:** `express-rate-limit` uses an in-memory store by default, which doesn't work across multiple Cloud Run instances.

**Files to modify:**

- `docs/guides/security-hardening.mdx` (or equivalent deployment docs)
- `README.md` — deployment section if one exists

**What to do:**

Add a note in the deployment/security documentation:

> **Multi-Instance Deployments:** The default rate limiter uses an in-memory store that is not shared across instances. If deploying multiple replicas (e.g., Cloud Run with `--max-instances > 1`), rate limits are per-instance. For shared rate limiting, configure a Redis-backed store using `rate-limit-redis`. See [express-rate-limit stores](https://github.com/express-rate-limit/express-rate-limit#store).

No code changes required for this task — documentation only.

---

## Task 12: Restrict MCP endpoint to POST only (LOW)

**Problem:** `src/index.ts:87` uses `app.all('/mcp', ...)` which accepts all HTTP methods. MCP only uses POST.

**File to modify:**

- `src/index.ts:87`

**What to change:**

Replace:

```typescript
app.all('/mcp', apiLimiter, bearerAuth, async (req, res) => {
```

With:

```typescript
app.post('/mcp', apiLimiter, bearerAuth, async (req, res) => {
```

Also remove the debug log for `req.method` on line 88 since it's now always POST, or keep it for consistency — either is fine.

**Verification:** `pnpm quality` must pass. Test with `pnpm inspector` to confirm MCP still works (inspector uses POST).

---

## Task 13: Add FORCE ROW LEVEL SECURITY to insight tables (LOW)

**Problem:** `scripts/setup-db-insights.sql:142-143` enables RLS but doesn't `FORCE` it, meaning the table owner (`postgres`) bypasses RLS.

**Files to modify:**

- `scripts/setup-db-insights.sql`
- `scripts/setup-db-insights-ollama.sql`
- `scripts/setup-db-insights-ollama-v2.sql`

**What to add** after the existing `ENABLE ROW LEVEL SECURITY` lines:

```sql
ALTER TABLE insight_queue FORCE ROW LEVEL SECURITY;
ALTER TABLE proactive_insights FORCE ROW LEVEL SECURITY;
```

Also add explicit service_role grants for insight functions:

```sql
GRANT EXECUTE ON FUNCTION insight_queue_increment TO service_role;
GRANT EXECUTE ON FUNCTION insight_queue_check TO service_role;
GRANT EXECUTE ON FUNCTION insight_semantic_search TO service_role;
```

---

## Task 14: Validate OAuth redirect URIs against allowlist (LOW)

**Problem:** `src/api/oauth/routes.ts:65-70` accepts any `redirect_uri` without validating it against a known allowlist.

**Files to modify:**

- `src/utils/config.ts` — add new env var
- `src/api/oauth/routes.ts` — add validation
- `.env.example` — document the new var

**What to do:**

1. In `config.ts`, add to the Zod schema:

```typescript
OAUTH_ALLOWED_REDIRECT_URIS: z.string().optional(),
```

1. In `routes.ts`, after the existing parameter validation in the `/authorize` handler (~line 63), add:

```typescript
// Validate redirect_uri against allowlist
const allowedRedirectUris = config.OAUTH_ALLOWED_REDIRECT_URIS
    ?.split(',')
    .map((u) => u.trim())
    .filter(Boolean) ?? [];

if (allowedRedirectUris.length > 0 && !allowedRedirectUris.includes(params.redirect_uri)) {
    throw new ValidationError('redirect_uri is not in the allowed list');
}
```

1. In `.env.example`, add:

```bash
# Comma-separated list of allowed OAuth redirect URIs (empty = allow any)
# OAUTH_ALLOWED_REDIRECT_URIS=https://claude.ai/oauth/callback,https://chatgpt.com/aip/plugin/oauth/callback
```

**Verification:** `pnpm quality` must pass.

---

## Task 15: Sanitize upload titles (LOW)

**Problem:** `src/api/upload.ts:57` takes `req.body.title` without length or character restrictions.

**File to modify:**

- `src/api/upload.ts`

**What to change:**

After the line that reads the title:

```typescript
const title = (req.body.title as string) || originalname;
```

Add sanitization:

```typescript
const MAX_TITLE_LENGTH = 500;
const sanitizedTitle = title.slice(0, MAX_TITLE_LENGTH).replace(/[\x00-\x1f]/g, '');
```

Then use `sanitizedTitle` instead of `title` in the rest of the handler.

**Verification:** `pnpm quality` must pass.

---

## Task 16: Add request correlation IDs (LOW)

**Problem:** No request ID is generated or propagated through the request lifecycle, making incident investigation harder.

**Files to create/modify:**

- `src/api/middleware/requestId.ts` (new file)
- `src/index.ts` — mount the middleware

**What to do:**

1. Create `src/api/middleware/requestId.ts`:

```typescript
import { randomUUID } from 'node:crypto';
import type { NextFunction, Request, Response } from 'express';

export function requestId(req: Request, res: Response, next: NextFunction): void {
 const id = (req.headers['x-request-id'] as string) || randomUUID();
 res.setHeader('x-request-id', id);
 (req as Request & { id: string }).id = id;
 next();
}
```

1. In `src/index.ts`, add after the helmet middleware:

```typescript
import { requestId } from './api/middleware/requestId.js';
app.use(requestId);
```

**Verification:** `pnpm quality` must pass. Verify with `curl -v http://localhost:3000/health` that `x-request-id` header is returned.
