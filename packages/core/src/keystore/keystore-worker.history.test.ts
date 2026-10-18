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
import type { VaultRecord } from './idb';
import { keyTransitionPayload } from '$core/directory/key-transition';

const RECOVERY_PASSPHRASE = 'recovery key password';
const SERVER_PROOF = btoa('server proof');

vi.mock('@protontech/crypto', () => ({ CryptoProxy: { setEndpoint() {} } }));
vi.mock('@protontech/crypto/proxy/endpoint/api.ts', () => ({
	Api: class {
		static init() {}
	}
}));
vi.mock('@protontech/crypto/srp', () => ({
	AUTH_VERSION: 4,
	computeKeyPassword: async () => 'recovery key password',
	generateKeySalt: () => 'salt',
	getRandomSrpVerifier: async () => ({ salt: 'salt', verifier: 'verifier' }),
	getSrp: async () => ({
		clientEphemeral: 'ephemeral',
		clientProof: 'proof',
		expectedServerProof: btoa('server proof')
	})
}));

const stored = vi.hoisted(() => ({ record: null as VaultRecord | null }));

vi.mock('./idb', () => ({
	getVault: async () => stored.record,
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

async function lockedWith(passphrase: string) {
	const { privateKey } = await openpgp.generateKey({
		type: 'curve25519',
		userIDs: [{ email: EMAIL }],
		format: 'object'
	});
	return { privateKey, armored: (await openpgp.encryptKey({ privateKey, passphrase })).armor() };
}

async function encryptTo(key: openpgp.Key, text: string): Promise<Uint8Array> {
	return (await openpgp.encrypt({
		message: await openpgp.createMessage({ text }),
		encryptionKeys: key.toPublic(),
		format: 'binary'
	})) as Uint8Array;
}

let second: { privateKey: openpgp.PrivateKey; armored: string };
let third: { privateKey: openpgp.PrivateKey; armored: string };

beforeAll(async () => {
	await ready;
	account = await register();
	second = await lockedWith(account.passphrase);
	third = await lockedWith(account.passphrase);
	stored.record = {
		accountId: ACCOUNT,
		email: EMAIL,
		authScheme: 'opaque_v1',
		wrappedMasterKey: account.wrappedMasterKey,
		masterKeyId: account.masterKeyId,
		opaqueParamsVersion: 1,
		armoredEncryptedPrivateKey: second.armored,
		accountKeys: [
			{ keyVersion: 2, fingerprintHex: fpHex(second.privateKey), armoredEncryptedPrivateKey: second.armored },
			{ keyVersion: 1, fingerprintHex: fpHex(account.original), armoredEncryptedPrivateKey: account.encryptedPrivateKey }
		],
		keyVersion: 2,
		updatedAt: Date.now()
	};
	vi.stubGlobal('self', globalThis);
	await import('./keystore-worker');
	(self as unknown as { onconnect: (ev: { ports: unknown[] }) => void }).onconnect({ ports: [port] });
}, 60_000);

async function signIn(encryptedPrivateKey: string): Promise<void> {
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
		encryptedPrivateKey,
		wrappedMasterKey: account.wrappedMasterKey,
		masterKeyId: account.masterKeyId,
		opaqueParamsVersion: 1,
		serverAuthScheme: 'opaque_v1'
	});
	expect(res.ok).toBe(true);
}

function listed() {
	return call<{ keyVersion: number; keys: { fingerprintHex: string; keyVersion: number; isCurrent: boolean }[] }>(
		'listAccountKeys',
		{ accountId: ACCOUNT }
	);
}

async function endorsement(by: openpgp.PrivateKey, next: openpgp.Key) {
	const signature = (await openpgp.sign({
		message: await openpgp.createMessage({ binary: keyTransitionPayload(ACCOUNT, fpHex(next), fpHex(by)) }),
		signingKeys: by,
		detached: true,
		format: 'binary'
	})) as Uint8Array;
	return { previousKeyFingerprintHex: fpHex(by), signature };
}

describe('key history across devices', () => {
	it('keeps the stored current key when sign-in hands back a retired one', async () => {
		await signIn(account.encryptedPrivateKey);
		const keys = await listed();
		expect(keys.keyVersion).toBe(2);
		expect(keys.keys.map((k) => [k.fingerprintHex, k.keyVersion, k.isCurrent])).toEqual([
			[fpHex(second.privateKey), 2, true],
			[fpHex(account.original), 1, false]
		]);
		await call('lock', { accountId: ACCOUNT });
	});

	it('adopts a key rotated on another device only once the stored key endorses it', async () => {
		await signIn(third.armored);
		const before = await listed();
		expect(before.keyVersion).toBe(2);
		expect(before.keys.map((k) => k.fingerprintHex)).toEqual([fpHex(second.privateKey), fpHex(account.original)]);
		const res = await call<{ ok: boolean; currentChanged: boolean; keyVersion: number; unverified: number[] }>(
			'loadAccountKeys',
			{
				accountId: ACCOUNT,
				currentVersion: 3,
				keys: [
					{
						keyVersion: 1,
						fingerprintHex: fpHex(account.original),
						encryptedPrivateKeyArmored: account.encryptedPrivateKey,
						isCurrent: false,
						transitions: []
					},
					{
						keyVersion: 2,
						fingerprintHex: fpHex(second.privateKey),
						encryptedPrivateKeyArmored: second.armored,
						isCurrent: false,
						transitions: [await endorsement(account.original, second.privateKey)]
					},
					{
						keyVersion: 3,
						fingerprintHex: fpHex(third.privateKey),
						encryptedPrivateKeyArmored: third.armored,
						isCurrent: true,
						transitions: [await endorsement(second.privateKey, third.privateKey)]
					}
				]
			}
		);
		expect(res).toMatchObject({ ok: true, currentChanged: true, keyVersion: 3, unverified: [] });
		const after = await listed();
		expect(after.keyVersion).toBe(3);
		expect(after.keys.map((k) => [k.fingerprintHex, k.keyVersion, k.isCurrent])).toEqual([
			[fpHex(third.privateKey), 3, true],
			[fpHex(second.privateKey), 2, false],
			[fpHex(account.original), 1, false]
		]);
		const old = await call<{ ok: boolean; plaintext?: string }>('decrypt', {
			accountId: ACCOUNT,
			ciphertextBinary: await encryptTo(account.original, 'first key mail')
		});
		expect(old).toMatchObject({ ok: true, plaintext: 'first key mail' });
	});

	it('refuses the recovery key reset once the vault holds key history', async () => {
		await call('prepareRecoveryLogin', {
			email: EMAIL,
			phrase: 'phrase',
			modulus: 'modulus',
			salt: 'salt',
			serverPublicEphemeral: 'ephemeral'
		});
		expect(await call('verifyRecoveryProof', { serverProof: SERVER_PROOF })).toEqual({ ok: true });
		const recoveryKey = await lockedWith(RECOVERY_PASSPHRASE);
		expect(
			await call('completeRecoveryUnlock', {
				encryptedPrivateKey: recoveryKey.armored,
				keySalt: 'salt',
				resetTokenExpiresInSeconds: 600
			})
		).toEqual({ ok: true });
		const prepared = await call<{ ok: boolean; operationId: string }>('opaquePrepareAmkRotation', {
			accountId: ACCOUNT,
			newPassword: 'a brand new password'
		});
		expect(prepared.ok).toBe(true);
		expect(
			await call('opaqueFinishAmkRotation', {
				operationId: prepared.operationId,
				registrationResponse: 'unused'
			})
		).toEqual({ ok: false, code: 'key_history_present' });
	});
});
