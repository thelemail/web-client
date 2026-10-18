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
import { keyTransitionPayload, verifyKeyTransition } from '$core/directory/key-transition';
import { generateCurve25519Key, lockKey } from '$core/keys/pgpKeys';

vi.mock('@protontech/crypto', () => ({ CryptoProxy: { setEndpoint() {} } }));
vi.mock('@protontech/crypto/proxy/endpoint/api.ts', () => ({
	Api: class {
		static init() {}
	}
}));
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
const FRESH = '7c2e9a10-3b4d-4e5f-8a6b-1c2d3e4f5a6b';
const EMAIL = 'nora@thelemail.test';
const FRESH_EMAIL = 'ines@thelemail.test';
const PASSWORD = 'correct horse battery staple';

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

async function register(accountId = ACCOUNT, email = EMAIL): Promise<Account> {
	const identifiers = { client: clientIdentity(accountId, false), server: SERVER_IDENTITY };
	const serverSetup = server.createSetup();
	const start = client.startRegistration({ password: PASSWORD });
	const { registrationResponse } = server.createRegistrationResponse({
		serverSetup,
		userIdentifier: accountId,
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
		userIDs: [{ email }],
		format: 'object',
		date: new Date(Date.now() - 120_000)
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

async function unlock(
	who: Account = account,
	accountId = ACCOUNT,
	email = EMAIL,
	encryptedPrivateKey = who.encryptedPrivateKey
): Promise<void> {
	const identifiers = { client: clientIdentity(accountId, false), server: SERVER_IDENTITY };
	const start = await call<{ operationId: string; ke1: string }>('opaqueStartAuth', {
		password: PASSWORD,
		email
	});
	const { loginResponse } = server.startLogin({
		serverSetup: who.serverSetup,
		userIdentifier: accountId,
		registrationRecord: who.registrationRecord,
		startLoginRequest: toWire(start.ke1),
		identifiers
	});
	await call('opaqueFinishAuth', {
		operationId: start.operationId,
		accountId,
		ke2: fromWire(loginResponse)
	});
	const res = await call<{ ok: boolean }>('opaqueCompleteLoginUnlock', {
		operationId: start.operationId,
		accountId,
		encryptedPrivateKey,
		wrappedMasterKey: who.wrappedMasterKey,
		masterKeyId: who.masterKeyId,
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

async function currentFingerprint(accountId = ACCOUNT): Promise<{ hex: string; keyVersion?: number }> {
	const r = await call<{ ok: boolean; fingerprint: Uint8Array; keyVersion?: number }>('getPublicKey', {
		accountId
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

interface Transition {
	previousKeyFingerprintHex: string;
	signature: Uint8Array;
}

interface ServerKey {
	key: openpgp.PrivateKey;
	armored: string;
	transitions: Transition[];
}

async function endorsement(accountId: string, by: openpgp.PrivateKey, next: openpgp.Key): Promise<Transition> {
	const signature = (await openpgp.sign({
		message: await openpgp.createMessage({ binary: keyTransitionPayload(accountId, fpHex(next), fpHex(by)) }),
		signingKeys: by,
		detached: true,
		format: 'binary'
	})) as Uint8Array;
	return { previousKeyFingerprintHex: fpHex(by), signature };
}

async function rotatedOnAnotherDevice(
	accountId: string,
	passphrase: string,
	endorsers: openpgp.PrivateKey[]
): Promise<ServerKey> {
	const next = await lockedKey(EMAIL, passphrase);
	const transitions = [];
	for (const by of endorsers) transitions.push(await endorsement(accountId, by, next.privateKey));
	return { key: next.privateKey, armored: next.armored, transitions };
}

function keyList(accountId: string, keys: ServerKey[]) {
	return {
		accountId,
		currentVersion: keys.length,
		keys: keys.map((k, i) => ({
			keyVersion: i + 1,
			fingerprintHex: fpHex(k.key),
			encryptedPrivateKeyArmored: k.armored,
			isCurrent: i === keys.length - 1,
			transitions: k.transitions
		}))
	};
}

interface LoadResult {
	ok: boolean;
	code?: string;
	loaded: string[];
	failed: number[];
	unverified: number[];
	currentChanged: boolean;
	keyVersion: number;
	currentFingerprintHex: string;
}

function load(args: unknown): Promise<LoadResult> {
	return call<LoadResult>('loadAccountKeys', args);
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
	const history: ServerKey[] = [];

	it('starts with the login key as version 1', async () => {
		const cur = await currentFingerprint();
		expect(cur.hex).toBe(fpHex(account.original));
		expect(cur.keyVersion).toBe(1);
		history.push({ key: account.original, armored: account.encryptedPrivateKey, transitions: [] });
		expect(await load(keyList(ACCOUNT, history))).toMatchObject({
			ok: true,
			failed: [],
			unverified: [],
			currentChanged: false,
			keyVersion: 1
		});
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
			transitions: Transition[];
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
		history.push({ key: rotated, armored: res.encryptedPrivateKey, transitions: res.transitions });
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

	it('accepts the server list for its own rotation unchanged', async () => {
		expect(await load(keyList(ACCOUNT, history))).toMatchObject({
			ok: true,
			failed: [],
			unverified: [],
			currentChanged: false,
			keyVersion: 2,
			currentFingerprintHex: rotatedFp
		});
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

	it('restores every key from the persistent vault after a rotation', async () => {
		const serverHalf = bytesToBase64(crypto.getRandomValues(new Uint8Array(32)));
		await call('enrollPersistent', { accountId: ACCOUNT, serverHalf });
		await call('lock', { accountId: ACCOUNT });
		expect(await decrypt(oldMail)).toMatchObject({ ok: false });
		expect(await call('tryRestoreFromPersistent', { accountId: ACCOUNT, serverHalf })).toMatchObject({ ok: true });
		expect(await currentFingerprint()).toEqual({ hex: rotatedFp, keyVersion: 2 });
		expect(await decrypt(oldMail)).toMatchObject({ ok: true, plaintext: 'before the rotation' });
		expect(await decrypt(oldMail, fpHex(account.original))).toMatchObject({ ok: true });
	});

	it('refuses a list that relabels a retired key as the newest', async () => {
		const filler = async (): Promise<ServerKey> => {
			const k = await lockedKey(EMAIL, account.passphrase);
			return { key: k.privateKey, armored: k.armored, transitions: [] };
		};
		const replayed = { ...history[0], transitions: [await endorsement(ACCOUNT, rotated, history[0].key)] };
		const replay = keyList(ACCOUNT, [await filler(), history[1], await filler(), replayed]);
		broadcasts.length = 0;
		expect(await load(replay)).toEqual({ ok: false, code: 'key_list_invalid' });
		expect(
			await load({
				accountId: ACCOUNT,
				currentVersion: 4,
				keys: [{ ...keyList(ACCOUNT, [history[0]]).keys[0], keyVersion: 4, isCurrent: true }]
			})
		).toEqual({ ok: false, code: 'key_list_invalid' });
		expect(broadcasts).toEqual([]);
		expect(await currentFingerprint()).toEqual({ hex: rotatedFp, keyVersion: 2 });
	});

	it('refuses lists with a gap, two current keys or a repeated version', async () => {
		const third = await rotatedOnAnotherDevice(ACCOUNT, account.passphrase, [rotated]);
		const good = keyList(ACCOUNT, [...history, third]);
		const gap = { ...good, keys: [good.keys[0], good.keys[2]] };
		const twoCurrent = { ...good, keys: good.keys.map((k) => ({ ...k, isCurrent: k.keyVersion >= 2 })) };
		const repeated = { ...good, keys: [good.keys[0], { ...good.keys[1], keyVersion: 3 }, good.keys[2]] };
		const wrongCount = { ...good, currentVersion: 4 };
		const currentNotNewest = {
			...good,
			keys: good.keys.map((k) => ({ ...k, isCurrent: k.keyVersion === 2 }))
		};
		const duplicateFingerprint = {
			...good,
			keys: [good.keys[0], good.keys[1], { ...good.keys[2], fingerprintHex: good.keys[1].fingerprintHex }]
		};
		for (const bad of [gap, twoCurrent, repeated, wrongCount, currentNotNewest, duplicateFingerprint]) {
			expect(await load(bad)).toEqual({ ok: false, code: 'key_list_invalid' });
		}
		expect(await currentFingerprint()).toEqual({ hex: rotatedFp, keyVersion: 2 });
	});

	it('does not adopt a newer key without an endorsement from the current key', async () => {
		const bare = await rotatedOnAnotherDevice(ACCOUNT, account.passphrase, []);
		const byOldest = await rotatedOnAnotherDevice(ACCOUNT, account.passphrase, [account.original]);
		const forged = await rotatedOnAnotherDevice(ACCOUNT, account.passphrase, []);
		forged.transitions = [{ ...(await endorsement(ACCOUNT, rotated, bare.key)) }];
		const otherAccount = await rotatedOnAnotherDevice(ACCOUNT, account.passphrase, []);
		otherAccount.transitions = [await endorsement(FRESH, rotated, otherAccount.key)];
		for (const candidate of [bare, byOldest, forged, otherAccount]) {
			broadcasts.length = 0;
			const res = await load(keyList(ACCOUNT, [...history, candidate]));
			expect(res).toMatchObject({
				ok: true,
				failed: [],
				unverified: [3],
				currentChanged: false,
				keyVersion: 2,
				currentFingerprintHex: rotatedFp
			});
			expect(broadcasts[0]).toMatchObject({ currentChanged: false, keyVersion: 2 });
		}
		const listed = await call<{ keys: { fingerprintHex: string }[] }>('listAccountKeys', { accountId: ACCOUNT });
		expect(listed.keys.map((k) => k.fingerprintHex)).toEqual([rotatedFp, fpHex(account.original)]);
	});

	it('follows the chain across two rotations made while it was offline', async () => {
		const third = await rotatedOnAnotherDevice(ACCOUNT, account.passphrase, [rotated, account.original]);
		const fourth = await rotatedOnAnotherDevice(ACCOUNT, account.passphrase, [third.key, rotated, account.original]);
		const foreign = await lockedKey(EMAIL, 'not our passphrase');
		const unendorsed = await rotatedOnAnotherDevice(ACCOUNT, account.passphrase, [account.original]);
		broadcasts.length = 0;
		const res = await load(
			keyList(ACCOUNT, [...history, third, fourth, { key: foreign.privateKey, armored: foreign.armored, transitions: [] }, unendorsed])
		);
		expect(res).toMatchObject({
			ok: true,
			failed: [5],
			unverified: [6],
			currentChanged: true,
			keyVersion: 4,
			currentFingerprintHex: fpHex(fourth.key)
		});
		expect(broadcasts.map((b) => b.type)).toEqual(['accountKeysChanged']);
		expect(broadcasts[0]).toMatchObject({
			accountId: ACCOUNT,
			currentFingerprintHex: fpHex(fourth.key),
			keyVersion: 4,
			currentChanged: true
		});
		expect(await currentFingerprint()).toEqual({ hex: fpHex(fourth.key), keyVersion: 4 });
		expect(await decrypt(oldMail)).toMatchObject({ ok: true });
		history.push(third, fourth);
	});

	it('never moves back to an older key', async () => {
		const res = await load(keyList(ACCOUNT, history.slice(0, 2)));
		expect(res).toMatchObject({ ok: true, currentChanged: false, keyVersion: 4 });
		expect(await currentFingerprint()).toEqual({ hex: fpHex(history[3].key), keyVersion: 4 });
	});

	it('lists every key it holds, newest first', async () => {
		const res = await call<{ ok: boolean; keyVersion: number; keys: { keyVersion: number; isCurrent: boolean }[] }>(
			'listAccountKeys',
			{ accountId: ACCOUNT }
		);
		expect(res.keyVersion).toBe(4);
		expect(res.keys.map((k) => [k.keyVersion, k.isCurrent])).toEqual([
			[4, true],
			[3, false],
			[2, false],
			[1, false]
		]);
	});

	it('endorses with every retained key on the next rotation', async () => {
		const res = await call<{
			ok: boolean;
			fingerprintHex: string;
			transitions: { previousKeyFingerprintHex: string }[];
		}>('prepareKeyRotation', { accountId: ACCOUNT, emails: [EMAIL], expectedKeyVersion: 4 });
		expect(res.ok).toBe(true);
		expect(res.transitions).toHaveLength(4);
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
			transitions: Transition[];
		}>('prepareKeyRotation', { accountId: ACCOUNT, emails: [EMAIL], expectedKeyVersion: 4 });
		expect(prepared).toMatchObject({ ok: true, keyVersion: 5 });
		const pending = await openpgp.decryptKey({
			privateKey: await openpgp.readPrivateKey({ armoredKey: prepared.encryptedPrivateKey }),
			passphrase: account.passphrase
		});
		history.push({ key: pending, armored: prepared.encryptedPrivateKey, transitions: prepared.transitions });
		const loaded = await load(keyList(ACCOUNT, history));
		expect(loaded).toMatchObject({ ok: true, keyVersion: 5, currentChanged: true, unverified: [] });
		expect(
			await call('commitKeyRotation', { accountId: ACCOUNT, fingerprintHex: prepared.fingerprintHex })
		).toEqual({ ok: true, keyVersion: 5 });
		expect(await currentFingerprint()).toEqual({ hex: prepared.fingerprintHex, keyVersion: 5 });
		const next = await call<{ ok: boolean; keyVersion: number }>('prepareKeyRotation', {
			accountId: ACCOUNT,
			emails: [EMAIL],
			expectedKeyVersion: 5
		});
		expect(next).toMatchObject({ ok: true, keyVersion: 6 });
		await call('abandonKeyRotation', { accountId: ACCOUNT });
	});
});

describe('a fresh sign-in on a rotated account', () => {
	let fresh: Account;
	const chain: ServerKey[] = [];

	beforeAll(async () => {
		fresh = await register(FRESH, FRESH_EMAIL);
		chain.push({ key: fresh.original, armored: fresh.encryptedPrivateKey, transitions: [] });
		const second = await rotatedOnAnotherDevice(FRESH, fresh.passphrase, [fresh.original]);
		chain.push(second);
		chain.push(await rotatedOnAnotherDevice(FRESH, fresh.passphrase, [second.key, fresh.original]));
	}, 60_000);

	it('climbs from a retired key served at sign-in to the endorsed current key', async () => {
		await unlock(fresh, FRESH, FRESH_EMAIL);
		expect((await currentFingerprint(FRESH)).hex).toBe(fpHex(fresh.original));
		const res = await load(keyList(FRESH, chain));
		expect(res).toMatchObject({
			ok: true,
			failed: [],
			unverified: [],
			currentChanged: true,
			keyVersion: 3,
			currentFingerprintHex: fpHex(chain[2].key)
		});
	});

	it('takes the version of the sign-in key from the list and keeps older keys for reading', async () => {
		await call('clear', { accountId: FRESH });
		await unlock(fresh, FRESH, FRESH_EMAIL, chain[2].armored);
		expect(await currentFingerprint(FRESH)).toEqual({ hex: fpHex(chain[2].key), keyVersion: 1 });
		expect(
			await call('prepareKeyRotation', { accountId: FRESH, emails: [FRESH_EMAIL], expectedKeyVersion: 1 })
		).toEqual({ ok: false, code: 'stale_key_version' });
		const foreign = await lockedKey(FRESH_EMAIL, 'not our passphrase');
		const res = await load(
			keyList(FRESH, [{ key: foreign.privateKey, armored: foreign.armored, transitions: [] }, chain[1], chain[2]])
		);
		expect(res).toMatchObject({
			ok: true,
			failed: [1],
			unverified: [],
			currentChanged: false,
			keyVersion: 3,
			currentFingerprintHex: fpHex(chain[2].key)
		});
		expect(await currentFingerprint(FRESH)).toEqual({ hex: fpHex(chain[2].key), keyVersion: 3 });
		const mail = await encryptTo(chain[1].key, 'second key mail');
		expect(
			await call('decrypt', { accountId: FRESH, ciphertextBinary: mail })
		).toMatchObject({ ok: true, plaintext: 'second key mail' });
		expect(
			await call('prepareKeyRotation', { accountId: FRESH, emails: [FRESH_EMAIL], expectedKeyVersion: 3 })
		).toEqual({ ok: false, code: 'key_history_incomplete' });
	});

	it('refuses a list that leaves out the key it signed in with', async () => {
		const res = await load(keyList(FRESH, [chain[0], chain[1]]));
		expect(res).toMatchObject({ ok: true, currentChanged: false, keyVersion: 3 });
		await call('clear', { accountId: FRESH });
		await unlock(fresh, FRESH, FRESH_EMAIL, chain[2].armored);
		expect(await load(keyList(FRESH, [chain[0], chain[1]]))).toEqual({ ok: false, code: 'key_list_invalid' });
		expect(await currentFingerprint(FRESH)).toEqual({ hex: fpHex(chain[2].key), keyVersion: 1 });
	});
});

describe('two sign-ins before any key list arrives', () => {
	const TWICE = '9d3f1a20-4c5e-4f6a-9b7c-2d3e4f5a6b7c';
	const TWICE_EMAIL = 'odile@thelemail.test';
	let twice: Account;
	let retired: ServerKey;
	let current: ServerKey;

	beforeAll(async () => {
		twice = await register(TWICE, TWICE_EMAIL);
		retired = { key: twice.original, armored: twice.encryptedPrivateKey, transitions: [] };
		const middle = await rotatedOnAnotherDevice(TWICE, twice.passphrase, [twice.original]);
		current = await rotatedOnAnotherDevice(TWICE, twice.passphrase, [middle.key, twice.original]);
	}, 60_000);

	it('never makes the earlier sign-in key current through a relabelled list', async () => {
		await unlock(twice, TWICE, TWICE_EMAIL);
		await unlock(twice, TWICE, TWICE_EMAIL, current.armored);
		expect((await currentFingerprint(TWICE)).hex).toBe(fpHex(current.key));
		const swapped = keyList(TWICE, [current, retired]);
		const res = await load(swapped);
		expect(res).toMatchObject({
			ok: true,
			unverified: [2],
			currentChanged: false,
			keyVersion: 1,
			currentFingerprintHex: fpHex(current.key)
		});
		await unlock(twice, TWICE, TWICE_EMAIL, current.armored);
		expect(await currentFingerprint(TWICE)).toEqual({ hex: fpHex(current.key), keyVersion: 1 });
		await unlock(twice, TWICE, TWICE_EMAIL);
		expect((await currentFingerprint(TWICE)).hex).toBe(fpHex(current.key));
		const mail = await encryptTo(retired.key, 'mail to the retired key');
		expect(await call('decrypt', { accountId: TWICE, ciphertextBinary: mail })).toMatchObject({
			ok: true,
			plaintext: 'mail to the retired key'
		});
	});
});
