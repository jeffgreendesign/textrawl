import { createHash } from 'node:crypto';
import type { Request } from 'express';
import { config } from '../../utils/config.js';

/**
 * Derive the owner-token hash for an upload session (plan §6 — INTERIM binding).
 *
 * Returns the SHA-256 hex of the presented bearer token, or `null` when auth is
 * disabled (neither static token nor OAuth configured) or no usable bearer token
 * is present. This is a lightweight, interim ownership binding so status/cancel
 * can be scoped to the caller — **not** a multi-tenant security boundary. For
 * static-token deployments it is stable; for OAuth it hashes the raw JWT, so it
 * is best-effort and unstable across token refresh (documented interim
 * limitation; OAuth `sub`-based binding is a future improvement).
 *
 * `bearerAuth` runs first and rejects missing/invalid tokens when auth is on, so
 * by the time a handler calls this, a configured deployment has a valid token.
 */
export function deriveOwnerTokenHash(req: Request): string | null {
	// Auth disabled (development) → no ownership binding.
	if (!config.API_BEARER_TOKEN && !config.GOOGLE_CLIENT_ID) {
		return null;
	}

	const authHeader = req.headers.authorization;
	if (!authHeader) {
		return null;
	}

	const [scheme, token] = authHeader.split(' ');
	if (scheme !== 'Bearer' || !token) {
		return null;
	}

	return createHash('sha256').update(token).digest('hex');
}

/**
 * Ownership guard. Returns true when the caller may act on an upload owned by
 * `ownerTokenHash`. Uploads with a null owner (created while auth was disabled)
 * are unowned and accessible to anyone, matching the §6 interim model.
 */
export function ownsUpload(ownerTokenHash: string | null, callerHash: string | null): boolean {
	if (ownerTokenHash === null) {
		return true;
	}
	return ownerTokenHash === callerHash;
}
