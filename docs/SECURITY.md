# Security Model

This document describes the security architecture of Textrawl.

## Architecture Overview

Textrawl uses a backend-only database access pattern:

```
User → Express Backend → Supabase (service_role) → PostgreSQL
            │
      API_BEARER_TOKEN auth
```

Key security characteristics:

- **No client-side Supabase access**: The Supabase JS client runs only on the server
- **Service role key**: All database operations use `SUPABASE_SERVICE_KEY`, not `anon` or `authenticated` keys
- **Express authentication**: API access is protected by `API_BEARER_TOKEN`
- **Single-tenant design**: One knowledge base per deployment, no multi-user isolation

## Database Security

### Row Level Security (RLS)

RLS is enabled on `documents` and `chunks` tables with defense-in-depth policies.

Run `scripts/security-rls.sql` after initial schema setup to enable these protections.

| Policy | Target | Effect |
|--------|--------|--------|
| `Allow all access` | All roles | Permissive (service_role bypasses RLS anyway) |
| `Deny anon access` | `anon` role | Restrictive - blocks all operations |
| `Deny authenticated access` | `authenticated` role | Restrictive - blocks all operations |

### Permission Grants

In addition to RLS policies, explicit REVOKEs block access at the permission level:

```sql
REVOKE ALL ON TABLE documents, chunks FROM anon, authenticated;
REVOKE EXECUTE ON FUNCTION hybrid_search, semantic_search FROM anon, authenticated;
```

### Why Both RLS and REVOKE?

Defense-in-depth: if someone accidentally exposes `SUPABASE_ANON_KEY` or connects via the `authenticated` role, they still cannot access data. The service role key (used by the backend) bypasses both RLS and these permission restrictions.

## Single-Tenant Design

This application is designed for personal or team use, not multi-tenant SaaS:

- No `user_id` or `tenant_id` columns in the schema
- No row-level user isolation
- Full access to all documents within the knowledge base
- One deployment instance per user/team

For multi-tenant deployments, run separate instances with isolated Supabase projects.

## API Authentication

### Bearer Token

All API endpoints (except health checks) require a Bearer token:

```
Authorization: Bearer <token>
```

Configure `API_BEARER_TOKEN` in `.env`:
- Minimum 32 characters
- Generate with: `openssl rand -hex 32`
- Required in production; optional in development

### Rate Limiting

| Endpoint Type | Limit |
|---------------|-------|
| API (MCP, general) | 100 requests/min |
| File upload | 10 requests/min |
| Health checks | 300 requests/min |

### Protected Endpoints

- `POST /mcp` - MCP JSON-RPC handler
- `POST /api/upload` - File upload

### Unprotected Endpoints

- `GET /health` - Basic health check
- `GET /health/ready` - Readiness probe
- `GET /health/live` - Liveness probe

## Security Recommendations

1. **Never expose service role key**: Keep `SUPABASE_SERVICE_KEY` in backend environment only
2. **Use strong API token**: 32+ characters, cryptographically random
3. **HTTPS only**: Deploy behind TLS in production
4. **Rotate keys periodically**: Regenerate API tokens and service keys regularly
5. **Monitor access logs**: Watch for unusual patterns or failed authentication attempts

## Verification

After running `scripts/security-rls.sql`, verify the setup in Supabase SQL Editor:

```sql
-- Check RLS is enabled
SELECT schemaname, tablename, rowsecurity
FROM pg_tables
WHERE schemaname = 'public' AND tablename IN ('documents', 'chunks');
-- Expected: rowsecurity = true for both

-- Check policies exist
SELECT tablename, policyname, permissive, roles, cmd
FROM pg_policies
WHERE schemaname = 'public'
ORDER BY tablename, policyname;
-- Expected: 6 policies (3 per table)

-- Test anon access is blocked
SET ROLE anon;
SELECT * FROM documents LIMIT 1;
-- Expected: ERROR: permission denied for table documents
RESET ROLE;
```
