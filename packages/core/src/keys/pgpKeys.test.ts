// @vitest-environment node
import * as openpgp from 'openpgp';
import { describe, expect, it } from 'vitest';

import { generateCurve25519Key, lockKey, reformatWithUserIDs } from './pgpKeys';

const email = 'alice@example.com';

function generate() {
	return generateCurve25519Key({ userIDs: [{ email }], date: new Date(Date.now() - 60_000) });
}

async function generateLegacyV4() {
	const { privateKey } = await openpgp.generateKey({
		type: 'curve25519',
		userIDs: [{ email: 'bob@example.com' }],
		format: 'object'
	});
	return privateKey;
}

function advertisesSeipdV2(key: openpgp.Key): boolean {
	const sig = key.directSignatures[0];
	return !!sig?.features && (sig.features[0] & openpgp.enums.features.seipdv2) !== 0;
}

async function wireShape(armored: string) {
	const message = await openpgp.readMessage({ armoredMessage: armored });
	const pkesk = message.packets.filterByTag(openpgp.enums.packet.publicKeyEncryptedSessionKey);
	const seipd = message.packets.filterByTag(openpgp.enums.packet.symEncryptedIntegrityProtectedData);
	return {
		pkesk: pkesk.map((p) => (p as unknown as { version: number }).version),
		seipd: (seipd[0] as unknown as { version: number }).version
	};
}

async function encryptTo(...keys: openpgp.Key[]) {
	return openpgp.encrypt({
		message: await openpgp.createMessage({ text: 'hello' }),
		encryptionKeys: keys,
		format: 'armored'
	});
}

async function decryptWith(armored: string, key: openpgp.PrivateKey) {
	const { data } = await openpgp.decrypt({
		message: await openpgp.readMessage({ armoredMessage: armored }),
		decryptionKeys: key
	});
	return data;
}

describe('generateCurve25519Key', () => {
	it('produces a v6 Ed25519 key with a v6 X25519 encryption subkey', async () => {
		const { publicKey } = await generate();
		expect(publicKey.keyPacket.version).toBe(6);
		expect(publicKey.getAlgorithmInfo().algorithm).toBe('ed25519');
		expect(publicKey.getFingerprint()).toMatch(/^[0-9a-f]{64}$/);
		const subkeys = publicKey.getSubkeys();
		expect(subkeys).toHaveLength(1);
		expect(subkeys[0].keyPacket.version).toBe(6);
		expect(subkeys[0].getAlgorithmInfo().algorithm).toBe('x25519');
		expect(publicKey.getUserIDs()).toEqual([`<${email}>`]);
	});

	it('advertises SEIPDv2 with AEAD cipher suites on the direct-key signature', async () => {
		const { publicKey } = await generate();
		expect(advertisesSeipdV2(publicKey)).toBe(true);
		expect(publicKey.directSignatures[0].preferredCipherSuites?.length ?? 0).toBeGreaterThan(0);
	});

	it('is encrypted to with PKESK v6 and SEIPDv2', async () => {
		const { privateKey, publicKey } = await generate();
		const armored = await encryptTo(publicKey);
		expect(await wireShape(armored)).toEqual({ pkesk: [6], seipd: 2 });
		expect(await decryptWith(armored, privateKey)).toBe('hello');
	});

	it('falls back to PKESK v3 and SEIPDv1 when a v4 recipient is included', async () => {
		const { privateKey, publicKey } = await generate();
		const legacy = await generateLegacyV4();
		const armored = await encryptTo(publicKey, legacy.toPublic());
		expect(await wireShape(armored)).toEqual({ pkesk: [3, 3], seipd: 1 });
		expect(await decryptWith(armored, privateKey)).toBe('hello');
		expect(await decryptWith(armored, legacy)).toBe('hello');
	});
});

describe('lockKey', () => {
	it('protects v6 secret key material with AEAD and unlocks again', async () => {
		const { privateKey } = await generate();
		const locked = await lockKey(privateKey, 'correct horse');
		const reread = await openpgp.readPrivateKey({ armoredKey: locked.armor() });
		for (const k of reread.getKeys()) {
			expect((k.keyPacket as unknown as { s2kUsage: number }).s2kUsage).toBe(253);
		}
		const unlocked = await openpgp.decryptKey({ privateKey: reread, passphrase: 'correct horse' });
		expect(unlocked.getFingerprint()).toBe(privateKey.getFingerprint());
	});

	it('keeps the existing protection for v4 keys', async () => {
		const legacy = await generateLegacyV4();
		const locked = await lockKey(legacy, 'correct horse');
		const reread = await openpgp.readPrivateKey({ armoredKey: locked.armor() });
		expect((reread.keyPacket as unknown as { s2kUsage: number }).s2kUsage).toBe(254);
		const unlocked = await openpgp.decryptKey({ privateKey: reread, passphrase: 'correct horse' });
		expect(unlocked.getFingerprint()).toBe(legacy.getFingerprint());
	});
});

describe('reformatWithUserIDs', () => {
	it('keeps the v6 fingerprint and SEIPDv2 preferences while replacing user ids', async () => {
		const { privateKey } = await generate();
		const { privateKey: reformatted } = await reformatWithUserIDs(privateKey, [
			{ email },
			{ email: 'alias@example.com' }
		]);
		expect(reformatted.getFingerprint()).toBe(privateKey.getFingerprint());
		expect(reformatted.getUserIDs().sort()).toEqual(['<alias@example.com>', `<${email}>`]);
		expect(advertisesSeipdV2(reformatted)).toBe(true);
		const armored = await encryptTo(reformatted.toPublic());
		expect(await wireShape(armored)).toEqual({ pkesk: [6], seipd: 2 });
	});

	it('leaves a v4 key without SEIPDv2', async () => {
		const legacy = await generateLegacyV4();
		const { privateKey: reformatted } = await reformatWithUserIDs(legacy, [{ email: 'bob@example.com' }]);
		expect(reformatted.keyPacket.version).toBe(4);
		expect(reformatted.getFingerprint()).toBe(legacy.getFingerprint());
		const armored = await encryptTo(reformatted.toPublic());
		expect((await wireShape(armored)).seipd).toBe(1);
	});
});
