---
title: Textrawl Security Audit Report
description: Full codebase security review covering authentication, Supabase/Postgres defaults, API security, and dependency vulnerabilities
date: 2026-02-02
---

# Textrawl Security Audit Report

**Date:** 2026-02-02
**Scope:** Full codebase security review
**Branch:** `claude/security-audit-tr11b`
**Status:** Analysis only (no code changes)

---

## Executive Summary

Textrawl demonstrates a generally strong security posture for a single-tenant MCP server. Authentication, authorization, rate limiting, and database access controls are well-implemented. However, there are several findings that warrant attention, particularly around Supabase/Postgres default settings, dependency vulnerabilities, and a few gaps in defense-in-depth.

**Findings by severity:**

| Severity      | Count |
| ------------- | ----- |
| Critical      | 0     |
| High          | 5     |
| Medium        | 7     |
| Low           | 5     |
| Informational | 4     |

---

## 1. Authentication & Authorization

### 1.1 Bearer Token Authentication — GOOD

**File:** `src/api/middleware/auth.ts`

Positive findings:
- Uses `timingSafeEqual()` for token comparison (prevents timing attacks)
- Dual-strategy auth: static bearer token OR OAuth JWT
- Production mode requires auth (enforced in `src/utils/config.ts:140-147`)

### 1.2 [HIGH] Development Mode Auth Bypass

**File:** `src/api/middleware/auth.ts:24-28`

When neither `API_BEARER_TOKEN` nor `GOOGLE_CLIENT_ID` is configured, auth is completely skipped. While this is intended for development, the check is silent and any misconfiguration in production with missing env vars would leave the entire API unauthenticated.

**Risk:** If `NODE_ENV` is accidentally set to `production` without `API_BEARER_TOKEN`, the config validation at `config.ts:140-147` will catch it and `process.exit(1)`. However, if `NODE_ENV` is not set (defaults to `development`), the server runs without auth and only logs a warning.

**Recommendation:** Consider requiring explicit opt-in for no-auth mode (e.g., `DISABLE_AUTH=true`) rather than silently disabling based on absent config.

### 1.3 OAuth Implementation — GOOD

**File:** `src/api/oauth/routes.ts`

Positive findings:
- PKCE with S256 enforced (`routes.ts:60-61`)
- Email allowlist support (`routes.ts:138-146`)
- Short-lived auth codes (5 minutes)
- Session state stored in signed JWT (not server-side, stateless)
- Redirect URI validation on token exchange (`routes.ts:194`)

### 1.4 [MEDIUM] OAuth Token Lifetime

**File:** `src/api/oauth/routes.ts:199`

Access tokens are issued with a 30-day lifetime. There is no refresh token mechanism and no token revocation capability. If a token is compromised, it remains valid for up to 30 days.

**Recommendation:** Consider shorter token lifetimes with refresh tokens, or implement a token revocation list.

### 1.5 [MEDIUM] PKCE Comparison Not Timing-Safe

**File:** `src/api/oauth/pkce.ts:4`

```typescript
return computed === codeChallenge;
```

The PKCE verification uses a simple string equality check (`===`) instead of `timingSafeEqual`. While PKCE code challenges are typically one-time-use and short-lived, timing-safe comparison is a best practice.

**Recommendation:** Use `timingSafeEqual` for PKCE verification to match the pattern used for bearer tokens.

### 1.6 [LOW] OAuth Redirect URI Not Validated Against Allowlist

**File:** `src/api/oauth/routes.ts:65-70`

The `redirect_uri` from the authorize request is stored in the session JWT and later used directly for redirection without validation against a known allowlist of acceptable redirect URIs. A malicious client could potentially specify an arbitrary redirect URI.

**Note:** This is somewhat mitigated by the fact that the auth code is bound to the redirect URI and the PKCE challenge, but an explicit allowlist would be stronger.

---

## 2. Supabase/PostgreSQL Security Defaults

### 2.1 [HIGH] Schema SQL Files Don't Enable RLS by Default

**Files:**
- `scripts/setup-db.sql` — No RLS
- `scripts/setup-db-memory.sql:299-313` — RLS commented out
- `scripts/setup-db-ollama.sql`, `scripts/setup-db-ollama-v2.sql` — Likely same pattern

The base schema files (`setup-db.sql`) do **not** enable Row Level Security. RLS is provided as a separate, optional script (`security-rls.sql`). This means:

1. A user who runs only `setup-db.sql` has **no RLS protection**
2. The memory schema (`setup-db-memory.sql`) has RLS **commented out** with a note "Uncomment and customize if multi-tenant support is needed"
3. The conversation schema (`setup-db-conversation.sql`) does inline RLS (better)
4. The insights schema (`setup-db-insights.sql`) does inline RLS (better)

**Risk:** This is an "easy mode" default. Supabase projects expose a public API (PostgREST) by default. Without RLS, the `anon` and `authenticated` roles can read/write all data through the Supabase REST API or client library using the `anon` key — even if the Textrawl application itself uses the `service_role` key properly.

**Recommendation:** Enable RLS in the primary schema files, not as a separate optional step. The conversation and insights schemas already do this correctly — apply the same pattern to `setup-db.sql` and `setup-db-memory.sql`.

### 2.2 [HIGH] Permissive "Allow All" RLS Policies

**Files:** `scripts/security-rls.sql:30-34`, `scripts/security-rls-memory.sql:34-38`

```sql
CREATE POLICY "Allow all access to documents"
  ON public.documents
  FOR ALL
  USING (true)
  WITH CHECK (true);
```

Every table has a permissive `USING (true)` policy alongside the restrictive deny policies. While the restrictive `USING (false)` policies for `anon`/`authenticated` do override, the permissive policy grants access to **every other role** — including any new roles created in the future, custom roles, or the `postgres` role itself.

**Risk:** If any additional Postgres role is created (e.g., `readonly`, `api_user`, a replication user), it automatically gets full access through the permissive policy. The `FORCE ROW LEVEL SECURITY` on table owners helps, but doesn't protect against new roles.

**Recommendation:** Change the permissive policy to target `service_role` explicitly:

```sql
CREATE POLICY "Allow service_role access"
  ON public.documents
  FOR ALL
  TO service_role
  USING (true)
  WITH CHECK (true);
```

### 2.3 [HIGH] Functions Created With Default PUBLIC Execute Permission

**Files:** `scripts/setup-db.sql:51-141`, `scripts/setup-db-memory.sql:100-292`

All SQL functions (`hybrid_search`, `semantic_search`, `memory_hybrid_search`, `get_entity_context`, `cleanup_expired_observations`, etc.) are created without `SECURITY DEFINER` vs `SECURITY INVOKER` consideration, and more critically, without revoking default execute permissions.

In PostgreSQL, functions are created with `EXECUTE` granted to `PUBLIC` by default. The `security-rls.sql` script revokes these after the fact, but:

1. The base `setup-db.sql` functions are only revoked if `security-rls.sql` is run
2. There's a window between schema creation and RLS script execution where functions are publicly callable
3. Functions like `hybrid_search()` could be called directly by `anon` via PostgREST's `/rpc/hybrid_search` endpoint

**Recommendation:** Add `REVOKE EXECUTE ON FUNCTION ... FROM PUBLIC` immediately after each `CREATE OR REPLACE FUNCTION` in the schema files, or use `SECURITY DEFINER` with restricted search paths.

### 2.4 [MEDIUM] No REVOKE on Sequences

The RLS scripts revoke table and function permissions but don't revoke permissions on sequences. While Supabase tables use `gen_random_uuid()` (no sequences), if any are added later they'd be accessible.

### 2.5 [LOW] Missing `FORCE ROW LEVEL SECURITY` on Insight Tables

**File:** `scripts/setup-db-insights.sql:142-143`

```sql
ALTER TABLE insight_queue ENABLE ROW LEVEL SECURITY;
ALTER TABLE proactive_insights ENABLE ROW LEVEL SECURITY;
```

RLS is enabled but `FORCE ROW LEVEL SECURITY` is not applied (unlike documents/chunks in `security-rls.sql:22-23`). This means the table owner (`postgres`) bypasses RLS on these tables.

### 2.6 [LOW] Missing Service Role Grants for Insight Functions

**File:** `scripts/setup-db-insights.sql`

The insights schema revokes permissions from `anon`/`authenticated` but doesn't explicitly grant to `service_role`. While `service_role` bypasses RLS, the function execute permissions may still prevent access via PostgREST RPC calls.

### 2.7 [INFORMATIONAL] Supabase Client Configuration

**File:** `src/db/client.ts:19-24`

```typescript
supabase = createClient(config.SUPABASE_URL, config.SUPABASE_SERVICE_KEY, {
    auth: {
        persistSession: false,
        autoRefreshToken: false,
    },
});
```

The client correctly disables session persistence and token refresh (appropriate for server-side use). The `service_role` key is used intentionally (single-tenant design). This is documented and defensible.

---

## 3. API Security

### 3.1 Rate Limiting — GOOD

**File:** `src/api/middleware/rateLimit.ts`

| Endpoint | Limit   | Window |
| -------- | ------- | ------ |
| API      | 100/min | 60s    |
| Upload   | 10/min  | 60s    |
| OAuth    | 20/min  | 60s    |
| Health   | 300/min | 60s    |

Rate limiters use `express-rate-limit` with standard headers. All endpoints are protected.

### 3.2 [MEDIUM] Rate Limiter Uses In-Memory Store

**File:** `src/api/middleware/rateLimit.ts`

`express-rate-limit` defaults to an in-memory store. In a multi-instance deployment (e.g., Cloud Run with multiple replicas), each instance maintains its own counter. An attacker could multiply their effective rate limit by the number of instances.

**Recommendation:** For multi-instance deployments, use a Redis-backed store (`rate-limit-redis`).

### 3.3 HTTP Security Headers — GOOD

**File:** `src/index.ts:22`

Helmet middleware is applied globally, providing:
- `Content-Security-Policy`
- `X-Content-Type-Options: nosniff`
- `X-Frame-Options`
- `Strict-Transport-Security`
- `X-XSS-Protection`

### 3.4 CORS Configuration — GOOD

**File:** `src/index.ts:25-43`

CORS defaults to `false` (disabled) when `ALLOWED_ORIGINS` is not set. Only `GET` and `POST` methods are allowed. Origins are validated and trimmed.

### 3.5 [MEDIUM] JSON Body Size Limit

**File:** `src/index.ts:46`

The body parser limit is set to `1mb`. Combined with the MCP endpoint creating a new server instance per request (`src/index.ts:97`), this could allow memory pressure from many concurrent large requests. The rate limiter (100/min) provides some protection.

### 3.6 Proxy Trust Configuration — GOOD

**File:** `src/index.ts:19`

`trust proxy` is set to `1` in production (single hop for Cloud Run/K8s) and `false` in development. This is the correct approach.

---

## 4. Secrets Management

### 4.1 [MEDIUM] Bearer Token Validation Regex Allows Short Hex Tokens

**File:** `src/utils/config.ts:17-24`

The token requires 32+ characters with `[a-zA-Z0-9_-]+`. However, the `.env.example` provides a placeholder `your-64-character-hex-token-here` which is only 35 characters and passes validation. A user might accidentally deploy with this placeholder.

**Recommendation:** Add a check that the token doesn't match common placeholder patterns.

### 4.2 Environment Variable Validation — GOOD

**File:** `src/utils/config.ts`

- Zod schema validates all env vars at startup
- OpenAI keys must start with `sk-`
- Anthropic keys must start with `sk-ant-`
- OAuth requires all-or-nothing configuration
- Production mode enforces auth

### 4.3 [INFORMATIONAL] No .gitignore Entry Verified for .env

The `.env` file is presumably in `.gitignore`, but this should be verified. The `.env.example` is appropriately committed with placeholder values only.

---

## 5. File Upload Security

### 5.1 Upload Validation — GOOD

**File:** `src/api/upload.ts`

- 10MB file size limit (multer)
- MIME type validation (allowlist: PDF, DOCX, TXT, MD)
- Magic number validation (`file-type` library)
- Filename sanitization for logging
- Tag count (10) and length (50 char) limits
- Memory storage (no temp files on disk)

### 5.2 [LOW] Upload Title Not Sanitized

**File:** `src/api/upload.ts:57`

```typescript
const title = (req.body.title as string) || originalname;
```

The upload title is taken directly from `req.body.title` without sanitization. While it's stored in the database (parameterized, so no SQL injection), it could contain arbitrary content that gets returned to MCP clients. Since MCP responses are JSON text (not HTML), XSS is not a direct risk, but it could still be used for content injection in downstream consumers.

### 5.3 CLI Path Security — GOOD

**File:** `scripts/cli/lib/security.ts`

The CLI security module provides robust path traversal protection:
- Null byte detection
- Path normalization and canonicalization
- Symlink resolution
- Allowed base directory enforcement
- Filename sanitization

---

## 6. SQL Injection & Query Safety

### 6.1 Parameterized Queries — GOOD

All database operations use the Supabase client library which generates parameterized queries. No string interpolation or concatenation is used in query construction.

**Files reviewed:**
- `src/db/documents.ts` — `.eq()`, `.filter()`, `.contains()` (all parameterized)
- `src/db/chunks.ts` — `.insert()`, `.eq()` (parameterized)
- `src/db/search.ts` — `.rpc()` with parameter objects

### 6.2 Sort Column Validation — GOOD

**File:** `src/tools/document.ts`

Sort columns are validated against enums (`created_at|updated_at|title`) before being passed to `.order()`, preventing column name injection.

### 6.3 SQL Functions Use websearch_to_tsquery — GOOD

**File:** `scripts/setup-db.sql:75-78`

The search functions use `websearch_to_tsquery()` which safely parses user input into search queries without allowing arbitrary tsquery syntax injection.

---

## 7. Dependency Vulnerabilities

### 7.1 [HIGH] Known Vulnerabilities in Dependencies

`pnpm audit` reports **13 vulnerabilities** (6 high, 7 moderate):

| Package            | Severity | Issue                                          | Used By                               |
| ------------------ | -------- | ---------------------------------------------- | ------------------------------------- |
| `xlsx` (SheetJS)   | HIGH     | Prototype Pollution                            | Indirect dep                          |
| `xlsx` (SheetJS)   | HIGH     | ReDoS                                          | Indirect dep                          |
| `tar`              | HIGH     | Arbitrary File Overwrite (x3)                  | Indirect dep                          |
| `fast-xml-parser`  | HIGH     | RangeError DoS                                 | Indirect dep                          |
| `hono`             | MODERATE | XSS, cache deception, IP spoofing, key read (x4) | Direct dep (v4.11.4, needs >=4.11.7) |
| `esbuild`          | MODERATE | SSRF in dev server                             | Dev dep                               |
| `electron`         | MODERATE | ASAR integrity bypass                          | Desktop app                           |
| `next`             | MODERATE | Unbounded memory                               | Website                               |

**Critical note:** `hono` is listed as a direct dependency at `^4.11.4` with a pnpm override, and has 4 moderate vulnerabilities fixed in `>=4.11.7`. The override in `package.json` pins it below the fix version.

**Recommendation:** Update `hono` override to `^4.11.7`. Evaluate `tar`, `xlsx` (likely transitive via desktop/website dependencies).

---

## 8. Pre-commit Security Hooks

### 8.1 [MEDIUM] Security Check Script Exits 0 on Warnings

**File:** `scripts/security-check.sh:93-94`

```bash
# Exit with 0 to not block commits, but warn developers
# Change to 'exit 1' if you want to block commits with warnings
exit 0
```

The security check script **never blocks commits**. It detects path traversal patterns and warns, but always exits successfully. This means the pre-commit hook provides a false sense of security — violations are easily missed in terminal output.

**Recommendation:** Change to `exit 1` when security issues are found, or at minimum for the ERROR-level patterns (Pattern 1).

### 8.2 [INFORMATIONAL] Security Script Doesn't Check All File Types

The script only checks `.ts` files. If security-sensitive code exists in `.js`, `.mjs`, or `.cjs` files, it won't be caught.

---

## 9. Error Handling & Information Disclosure

### 9.1 Error Handling — GOOD

**File:** `src/api/middleware/error.ts`

- Stack traces never logged or returned
- Production errors return generic "Internal server error"
- Development mode shows actual error messages
- Custom error hierarchy maps to HTTP status codes

### 9.2 [INFORMATIONAL] Health Endpoint Exposes Service Name

**File:** `src/index.ts:58-63`

The `/health` endpoint returns `service: 'textrawl'`. This is minor but exposes the service identity to unauthenticated requests. The `/health/ready` endpoint correctly returns minimal status.

---

## 10. Additional Observations

### 10.1 [LOW] MCP Endpoint Accepts All HTTP Methods

**File:** `src/index.ts:87`

```typescript
app.all('/mcp', apiLimiter, bearerAuth, async (req, res) => {
```

`app.all()` accepts GET, POST, PUT, DELETE, PATCH, etc. The MCP protocol only uses POST. Accepting all methods increases attack surface.

**Recommendation:** Use `app.post('/mcp', ...)` instead.

### 10.2 [INFORMATIONAL] No Request ID / Correlation ID

There is no request ID middleware for correlating logs across a request lifecycle. This makes debugging and security incident investigation harder.

### 10.3 Logging — GOOD

All logging correctly uses `console.error()` (stderr) to preserve stdout for MCP JSON-RPC. The logger module enforces this pattern.

---

## Summary of Recommendations (Prioritized)

### High Priority

1. **Enable RLS inline in schema files** — Move RLS from optional `security-rls.sql` into `setup-db.sql` and `setup-db-memory.sql` directly
2. **Restrict permissive RLS policies to `service_role`** — Change `USING (true)` policies to target `TO service_role` explicitly
3. **Revoke function execute from PUBLIC in schema files** — Don't rely on a separate script for this
4. **Update `hono` dependency** — Bump override from `^4.11.4` to `>=4.11.7`
5. **Address `tar` and `xlsx` dependency vulnerabilities** — Evaluate if transitive deps can be updated

### Medium Priority

6. **Make security-check.sh block commits on errors** — Change `exit 0` to `exit 1`
7. **Use timing-safe comparison for PKCE** — Apply `timingSafeEqual` in `pkce.ts`
8. **Shorten OAuth token lifetime** — Consider 7 days with refresh tokens, or add revocation
9. **Use Redis store for rate limiting in multi-instance deployments** — Document requirement
10. **Add placeholder detection for bearer tokens** — Reject common placeholder values

### Low Priority

11. **Restrict MCP endpoint to POST only** — Change `app.all` to `app.post`
12. **Add `FORCE ROW LEVEL SECURITY` to insight tables** — Match the pattern in security-rls.sql
13. **Validate OAuth redirect URIs against allowlist** — Add `OAUTH_ALLOWED_REDIRECT_URIS`
14. **Sanitize upload titles** — Apply length limits and character filtering
15. **Add request correlation IDs** — Improve debuggability and incident response
