// @vitest-environment node
import * as openpgp from 'openpgp';
import { beforeAll, describe, expect, it } from 'vitest';
import { canonicalise, type BusyStatement } from './busycanon';
import { verifyBusyWindows } from './verifybusy';

const statement: BusyStatement = {
	calendarId: 'aa000000-0000-0000-0000-000000000001',
	itemId: 'bb000000-0000-0000-0000-000000000002',
	privacy: 'busy',
	rev: 2,
	signerAccountId: 'cc000000-0000-0000-0000-000000000003',
	windows: [{ startsAt: '2026-09-07T14:00:00.000Z', endsAt: '2026-09-07T15:00:00.000Z' }]
};

function toB64(bytes: Uint8Array): string {
	let bin = '';
	for (const b of bytes) bin += String.fromCharCode(b);
	return btoa(bin);
}

function hexToB64(hex: string): string {
	const bytes = new Uint8Array(hex.length / 2);
	for (let i = 0; i < bytes.length; i++) bytes[i] = parseInt(hex.slice(i * 2, i * 2 + 2), 16);
	return toB64(bytes);
}

let publicKeyArmored: string;
let fingerprintHex: string;
let signature: string;
let otherPublicKeyArmored: string;
let otherFingerprintHex: string;

beforeAll(async () => {
	const mine = await openpgp.generateKey({
		userIDs: [{ name: 'Signer', email: 'signer@thelemail.test' }],
		format: 'object'
	});
	publicKeyArmored = mine.publicKey.armor();
	fingerprintHex = mine.publicKey.getFingerprint().toLowerCase();
	const detached = await openpgp.sign({
		message: await openpgp.createMessage({ binary: canonicalise(statement) }),
		signingKeys: mine.privateKey,
		detached: true,
		format: 'binary'
	});
	signature = toB64(detached as Uint8Array);

	const other = await openpgp.generateKey({
		userIDs: [{ name: 'Other', email: 'other@thelemail.test' }],
		format: 'object'
	});
	otherPublicKeyArmored = other.publicKey.armor();
	otherFingerprintHex = other.publicKey.getFingerprint().toLowerCase();
}, 60_000);

describe('busy window verification', () => {
	it('accepts a signature made over the same canonical bytes', async () => {
		const verdict = await verifyBusyWindows({
			statement,
			signature,
			signerKeyFingerprint: hexToB64(fingerprintHex),
			publicKeyArmored,
			directoryKeyFingerprintHex: fingerprintHex
		});
		expect(verdict.trust).toBe('verified');
		expect(verdict.signedAtMillis).toBeTypeOf('number');
	});

	it('rejects a window set the server altered', async () => {
		const verdict = await verifyBusyWindows({
			statement: {
				...statement,
				windows: [{ startsAt: '2026-09-07T16:00:00.000Z', endsAt: '2026-09-07T17:00:00.000Z' }]
			},
			signature,
			signerKeyFingerprint: hexToB64(fingerprintHex),
			publicKeyArmored,
			directoryKeyFingerprintHex: fingerprintHex
		});
		expect(verdict.trust).toBe('signature_failed');
	});

	it('rejects windows replayed onto another item', async () => {
		const verdict = await verifyBusyWindows({
			statement: { ...statement, itemId: 'dd000000-0000-0000-0000-000000000004' },
			signature,
			signerKeyFingerprint: hexToB64(fingerprintHex),
			publicKeyArmored,
			directoryKeyFingerprintHex: fingerprintHex
		});
		expect(verdict.trust).toBe('signature_failed');
	});

	it('rejects an older revision replayed as current', async () => {
		const verdict = await verifyBusyWindows({
			statement: { ...statement, rev: 3 },
			signature,
			signerKeyFingerprint: hexToB64(fingerprintHex),
			publicKeyArmored,
			directoryKeyFingerprintHex: fingerprintHex
		});
		expect(verdict.trust).toBe('signature_failed');
	});

	it('rejects a key the directory does not publish for the signer', async () => {
		const verdict = await verifyBusyWindows({
			statement,
			signature,
			signerKeyFingerprint: hexToB64(otherFingerprintHex),
			publicKeyArmored: otherPublicKeyArmored,
			directoryKeyFingerprintHex: fingerprintHex
		});
		expect(verdict.trust).toBe('key_mismatch');
	});

	it('reports unsigned rather than trusting an entry with no signature', async () => {
		const verdict = await verifyBusyWindows({
			statement,
			signature: '',
			signerKeyFingerprint: '',
			publicKeyArmored,
			directoryKeyFingerprintHex: fingerprintHex
		});
		expect(verdict.trust).toBe('unsigned');
	});

	it('reports the key as unresolved rather than verified when it is missing', async () => {
		const verdict = await verifyBusyWindows({
			statement,
			signature,
			signerKeyFingerprint: hexToB64(fingerprintHex),
			publicKeyArmored: '',
			directoryKeyFingerprintHex: fingerprintHex
		});
		expect(verdict.trust).toBe('key_unresolved');
	});
});
