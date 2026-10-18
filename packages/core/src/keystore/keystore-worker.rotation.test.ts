// @vitest-environment node
import { beforeAll, describe, expect, it, vi } from 'vitest';
import * as openpgp from 'openpgp';
import { client, ready, server } from '@serenity-kit/opaque';
import {
	KEY_STRETCHING,
	SERVER_IDENTITY,
	base64UrlToBytes,
	bytesToBase64,
	clientIdentity,
	derivePgpPassphrase,
	deriveMasterKeyId,
	generateAMK,
	wrapMasterKey
} from './opaque-params';
import { verifyKeyTransition } from '$core/directory/key-transition';
import { generateCurve25519Key, lockKey } from '$core/keys/pgpKeys';

vi.mock('@protontech/crypto', () => ({ CryptoProxy: {} }));
vi.mock('@protontech/crypto/proxy/endpoint/api.ts', () => ({ Api: class {} }));
vi.mock('@protontech/crypto/srp', () => ({}));

vi.mock('./idb', () => ({
	getVault: async () => null,
	getAllVaults: async () => [],
	putVault: async () => undefined,
	deleteVault: async () => undefined,
	clearAllVaults: async () => undefined,
	getAllAccountSlots: async () => [],
	putAccountSlot: async () => undefined,
	deleteAccountSlot: async () => undefined,
	clearAllAccountSlots: async () => undefined
}));

const ACCOUNT = '4b1f2c3d-5e6f-4a7b-8c9d-0e1f2a3b4c5d';
const EMAIL = 'nora@thelemail.test';
const PASSWORD = 'correct horse battery staple';
const identifiers = { client: clientIdentity(ACCOUNT, false), server: SERVER_IDENTITY };

let seq = 0;
const replies = new Map<string, (value: unknown) => void>();
const broadcasts: { type: string; [k: string]: unknown }[] = [];
const port = {
	onmessage: null as ((ev: { data: unknown }) => void) | null,
	postMessage(msg: { type?: string; id?: string; value?: unknown; error?: unknown }) {
		if (msg.type !== 'response' || !msg.id) {
			broadcasts.push(msg as { type: string });
			return;
		}
		replies.get(msg.id)?.(msg.value ?? msg.error);
		replies.delete(msg.id);
	},
	start() {}
};

function call<T>(cmd: string, args?: unknown): Promise<T> {
	const id = String(++seq);
	return new Promise<T>((resolve) => {
		replies.set(id, resolve as (v: unknown) => void);
		port.onmessage!({ data: { id, cmd, args } });
	});
}

const toWire = (b64: string) => b64.replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
const fromWire = (b64url: string) => bytesToBase64(base64UrlToBytes(b64url));
const fpHex = (k: openpgp.Key) => k.getFingerprint().toLowerCase();

interface Account {
	serverSetup: string;
	registrationRecord: string;
	wrappedMasterKey: string;
	masterKeyId: string;
	encryptedPrivateKey: string;
	passphrase: string;
	original: openpgp.PrivateKey;
}

let account: Account;

async function register(): Promise<Account> {
	const serverSetup = server.createSetup();
	const start = client.startRegistration({ password: PASSWORD });
	const { registrationResponse } = server.createRegistrationResponse({
		serverSetup,
		userIdentifier: ACCOUNT,
		registrationRequest: start.registrationRequest
	});
	const finish = client.finishRegistration({
		clientRegistrationState: start.clientRegistrationState,
		registrationResponse,
		password: PASSWORD,
		identifiers,
		keyStretching: KEY_STRETCHING
	});
	const amk = generateAMK();
	const wrapped = await wrapMasterKey(base64UrlToBytes(finish.exportKey), amk, false);
	const passphrase = await derivePgpPassphrase(amk);
	const { privateKey } = await openpgp.generateKey({
		type: 'curve25519',
		userIDs: [{ email: EMAIL }],
		format: 'object'
	});
	const locked = await openpgp.encryptKey({ privateKey, passphrase });
	return {
		serverSetup,
		registrationRecord: finish.registrationRecord,
		wrappedMasterKey: bytesToBase64(wrapped),
		masterKeyId: bytesToBase64(await deriveMasterKeyId(amk)),
		encryptedPrivateKey: locked.armor(),
		passphrase,
		original: privateKey
	};
}

async function unlock(): Promise<void> {
	const start = await call<{ operationId: string; ke1: string }>('opaqueStartAuth', {
		password: PASSWORD,
		email: EMAIL
	});
	const { loginResponse } = server.startLogin({
		serverSetup: account.serverSetup,
		userIdentifier: ACCOUNT,
		registrationRecord: account.registrationRecord,
		startLoginRequest: toWire(start.ke1),
		identifiers
	});
	await call('opaqueFinishAuth', {
		operationId: start.operationId,
		accountId: ACCOUNT,
		ke2: fromWire(loginResponse)
	});
	const res = await call<{ ok: boolean }>('opaqueCompleteLoginUnlock', {
		operationId: start.operationId,
		accountId: ACCOUNT,
		encryptedPrivateKey: account.encryptedPrivateKey,
		wrappedMasterKey: account.wrappedMasterKey,
		masterKeyId: account.masterKeyId,
		opaqueParamsVersion: 1,
		serverAuthScheme: 'opaque_v1'
	});
	expect(res.ok).toBe(true);
}

async function encryptTo(key: openpgp.Key, text: string): Promise<Uint8Array> {
	return (await openpgp.encrypt({
		message: await openpgp.createMessage({ text }),
		encryptionKeys: key.toPublic(),
		format: 'binary'
	})) as Uint8Array;
}

async function decrypt(ciphertext: Uint8Array, keyFingerprintHex?: string) {
	return call<{ ok: boolean; plaintext?: string; code?: string }>('decrypt', {
		accountId: ACCOUNT,
		ciphertextBinary: ciphertext,
		keyFingerprintHex
	});
}

async function currentFingerprint(): Promise<{ hex: string; keyVersion?: number }> {
	const r = await call<{ ok: boolean; fingerprint: Uint8Array; keyVersion?: number }>('getPublicKey', {
		accountId: ACCOUNT
	});
	return {
		hex: [...r.fingerprint].map((b) => b.toString(16).padStart(2, '0')).join(''),
		keyVersion: r.keyVersion
	};
}

async function lockedKey(email: string, passphrase: string) {
	const { privateKey } = await generateCurve25519Key({
		userIDs: [{ email }],
		date: new Date(Date.now() - 60_000)
	});
	return { privateKey, armored: (await lockKey(privateKey, passphrase)).armor() };
}

beforeAll(async () => {
	await ready;
	account = await register();
	vi.stubGlobal('self', globalThis);
	await import('./keystore-worker');
	(self as unknown as { onconnect: (ev: { ports: unknown[] }) => void }).onconnect({ ports: [port] });
	await unlock();
}, 60_000);

describe('account key rotation in the keystore', () => {
	let rotatedFp = '';
	let rotated: openpgp.PrivateKey;
	let oldMail: Uint8Array;

	it('starts with the login key as version 1', async () => {
		const cur = await currentFingerprint();
		expect(cur.hex).toBe(fpHex(account.original));
		expect(cur.keyVersion).toBe(1);
	});

	it('refuses to rotate from a stale key version', async () => {
		const res = await call<{ ok: boolean; code?: string }>('prepareKeyRotation', {
			accountId: ACCOUNT,
			emails: [EMAIL],
			expectedKeyVersion: 2
		});
		expect(res).toEqual({ ok: false, code: 'stale_key_version' });
	});

	it('prepares a v6 key endorsed by the current key over the shared payload', async () => {
		oldMail = await encryptTo(account.original, 'before the rotation');
		const res = await call<{
			ok: boolean;
			publicKeyArmored: string;
			encryptedPrivateKey: string;
			fingerprintHex: string;
			keyVersion: number;
			transitions: { previousKeyFingerprintHex: string; signature: Uint8Array }[];
		}>('prepareKeyRotation', { accountId: ACCOUNT, emails: [EMAIL], expectedKeyVersion: 1 });
		expect(res.ok).toBe(true);
		expect(res.keyVersion).toBe(2);
		const pub = await openpgp.readKey({ armoredKey: res.publicKeyArmored });
		expect(pub.keyPacket.version).toBe(6);
		expect(fpHex(pub)).toBe(res.fingerprintHex);
		expect(res.transitions.map((t) => t.previousKeyFingerprintHex)).toEqual([fpHex(account.original)]);
		await verifyKeyTransition({
			accountId: ACCOUNT,
			newKeyFingerprint: res.fingerprintHex,
			previousKeyFingerprint: fpHex(account.original),
			signature: res.transitions[0].signature,
			previousPublicKeyArmored: account.original.toPublic().armor()
		});
		const locked = await openpgp.readPrivateKey({ armoredKey: res.encryptedPrivateKey });
		rotated = await openpgp.decryptKey({ privateKey: locked, passphrase: account.passphrase });
		rotatedFp = res.fingerprintHex;
		expect(await currentFingerprint()).toEqual({ hex: fpHex(account.original), keyVersion: 1 });
	});

	it('refuses to commit a key it did not prepare', async () => {
		const res = await call<{ ok: boolean; code?: string }>('commitKeyRotation', {
			accountId: ACCOUNT,
			fingerprintHex: 'ab'.repeat(32)
		});
		expect(res).toEqual({ ok: false, code: 'no_pending_rotation' });
	});

	it('commits the new key and keeps the old one for reading', async () => {
		broadcasts.length = 0;
		const res = await call<{ ok: boolean; keyVersion: number }>('commitKeyRotation', {
			accountId: ACCOUNT,
			fingerprintHex: rotatedFp
		});
		expect(res).toEqual({ ok: true, keyVersion: 2 });
		expect(await currentFingerprint()).toEqual({ hex: rotatedFp, keyVersion: 2 });
		expect(broadcasts.map((b) => b.type)).toEqual(['accountKeysChanged', 'vaultChanged']);
		expect(broadcasts[0]).toMatchObject({ currentChanged: true, currentFingerprintHex: rotatedFp, keyVersion: 2 });

		expect(await decrypt(oldMail)).toMatchObject({ ok: true, plaintext: 'before the rotation' });
		expect(await decrypt(oldMail, fpHex(account.original))).toMatchObject({ ok: true });
		expect(await decrypt(await encryptTo(rotated, 'after'))).toMatchObject({ ok: true, plaintext: 'after' });
	});

	it('unwraps an alias grant sealed to the retired key', async () => {
		const alias = await openpgp.generateKey({
			type: 'curve25519',
			userIDs: [{ email: 'team@thelemail.test' }],
			format: 'object'
		});
		const wrapped = await openpgp.encrypt({
			message: await openpgp.createMessage({ text: alias.privateKey.armor() }),
			encryptionKeys: account.original.toPublic(),
			format: 'armored'
		});
		const res = await call<{ ok: boolean; loaded: string[]; failed: unknown[] }>('loadAliasKeys', {
			accountId: ACCOUNT,
			grants: [
				{
					aliasId: 'alias-1',
					addressId: 'address-1',
					email: 'team@thelemail.test',
					name: 'Team',
					keyVersion: 1,
					aliasKeyFingerprintHex: fpHex(alias.privateKey),
					wrappedPrivateKeyArmored: wrapped,
					isCurrent: true
				}
			]
		});
		expect(res.loaded).toEqual([fpHex(alias.privateKey)]);
		expect(res.failed).toEqual([]);
	});

	it('adopts a newer key another device published, and skips keys it cannot unlock', async () => {
		const newer = await lockedKey(EMAIL, account.passphrase);
		const foreign = await lockedKey(EMAIL, 'not our passphrase');
		broadcasts.length = 0;
		const res = await call<{
			ok: boolean;
			loaded: string[];
			failed: number[];
			currentChanged: boolean;
			keyVersion: number;
			currentFingerprintHex: string;
		}>('loadAccountKeys', {
			accountId: ACCOUNT,
			keys: [
				{ keyVersion: 3, fingerprintHex: fpHex(newer.privateKey), encryptedPrivateKeyArmored: newer.armored, isCurrent: true },
				{ keyVersion: 4, fingerprintHex: fpHex(foreign.privateKey), encryptedPrivateKeyArmored: foreign.armored, isCurrent: false },
				{ keyVersion: 2, fingerprintHex: rotatedFp, encryptedPrivateKeyArmored: (await lockKey(rotated, account.passphrase)).armor(), isCurrent: false }
			]
		});
		expect(res.ok).toBe(true);
		expect(res.failed).toEqual([4]);
		expect(res.currentChanged).toBe(true);
		expect(res.keyVersion).toBe(3);
		expect(res.currentFingerprintHex).toBe(fpHex(newer.privateKey));
		expect(broadcasts.map((b) => b.type)).toEqual(['accountKeysChanged']);
		expect(await decrypt(oldMail)).toMatchObject({ ok: true });
	});

	it('rejects a key whose armour does not match the fingerprint it claims', async () => {
		const other = await lockedKey(EMAIL, account.passphrase);
		const res = await call<{ ok: boolean; failed: number[] }>('loadAccountKeys', {
			accountId: ACCOUNT,
			keys: [{ keyVersion: 9, fingerprintHex: 'ab'.repeat(32), encryptedPrivateKeyArmored: other.armored, isCurrent: true }]
		});
		expect(res.failed).toEqual([9]);
		expect((await currentFingerprint()).keyVersion).toBe(3);
	});

	it('never moves back to an older key', async () => {
		const res = await call<{ ok: boolean; currentChanged: boolean; keyVersion: number }>('loadAccountKeys', {
			accountId: ACCOUNT,
			keys: [{ keyVersion: 1, fingerprintHex: fpHex(account.original), encryptedPrivateKeyArmored: account.encryptedPrivateKey, isCurrent: true }]
		});
		expect(res).toMatchObject({ ok: true, currentChanged: false, keyVersion: 3 });
	});

	it('lists every key it holds, newest first', async () => {
		const res = await call<{ ok: boolean; keyVersion: number; keys: { keyVersion: number; isCurrent: boolean }[] }>(
			'listAccountKeys',
			{ accountId: ACCOUNT }
		);
		expect(res.keyVersion).toBe(3);
		expect(res.keys.map((k) => [k.keyVersion, k.isCurrent])).toEqual([
			[3, true],
			[2, false],
			[1, false]
		]);
	});

	it('endorses with every retained key on the next rotation', async () => {
		const res = await call<{
			ok: boolean;
			fingerprintHex: string;
			transitions: { previousKeyFingerprintHex: string }[];
		}>('prepareKeyRotation', { accountId: ACCOUNT, emails: [EMAIL], expectedKeyVersion: 3 });
		expect(res.ok).toBe(true);
		expect(res.transitions).toHaveLength(3);
		await call('abandonKeyRotation', { accountId: ACCOUNT });
		expect(
			await call('commitKeyRotation', { accountId: ACCOUNT, fingerprintHex: res.fingerprintHex })
		).toEqual({ ok: false, code: 'no_pending_rotation' });
	});

	it('keeps the server version when a reload lands before the commit', async () => {
		const prepared = await call<{
			ok: boolean;
			fingerprintHex: string;
			encryptedPrivateKey: string;
			keyVersion: number;
		}>('prepareKeyRotation', { accountId: ACCOUNT, emails: [EMAIL], expectedKeyVersion: 3 });
		expect(prepared).toMatchObject({ ok: true, keyVersion: 4 });
		const loaded = await call<{ ok: boolean; keyVersion: number; currentChanged: boolean }>('loadAccountKeys', {
			accountId: ACCOUNT,
			keys: [
				{
					keyVersion: 4,
					fingerprintHex: prepared.fingerprintHex,
					encryptedPrivateKeyArmored: prepared.encryptedPrivateKey,
					isCurrent: true
				}
			]
		});
		expect(loaded).toMatchObject({ ok: true, keyVersion: 4, currentChanged: true });
		expect(
			await call('commitKeyRotation', { accountId: ACCOUNT, fingerprintHex: prepared.fingerprintHex })
		).toEqual({ ok: true, keyVersion: 4 });
		expect(await currentFingerprint()).toEqual({ hex: prepared.fingerprintHex, keyVersion: 4 });
		const next = await call<{ ok: boolean; keyVersion: number }>('prepareKeyRotation', {
			accountId: ACCOUNT,
			emails: [EMAIL],
			expectedKeyVersion: 4
		});
		expect(next).toMatchObject({ ok: true, keyVersion: 5 });
		await call('abandonKeyRotation', { accountId: ACCOUNT });
	});

	it('refuses to rotate when a recent key is missing from the vault', async () => {
		const gap = await lockedKey(EMAIL, account.passphrase);
		await call('loadAccountKeys', {
			accountId: ACCOUNT,
			keys: [{ keyVersion: 6, fingerprintHex: fpHex(gap.privateKey), encryptedPrivateKeyArmored: gap.armored, isCurrent: true }]
		});
		const res = await call<{ ok: boolean; code?: string }>('prepareKeyRotation', {
			accountId: ACCOUNT,
			emails: [EMAIL],
			expectedKeyVersion: 6
		});
		expect(res).toEqual({ ok: false, code: 'key_history_incomplete' });
	});
});
