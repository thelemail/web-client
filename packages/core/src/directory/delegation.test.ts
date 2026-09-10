// @vitest-environment node
import { describe, expect, it } from 'vitest';

import { canonicaliseDelegation, parseDelegationStatement, type DelegationStatement } from './delegation-statement';

const statement: DelegationStatement = {
	accountId: '11111111-2222-3333-4444-555555555555',
	address: 'billing@example.com',
	delegationId: '66666666-7777-8888-9999-aaaaaaaaaaaa',
	issuedAt: '2026-09-08T12:00:00Z',
	keyAlgorithm: 'openpgp-curve25519-v6',
	label: 'Stripe invoices',
	notAfter: '2027-09-08T12:00:00Z',
	notBefore: '2026-09-08T12:00:00Z',
	revokedAt: null,
	signerFingerprint: 'cd'.repeat(32),
	signingKeyFingerprint: 'ef'.repeat(32),
	version: 1
};

const GO_CANONICAL =
	'{"accountId":"11111111-2222-3333-4444-555555555555",' +
	'"address":"billing@example.com",' +
	'"delegationId":"66666666-7777-8888-9999-aaaaaaaaaaaa",' +
	'"issuedAt":"2026-09-08T12:00:00Z",' +
	'"keyAlgorithm":"openpgp-curve25519-v6",' +
	'"label":"Stripe invoices",' +
	'"notAfter":"2027-09-08T12:00:00Z",' +
	'"notBefore":"2026-09-08T12:00:00Z",' +
	'"revokedAt":null,' +
	`"signerFingerprint":"${'cd'.repeat(32)}",` +
	`"signingKeyFingerprint":"${'ef'.repeat(32)}",` +
	'"version":1}';

describe('canonicaliseDelegation', () => {
	it('matches the Go canonicaliser byte for byte', () => {
		expect(new TextDecoder().decode(canonicaliseDelegation(statement))).toBe(GO_CANONICAL);
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
			signerFingerprint: 'CD'.repeat(32),
			signingKeyFingerprint: 'EF'.repeat(32)
		};
		expect(new TextDecoder().decode(canonicaliseDelegation(upper))).toBe(GO_CANONICAL);
	});

	it('round-trips through the parser without changing the bytes', () => {
		const bytes = canonicaliseDelegation(statement);
		const again = canonicaliseDelegation(parseDelegationStatement(bytes));
		expect(new TextDecoder().decode(again)).toBe(GO_CANONICAL);
	});

	it('rejects a statement missing revokedAt', () => {
		const raw = new TextEncoder().encode(
			JSON.stringify({ ...statement, revokedAt: undefined })
		);
		expect(() => parseDelegationStatement(raw)).toThrow();
	});
});