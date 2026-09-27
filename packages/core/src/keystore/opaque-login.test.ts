// @vitest-environment node
import { afterEach, beforeAll, describe, expect, it, vi } from 'vitest';
import * as openpgp from 'openpgp';
import { client, ready, server } from '@serenity-kit/opaque';
import type { OpaqueOperation } from './opaque-ops';
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

const settled = vi.hoisted(() => [] as { op: OpaqueOperation; key: Uint8Array }[]);

vi.mock('./opaque-ops', async (importOriginal) => {
	const actual = await importOriginal<typeof import('./opaque-ops')>();
	return {
		...actual,
		settleLogin: (op: OpaqueOperation, accountId: string, key: Uint8Array, now?: number) => {
			settled.push({ op, key });
			actual.settleLogin(op, accountId, key, now);
		}
	};
});

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

const ACCOUNT = '120792e5-d313-4c0e-aa94-4a4b00cab094';
const EMAIL = 'r@thelemail.com';
const PASSWORD = 'correct horse battery staple';

interface Account {
	serverSetup: string;
	registrationRecord: string;
	wrappedMasterKey: string;
	masterKeyId: string;
	encryptedPrivateKey: string;
}

let account: Account;
let seq = 0;
const replies = new Map<string, (value: unknown) => void>();
const port = {
	onmessage: null as ((ev: { data: unknown }) => void) | null,
	postMessage(msg: { type?: string; id?: string; value?: unknown; error?: unknown }) {
		if (msg.type !== 'response' || !msg.id) return;
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
const zeroed = (b: Uint8Array) => b.every((x) => x === 0);
const identifiers = { client: clientIdentity(ACCOUNT, false), server: SERVER_IDENTITY };

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
	const { privateKey } = await openpgp.generateKey({
		type: 'curve25519',
		userIDs: [{ email: EMAIL }],
		passphrase: await derivePgpPassphrase(amk),
		format: 'armored'
	});
	return {
		serverSetup,
		registrationRecord: finish.registrationRecord,
		wrappedMasterKey: bytesToBase64(wrapped),
		masterKeyId: bytesToBase64(await deriveMasterKeyId(amk)),
		encryptedPrivateKey: privateKey
	};
}

async function authenticate(password: string) {
	const start = await call<{ operationId: string; ke1: string }>('opaqueStartAuth', {
		password,
		email: EMAIL
	});
	const { loginResponse } = server.startLogin({
		serverSetup: account.serverSetup,
		userIdentifier: ACCOUNT,
		registrationRecord: account.registrationRecord,
		startLoginRequest: toWire(start.ke1),
		identifiers
	});
	const finish = await call<{ ok: boolean; code?: string; ke3?: string }>('opaqueFinishAuth', {
		operationId: start.operationId,
		accountId: ACCOUNT,
		ke2: fromWire(loginResponse)
	});
	return { operationId: start.operationId, finish };
}

function unlock(operationId: string, overrides: Partial<Record<string, string>> = {}) {
	return call<{ ok: boolean; code?: string }>('opaqueCompleteLoginUnlock', {
		operationId,
		accountId: ACCOUNT,
		encryptedPrivateKey: account.encryptedPrivateKey,
		wrappedMasterKey: account.wrappedMasterKey,
		masterKeyId: account.masterKeyId,
		opaqueParamsVersion: 1,
		serverAuthScheme: 'opaque_v1',
		...overrides
	});
}

function lastSettled() {
	const entry = settled.at(-1);
	if (!entry) throw new Error('no login settled');
	return entry;
}

beforeAll(async () => {
	await ready;
	account = await register();
	vi.stubGlobal('self', globalThis);
	await import('./keystore-worker');
	(self as unknown as { onconnect: (ev: { ports: unknown[] }) => void }).onconnect({ ports: [port] });
}, 60_000);

afterEach(() => {
	vi.useRealTimers();
	settled.length = 0;
});

describe('pending OPAQUE login in the keystore', () => {
	it('drops the password and client state as soon as finishLogin succeeds', async () => {
		const { operationId, finish } = await authenticate(PASSWORD);

		expect(finish.ok).toBe(true);
		const { op, key } = lastSettled();
		expect(op.password).toBeUndefined();
		expect(op.clientState).toBeUndefined();
		expect(Object.keys(op).filter((k) => op[k as keyof OpaqueOperation] !== undefined).sort()).toEqual(
			['accountId', 'at', 'email', 'exportKey', 'kind', 'recovery']
		);
		expect(key.length).toBeGreaterThan(0);
		expect(zeroed(key)).toBe(false);

		await call('opaqueAbandonOperation', { operationId });
	});

	it('refuses to run finishLogin twice on the same operation', async () => {
		const { operationId } = await authenticate(PASSWORD);

		const again = await call<{ ok: boolean; code?: string }>('opaqueFinishAuth', {
			operationId,
			accountId: ACCOUNT,
			ke2: 'AAAA'
		});

		expect(again).toEqual({ ok: false, code: 'no_pending_operation' });
		expect(zeroed(lastSettled().key)).toBe(false);
		await call('opaqueAbandonOperation', { operationId });
	});

	it('zeroes the export key once the vault is unlocked', async () => {
		const { operationId } = await authenticate(PASSWORD);
		const { key } = lastSettled();

		expect(await unlock(operationId)).toMatchObject({ ok: true, accountId: ACCOUNT });

		expect(zeroed(key)).toBe(true);
		expect(await unlock(operationId)).toEqual({ ok: false, code: 'no_pending_operation' });
	});

	it('forgets the operation when the password is wrong', async () => {
		const { operationId, finish } = await authenticate('not the password');

		expect(finish).toEqual({ ok: false, code: 'invalid_credentials' });
		expect(settled).toHaveLength(0);
		expect(await unlock(operationId)).toEqual({ ok: false, code: 'no_pending_operation' });
	});

	it('forgets the operation when finishLogin throws', async () => {
		const start = await call<{ operationId: string }>('opaqueStartAuth', { password: PASSWORD, email: EMAIL });

		const res = await call<unknown>('opaqueFinishAuth', {
			operationId: start.operationId,
			accountId: ACCOUNT,
			ke2: 'AAAA'
		});

		expect(res).toMatch(/opaque protocol error/);
		expect(await unlock(start.operationId)).toEqual({ ok: false, code: 'no_pending_operation' });
	});

	it('zeroes the export key when the unlock fails', async () => {
		const { operationId } = await authenticate(PASSWORD);
		const { key } = lastSettled();

		expect(await unlock(operationId, { masterKeyId: bytesToBase64(new Uint8Array(32)) })).toEqual({
			ok: false,
			code: 'master_key_mismatch'
		});
		expect(zeroed(key)).toBe(true);
	});

	it('zeroes the export key when the unlock names another account', async () => {
		const { operationId } = await authenticate(PASSWORD);
		const { key } = lastSettled();

		expect(await unlock(operationId, { accountId: 'someone-else' })).toEqual({
			ok: false,
			code: 'no_pending_operation'
		});
		expect(zeroed(key)).toBe(true);
		expect(await unlock(operationId)).toEqual({ ok: false, code: 'no_pending_operation' });
	});

	it('zeroes the export key when the login is abandoned', async () => {
		const { operationId } = await authenticate(PASSWORD);
		const { key } = lastSettled();

		await call('opaqueAbandonOperation', { operationId });

		expect(zeroed(key)).toBe(true);
		expect(await unlock(operationId)).toEqual({ ok: false, code: 'no_pending_operation' });
	});

	it('zeroes the export key when the operation expires', async () => {
		const { operationId } = await authenticate(PASSWORD);
		const { key } = lastSettled();

		vi.useFakeTimers({ toFake: ['Date'] });
		vi.setSystemTime(Date.now() + 11 * 60 * 1000);
		await call('opaqueStartAuth', { password: PASSWORD, email: EMAIL });

		expect(zeroed(key)).toBe(true);
		expect(await unlock(operationId)).toEqual({ ok: false, code: 'no_pending_operation' });
	});
});
