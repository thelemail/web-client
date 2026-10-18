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

describe('key history across devices', () => {
	it('places a key rotated on another device above the stored history', async () => {
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
			encryptedPrivateKey: third.armored,
			wrappedMasterKey: account.wrappedMasterKey,
			masterKeyId: account.masterKeyId,
			opaqueParamsVersion: 1,
			serverAuthScheme: 'opaque_v1'
		});
		expect(res.ok).toBe(true);
		const listed = await call<{ keyVersion: number; keys: { fingerprintHex: string; keyVersion: number; isCurrent: boolean }[] }>(
			'listAccountKeys',
			{ accountId: ACCOUNT }
		);
		expect(listed.keyVersion).toBe(3);
		expect(listed.keys.map((k) => [k.fingerprintHex, k.keyVersion, k.isCurrent])).toEqual([
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
