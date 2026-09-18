// @vitest-environment node
import * as openpgp from 'openpgp';
import { describe, expect, it } from 'vitest';

import { generateCurve25519Key } from '$core/keys/pgpKeys';
import {
	keyLabel,
	labelMatchesKey,
	LABEL_CURVE25519_LEGACY,
	LABEL_CURVE25519_V4,
	LABEL_CURVE25519_V6
} from './keyLabel';

const date = new Date(Date.now() - 60_000);

async function v6() {
	return (await generateCurve25519Key({ userIDs: [{ email: 'a@thelemail.test' }], date })).publicKey;
}

async function v4(type: 'curve25519' | 'ecc') {
	return (await openpgp.generateKey({ type, userIDs: [{ email: 'a@thelemail.test' }], date, format: 'object' }))
		.publicKey;
}

describe('keyLabel', () => {
	it('names each curve25519 key shape the server labels', async () => {
		expect(keyLabel(await v6())).toBe(LABEL_CURVE25519_V6);
		expect(keyLabel(await v4('curve25519'))).toBe(LABEL_CURVE25519_V4);
		expect(keyLabel(await v4('ecc'))).toBe(LABEL_CURVE25519_LEGACY);
	});

	it('falls back to the primary algorithm with a version suffix', async () => {
		const signOnly = (
			await generateCurve25519Key({ userIDs: [{ email: 'a@thelemail.test' }], subkeys: [], date })
		).publicKey;
		expect(keyLabel(signOnly)).toBe('openpgp-ed25519-v6');
	});
});

describe('labelMatchesKey', () => {
	const before = '2026-09-01T00:00:00Z';
	const after = '2026-10-01T00:00:00Z';

	it('accepts a label that matches the key', async () => {
		expect(labelMatchesKey(LABEL_CURVE25519_V6, await v6(), after)).toBe(true);
		expect(labelMatchesKey(LABEL_CURVE25519_V4, await v4('curve25519'), after)).toBe(true);
		expect(labelMatchesKey(LABEL_CURVE25519_LEGACY, await v4('ecc'), after)).toBe(true);
	});

	it('tolerates the old v6 label on a v4 key only on statements issued before the cutoff', async () => {
		const key = await v4('curve25519');
		expect(labelMatchesKey(LABEL_CURVE25519_V6, key, before)).toBe(true);
		expect(labelMatchesKey(LABEL_CURVE25519_V6, key, after)).toBe(false);
		expect(labelMatchesKey(LABEL_CURVE25519_V6, await v4('ecc'), before)).toBe(true);
	});

	it('never accepts a v4 label on a v6 key or an unknown label', async () => {
		const key = await v6();
		expect(labelMatchesKey(LABEL_CURVE25519_V4, key, before)).toBe(false);
		expect(labelMatchesKey('openpgp-curve25519-v7', key, before)).toBe(false);
	});
});
