import { describe, expect, it } from 'vitest';
import { resolveAccess } from '../access-policy.js';

describe('resolveAccess', () => {
	it('defaults to all sources for the private owner', () => {
		const d = resolveAccess({});
		expect(d.sources).toEqual(['documents', 'memory', 'conversations', 'insights']);
		expect(d.sensitivity).toBe('private');
		expect(d.warnings).toEqual([]);
	});

	it('restricts a family-shared audience to documents and warns', () => {
		const d = resolveAccess({ audience: 'family_shared' });
		expect(d.sources).toEqual(['documents']);
		expect(d.sensitivity).toBe('family');
		expect(d.warnings.length).toBeGreaterThan(0);
		expect(d.warnings[0]).toContain('allowCrossProfile');
	});

	it('restricts a public-safe audience to documents', () => {
		const d = resolveAccess({ audience: 'public_safe' });
		expect(d.sources).toEqual(['documents']);
		expect(d.sensitivity).toBe('public');
	});

	it('allows cross-profile override for a restricted audience', () => {
		const d = resolveAccess({ audience: 'family_shared', allowCrossProfile: true });
		expect(d.sources).toEqual(['documents', 'memory', 'conversations', 'insights']);
		expect(d.warnings).toEqual([]);
	});

	it('honors a single named scope for the private owner', () => {
		expect(resolveAccess({ scope: 'memory' }).sources).toEqual(['memory']);
		expect(resolveAccess({ scope: 'conversations' }).sources).toEqual(['conversations']);
	});

	it('maps scope=family to shared documents only', () => {
		expect(resolveAccess({ scope: 'family' }).sources).toEqual(['documents']);
	});

	it('never resolves to an empty source set', () => {
		// memory scope + restricted audience would otherwise be empty.
		const d = resolveAccess({ scope: 'memory', audience: 'public_safe' });
		expect(d.sources).toEqual(['documents']);
	});
});
