// @vitest-environment node
import { describe, expect, it } from 'vitest';

import vectors from '../interop/vectors/statements.json';
import { canonicaliseDelegation, parseDelegationStatement, type DelegationStatement } from './delegation-statement';

const vector = vectors.cases.find((c) => c.kind === 'delegation' && c.name === 'ok')!;
const trustCanonical = new TextDecoder().decode(Uint8Array.from(atob(vector.raw), (c) => c.charCodeAt(0)));
const statement: DelegationStatement = parseDelegationStatement(new TextEncoder().encode(trustCanonical));

describe('canonicaliseDelegation', () => {
	it('matches the trust canonicaliser byte for byte', () => {
		expect(new TextDecoder().decode(canonicaliseDelegation(statement))).toBe(trustCanonical);
	});

	it('emits an explicit null for an unrevoked delegation', () => {
		expect(new TextDecoder().decode(canonicaliseDelegation(statement))).toContain('"revokedAt":null');
	});

	it('encodes a revocation timestamp when present', () => {
		const revoked = { ...statement, version: 2, revokedAt: '2026-10-01T09:30:00Z' };
		expect(new TextDecoder().decode(canonicaliseDelegation(revoked))).toContain(
			'"revokedAt":"2026-10-01T09:30:00Z"'
		);
	});

	it('lowercases fingerprints so case cannot change the signed bytes', () => {
		const upper = {
			...statement,
			signerFingerprint: statement.signerFingerprint.toUpperCase(),
			signingKeyFingerprint: statement.signingKeyFingerprint.toUpperCase()
		};
		expect(new TextDecoder().decode(canonicaliseDelegation(upper))).toBe(trustCanonical);
	});

	it('round-trips through the parser without changing the bytes', () => {
		const bytes = canonicaliseDelegation(statement);
		const again = canonicaliseDelegation(parseDelegationStatement(bytes));
		expect(new TextDecoder().decode(again)).toBe(trustCanonical);
	});

	it('re-canonicalises the reordered, spaced JSON the server stores as jsonb', () => {
		const fields = Object.entries(JSON.parse(trustCanonical) as Record<string, unknown>).reverse();
		const jsonb = `{${fields.map(([k, v]) => `${JSON.stringify(k)}: ${JSON.stringify(v)}`).join(', ')}}`;
		const parsed = parseDelegationStatement(new TextEncoder().encode(jsonb));
		expect(new TextDecoder().decode(canonicaliseDelegation(parsed))).toBe(trustCanonical);
	});

	it('rejects a statement missing revokedAt', () => {
		const raw = new TextEncoder().encode(
			JSON.stringify({ ...statement, revokedAt: undefined })
		);
		expect(() => parseDelegationStatement(raw)).toThrow();
	});
});