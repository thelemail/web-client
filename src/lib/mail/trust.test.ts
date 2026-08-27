import { describe, it, expect } from 'vitest';
import { deriveTrust, type TrustFacts } from './trust';
import type { DirectoryTrust } from './senderVerify';

const NOW = Date.UTC(2026, 7, 27, 12, 0, 0);

function directory(overrides: Partial<DirectoryTrust> = {}): DirectoryTrust {
	return {
		ok: true,
		statement: {
			address: 'ada@thelemail.com',
			accountId: 'acc-1',
			keyFingerprint: 'aa'.repeat(32),
			keyAlgorithm: 'openpgp-curve25519-v6',
			version: 3,
			issuedAt: '2026-08-01T00:00:00Z',
			signingKeyFingerprint: 'bb'.repeat(20)
		},
		publicKeyArmored: 'armored',
		firstContact: false,
		sameWorkspace: true,
		verifiedAtMillis: NOW - 30_000,
		tlog: {
			state: 'verified',
			origin: 'thelemail.com/keys',
			treeSize: 1200,
			leafIndex: 42,
			validWitnessCount: 0,
			witnessThreshold: 0
		},
		...overrides
	};
}

function internal(overrides: Partial<TrustFacts> = {}): TrustFacts {
	return {
		channel: 'internal',
		senderAddress: 'ada@thelemail.com',
		e2e: true,
		signature: { state: 'valid', keyFingerprintHex: 'aa'.repeat(32) },
		directory: directory(),
		nowMillis: NOW,
		...overrides
	};
}

function gmail(overrides: Partial<TrustFacts> = {}): TrustFacts {
	return {
		channel: 'inbound_external',
		senderAddress: 'someone@gmail.com',
		e2e: false,
		domainAuth: { spf: 'pass', dkim: 'pass', dmarc: 'pass' },
		domainAuthState: 'pass',
		nowMillis: NOW,
		...overrides
	};
}

describe('deriveTrust', () => {
	it('withholds the shield while no witnesses are enrolled', () => {
		const trust = deriveTrust(internal());
		expect(trust.tier).toBe('encrypted');
		expect(trust.headline).toBe('End-to-end encrypted');
		expect(trust.checks.find((c) => c.id === 'witnesses')?.state).toBe('absent');
		expect(trust.checks.find((c) => c.id === 'tlog')?.state).toBe('pass');
		expect(trust.checks.find((c) => c.id === 'signature')?.state).toBe('pass');
	});

	it('awards the shield once the witness threshold is met', () => {
		const trust = deriveTrust(
			internal({
				directory: directory({
					tlog: {
						state: 'verified',
						origin: 'thelemail.com/keys',
						treeSize: 1200,
						leafIndex: 42,
						validWitnessCount: 2,
						witnessThreshold: 2,
						cosignatureTimestamp: Math.floor(NOW / 1000) - 60
					}
				})
			})
		);
		expect(trust.tier).toBe('verified');
		expect(trust.headline).toBe('Encrypted and verified');
		expect(trust.checks.every((c) => c.state === 'pass')).toBe(true);
		expect(trust.footnote).toBe('Verified on this device · just now');
	});

	it('does not award the shield without a verified signature', () => {
		const trust = deriveTrust(internal({ signature: { state: 'none' } }));
		expect(trust.tier).toBe('encrypted');
		expect(trust.checks.find((c) => c.id === 'signature')?.state).toBe('absent');
		expect(trust.checks.find((c) => c.id === 'binding')?.state).toBe('absent');
	});

	it('flags an invalid signature red', () => {
		const trust = deriveTrust(internal({ signature: { state: 'invalid' } }));
		expect(trust.tier).toBe('failed');
		expect(trust.checks.find((c) => c.id === 'signature')?.state).toBe('fail');
	});

	it('gives ordinary authenticated mail the quiet green check', () => {
		const trust = deriveTrust(gmail());
		expect(trust.tier).toBe('authenticated');
		expect(trust.headline).toBe('Sender domain authenticated');
		expect(trust.footnote).toBe('Protected in transit where supported');
		expect(trust.checks.map((c) => c.state)).toEqual([
			'pass',
			'pass',
			'absent',
			'absent',
			'absent'
		]);
		expect(trust.checks[1].label).toBe('Message claims to come from gmail.com');
	});

	it('is gray, not yellow, when domain authentication is simply absent', () => {
		const trust = deriveTrust(gmail({ domainAuth: undefined, domainAuthState: undefined }));
		expect(trust.tier).toBe('none');
		expect(trust.checks.every((c) => c.state === 'absent')).toBe(true);
	});

	it('is red when domain authentication fails', () => {
		const trust = deriveTrust(
			gmail({ domainAuth: { spf: 'fail', dmarc: 'fail' }, domainAuthState: 'fail' })
		);
		expect(trust.tier).toBe('failed');
	});

	it('shows a remembered external key as a lock', () => {
		const trust = deriveTrust(
			gmail({
				e2e: true,
				externalKey: { status: 'pinned', fingerprint: 'cd'.repeat(20), source: 'wkd' }
			})
		);
		expect(trust.tier).toBe('encrypted');
		expect(trust.footnote).toContain('Key remembered · ');
		expect(trust.checks.find((c) => c.id === 'pinned')?.state).toBe('pass');
	});

	it('asks for confirmation when an external key changes', () => {
		const trust = deriveTrust(
			gmail({ e2e: true, externalKey: { status: 'changed', fingerprint: 'ef'.repeat(20) } })
		);
		expect(trust.tier).toBe('attention');
		expect(trust.action).toBe('confirm_key_change');
	});

	it('asks for confirmation on a forward key rotation in the directory', () => {
		const trust = deriveTrust(
			internal({
				directory: directory({
					ok: false,
					statement: undefined,
					code: 'fingerprint_changed',
					details: {
						previousFingerprint: 'aa'.repeat(32),
						currentFingerprint: 'bc'.repeat(32),
						previousVersion: 3,
						currentVersion: 4,
						previousVerifiedAtMillis: NOW - 3 * 24 * 3600 * 1000
					}
				})
			})
		);
		expect(trust.tier).toBe('attention');
		expect(trust.action).toBe('confirm_key_change');
		expect(trust.footnote).toBe('Last verified 3 days ago');
	});

	it('blocks a rolled back directory version', () => {
		const trust = deriveTrust(
			internal({
				directory: directory({
					ok: false,
					statement: undefined,
					code: 'version_rolled_back',
					details: { previousVersion: 5, currentVersion: 3 }
				})
			})
		);
		expect(trust.tier).toBe('failed');
		expect(trust.label).toBe('Verification failed');
	});

	it('blocks a rolled back transparency log', () => {
		const trust = deriveTrust(
			internal({
				directory: directory({
					ok: false,
					statement: undefined,
					code: 'tlog_tree_rolled_back',
					details: { treeSize: 900, previousTreeSize: 1200 }
				})
			})
		);
		expect(trust.tier).toBe('failed');
		expect(trust.headline).toBe('The transparency log went backwards');
	});

	it('marks a monitor-mode transparency failure without blocking the message', () => {
		const trust = deriveTrust(
			internal({
				directory: directory({
					tlog: {
						state: 'failed',
						code: 'tlog_witness_policy_unmet',
						details: { validWitnessCount: 0, witnessThreshold: 2 }
					}
				})
			})
		);
		expect(trust.tier).toBe('encrypted');
		expect(trust.checks.find((c) => c.id === 'tlog')?.state).toBe('fail');
	});

	it('carries technical rows for the details panel', () => {
		const rows = deriveTrust(internal()).technical;
		const labels = rows.map((r) => r.label);
		expect(labels).toContain('Sender key');
		expect(labels).toContain('Directory signing key');
		expect(labels).toContain('Tree size');
		expect(labels).toContain('Leaf index');
		expect(rows.find((r) => r.label === 'Sender key')?.value).toContain(' · ');
	});
});
