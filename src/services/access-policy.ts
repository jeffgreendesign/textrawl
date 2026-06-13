/**
 * Access policy — central privacy/audience enforcement for read tools.
 *
 * The personal assistant and a family-shared assistant may both query Textrawl,
 * but family-shared answers must not accidentally surface private memory,
 * conversation history, or proactive insights (which can encode career,
 * adult-health, work, or portfolio context). This boundary is enforced here, on
 * the central routing path — NOT via prompt instructions — so it holds regardless
 * of how a model is steered.
 *
 * The first implementation maps coarsely: a restricted audience is limited to
 * shared documents unless the caller explicitly opts into cross-profile access.
 */

export type Audience = 'private_jeff' | 'family_shared' | 'public_safe';

export type Scope =
	| 'auto'
	| 'personal'
	| 'family'
	| 'documents'
	| 'memory'
	| 'conversations'
	| 'insights';

export type Source = 'documents' | 'memory' | 'conversations' | 'insights';

export type Sensitivity =
	| 'public'
	| 'private'
	| 'family'
	| 'health'
	| 'financial'
	| 'credential-risk'
	| 'unknown';

export interface ResolveAccessInput {
	scope?: Scope;
	audience?: Audience;
	/** Opt in to private sources (memory/conversations/insights) for a restricted audience. */
	allowCrossProfile?: boolean;
}

export interface AccessDecision {
	/** Sources the caller is permitted to read from, after scope + audience rules. */
	sources: Source[];
	/** Coarse sensitivity label for the resulting answer. */
	sensitivity: Sensitivity;
	/** Human-readable notes about any restriction applied (surfaced to the model). */
	warnings: string[];
}

const ALL_SOURCES: Source[] = ['documents', 'memory', 'conversations', 'insights'];

/**
 * Sources that may hold profile-private context and must be withheld from a
 * family/public audience unless cross-profile access is explicitly allowed.
 */
const PRIVATE_SOURCES: Source[] = ['memory', 'conversations', 'insights'];

/**
 * Resolve the effective read sources, sensitivity label, and any warnings for a
 * request. Pure and deterministic — safe to unit-test and to call on every read.
 */
export function resolveAccess(input: ResolveAccessInput = {}): AccessDecision {
	const scope: Scope = input.scope ?? 'auto';
	const audience: Audience = input.audience ?? 'private_jeff';
	const allowCrossProfile = input.allowCrossProfile ?? false;
	const warnings: string[] = [];

	// 1. Base source set from the requested scope.
	let sources: Source[];
	switch (scope) {
		case 'documents':
		case 'memory':
		case 'conversations':
		case 'insights':
			sources = [scope];
			break;
		case 'family':
			// A family-facing view is shared documents only.
			sources = ['documents'];
			break;
		default:
			// 'auto' and 'personal' search everything (subject to audience below).
			sources = [...ALL_SOURCES];
			break;
	}

	// 2. Audience restriction — the central privacy boundary.
	const restrictedAudience = audience === 'family_shared' || audience === 'public_safe';
	if (restrictedAudience && !allowCrossProfile) {
		const before = sources.length;
		sources = sources.filter((s) => !PRIVATE_SOURCES.includes(s));
		if (sources.length < before) {
			warnings.push(
				`audience="${audience}": restricted to shared documents; personal memory, conversations, and insights were excluded. Set allowCrossProfile=true to override.`,
			);
		}
		// Never resolve to an empty set — fall back to documents.
		if (sources.length === 0) {
			sources = ['documents'];
		}
	}

	// 3. Coarse sensitivity label for the answer envelope.
	let sensitivity: Sensitivity;
	if (audience === 'public_safe') {
		sensitivity = 'public';
	} else if (audience === 'family_shared') {
		sensitivity = 'family';
	} else {
		sensitivity = 'private';
	}

	return { sources, sensitivity, warnings };
}
