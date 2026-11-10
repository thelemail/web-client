// @vitest-environment node
import { beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import * as openpgp from 'openpgp';
import type { VaultRecord } from '../idb';
import { bytesToBase64, derivePgpPassphrase, generateAMK } from '../opaque-params';
import { generateCurve25519Key, lockKey } from '$core/keys/pgpKeys';
import { AUTH_VAULT_WRAP_INFO, LOCAL_KEY_UNSTORABLE } from '../vault-wrap';

vi.mock('@protontech/crypto', () => ({ CryptoProxy: { setEndpoint() {} } }));
vi.mock('@protontech/crypto/proxy/endpoint/api.ts', () => ({
	Api: class {
		static init() {}
	}
}));
vi.mock('../../products', () => ({ isAuthOrigin: true, isProductVault: false, currentProduct: 'auth' }));

const db = vi.hoisted(() => ({
	records: new Map<string, VaultRecord>(),
	failPut: null as (() => unknown) | null
}));

vi.mock('../idb', () => ({
	getVault: async (id: string) => db.records.get(id) ?? null,
	getAllVaults: async () => [...db.records.values()],
	putVault: async (rec: VaultRecord) => {
		if (db.failPut) throw db.failPut();
		db.records.set(rec.accountId, rec);
	},
	deleteVault: async (id: string) => {
		db.records.delete(id);
	},
	clearAllVaults: async () => db.records.clear(),
	getAllAccountSlots: async () => [],
	putAccountSlot: async () => undefined,
	deleteAccountSlot: async () => undefined,
	clearAllAccountSlots: async () => undefined
}));

const { cachedRecords, hasPersistentFor, vaults } = await import('./state');
const { deriveWrapKey, handleEnrollPersistent, handleTryRestoreFromPersistent } = await import(
	'./vault-persist'
);

const ACCOUNT = '4b1f2c3d-5e6f-4a7b-8c9d-0e1f2a3b4c5d';
const EMAIL = 'nora@thelemail.test';
const SERVER_HALF = bytesToBase64(crypto.getRandomValues(new Uint8Array(32)));
const info = new TextEncoder().encode(AUTH_VAULT_WRAP_INFO);

let amk: Uint8Array;
let armored: string;
let unlocked: openpgp.PrivateKey;

async function pageWrapKey(ikm: Uint8Array, serverHalf = SERVER_HALF): Promise<ArrayBuffer> {
	const key = await crypto.subtle.importKey('raw', ikm as BufferSource, 'HKDF', false, [
		'deriveBits'
	]);
	const salt = Uint8Array.from(atob(serverHalf), (c) => c.charCodeAt(0));
	return crypto.subtle.deriveBits({ name: 'HKDF', hash: 'SHA-256', salt, info }, key, 256);
}

function seedVault() {
	vaults.set(ACCOUNT, {
		accountId: ACCOUNT,
		email: EMAIL,
		authScheme: 'opaque_v1',
		masterKey: amk.slice(),
		armoredEncryptedPrivateKey: armored,
		privateKey: unlocked,
		keyPassword: 'unused',
		accountKeys: new Map(),
		keyVersion: 1,
		aliasKeys: new Map(),
		aliasCurrent: new Map()
	});
}

beforeAll(async () => {
	amk = generateAMK();
	const { privateKey } = await generateCurve25519Key({
		userIDs: [{ email: EMAIL }]
	});
	unlocked = privateKey;
	armored = (await lockKey(privateKey, await derivePgpPassphrase(amk))).armor();
});

beforeEach(() => {
	db.records.clear();
	db.failPut = null;
	cachedRecords.clear();
	vaults.clear();
	seedVault();
});

describe('page-held auth vault key', () => {
	it('derives the same AES key from page bits as the worker derives with deriveKey', async () => {
		const ikm = crypto.getRandomValues(new Uint8Array(32));
		const both = await crypto.subtle.importKey('raw', ikm as BufferSource, 'HKDF', false, [
			'deriveKey'
		]);
		const salt = Uint8Array.from(atob(SERVER_HALF), (c) => c.charCodeAt(0));
		const workerKey = await deriveWrapKey(both, salt, 2);
		const pageKey = await crypto.subtle.importKey(
			'raw',
			await pageWrapKey(ikm),
			{ name: 'AES-GCM', length: 256 },
			false,
			['encrypt', 'decrypt']
		);
		const iv = crypto.getRandomValues(new Uint8Array(12));
		const plaintext = new TextEncoder().encode('{"m":"x"}');
		const fromWorker = await crypto.subtle.encrypt({ name: 'AES-GCM', iv }, workerKey, plaintext);
		const fromPage = await crypto.subtle.encrypt({ name: 'AES-GCM', iv }, pageKey, plaintext);
		expect(new Uint8Array(fromPage)).toEqual(new Uint8Array(fromWorker));
		expect(
			new Uint8Array(await crypto.subtle.decrypt({ name: 'AES-GCM', iv }, workerKey, fromPage))
		).toEqual(plaintext);
	});

	it('reports an unstorable local key when the worker cannot clone it', async () => {
		db.failPut = () => new DOMException('The object can not be cloned.', 'DataCloneError');
		await expect(
			handleEnrollPersistent({ accountId: ACCOUNT, serverHalf: SERVER_HALF })
		).rejects.toThrow(LOCAL_KEY_UNSTORABLE);
		expect(cachedRecords.has(ACCOUNT)).toBe(false);
		expect(vaults.get(ACCOUNT)?.wrapKey).toBeUndefined();
	});

	it('passes other storage failures through unchanged', async () => {
		db.failPut = () => new DOMException('quota', 'QuotaExceededError');
		await expect(
			handleEnrollPersistent({ accountId: ACCOUNT, serverHalf: SERVER_HALF })
		).rejects.toThrow('quota');
	});

	it('enrols with a page wrap key, storing no CryptoKey, and zeroes the bytes', async () => {
		const wrapKey = await pageWrapKey(crypto.getRandomValues(new Uint8Array(32)));
		const view = new Uint8Array(wrapKey);
		await handleEnrollPersistent({
			accountId: ACCOUNT,
			serverHalf: SERVER_HALF,
			wrapKey
		});
		const rec = db.records.get(ACCOUNT)!;
		expect(rec.localHalfKey).toBeUndefined();
		expect(rec.localHalfHolder).toBe('page');
		expect(rec.wrapPayloadVersion).toBe(2);
		expect(hasPersistentFor(rec)).toBe(true);
		expect(view.every((b) => b === 0)).toBe(true);
		expect(JSON.stringify(rec)).not.toContain(bytesToBase64(amk));
	});

	it('restores the master key from a page wrap key after the vault is locked', async () => {
		const ikm = crypto.getRandomValues(new Uint8Array(32));
		await handleEnrollPersistent({
			accountId: ACCOUNT,
			serverHalf: SERVER_HALF,
			wrapKey: await pageWrapKey(ikm)
		});
		vaults.clear();
		cachedRecords.clear();
		const wrapKey = await pageWrapKey(ikm);
		const view = new Uint8Array(wrapKey);
		const res = await handleTryRestoreFromPersistent({
			accountId: ACCOUNT,
			serverHalf: SERVER_HALF,
			wrapKey
		});
		expect(res).toEqual({ ok: true, accountId: ACCOUNT, email: EMAIL });
		expect(vaults.get(ACCOUNT)?.masterKey).toEqual(amk);
		expect(view.every((b) => b === 0)).toBe(true);
	});

	it('refuses to restore a page-held record without the page key', async () => {
		await handleEnrollPersistent({
			accountId: ACCOUNT,
			serverHalf: SERVER_HALF,
			wrapKey: await pageWrapKey(crypto.getRandomValues(new Uint8Array(32)))
		});
		vaults.clear();
		const res = await handleTryRestoreFromPersistent({
			accountId: ACCOUNT,
			serverHalf: SERVER_HALF
		});
		expect(res).toEqual({ ok: false, reason: 'no_persistent' });
		expect(vaults.has(ACCOUNT)).toBe(false);
	});

	it('fails the unwrap with a key from another device or server half', async () => {
		const ikm = crypto.getRandomValues(new Uint8Array(32));
		await handleEnrollPersistent({
			accountId: ACCOUNT,
			serverHalf: SERVER_HALF,
			wrapKey: await pageWrapKey(ikm)
		});
		vaults.clear();
		const otherHalf = bytesToBase64(crypto.getRandomValues(new Uint8Array(32)));
		for (const wrapKey of [
			await pageWrapKey(crypto.getRandomValues(new Uint8Array(32))),
			await pageWrapKey(ikm, otherHalf)
		]) {
			const res = await handleTryRestoreFromPersistent({
				accountId: ACCOUNT,
				serverHalf: SERVER_HALF,
				wrapKey
			});
			expect(res).toEqual({ ok: false, reason: 'unwrap_failed' });
		}
		expect(vaults.has(ACCOUNT)).toBe(false);
	});

	it('rejects a wrap key of the wrong length and zeroes it', async () => {
		const wrapKey = new Uint8Array(16).fill(7).buffer;
		await expect(
			handleEnrollPersistent({
				accountId: ACCOUNT,
				serverHalf: SERVER_HALF,
				wrapKey
			})
		).rejects.toThrow('wrong length');
		expect(new Uint8Array(wrapKey).every((b) => b === 0)).toBe(true);
		expect(db.records.has(ACCOUNT)).toBe(false);
	});

	it('zeroes an unused wrap key when the vault is locked', async () => {
		vaults.clear();
		const wrapKey = await pageWrapKey(crypto.getRandomValues(new Uint8Array(32)));
		await expect(
			handleEnrollPersistent({
				accountId: ACCOUNT,
				serverHalf: SERVER_HALF,
				wrapKey
			})
		).rejects.toThrow('vault is locked');
		expect(new Uint8Array(wrapKey).every((b) => b === 0)).toBe(true);
	});

	it('keeps the worker path when the key can be stored', async () => {
		await handleEnrollPersistent({
			accountId: ACCOUNT,
			serverHalf: SERVER_HALF
		});
		const rec = db.records.get(ACCOUNT)!;
		expect(rec.localHalfKey).toBeInstanceOf(CryptoKey);
		expect(rec.localHalfHolder).toBeUndefined();
		vaults.clear();
		const res = await handleTryRestoreFromPersistent({
			accountId: ACCOUNT,
			serverHalf: SERVER_HALF
		});
		expect(res.ok).toBe(true);
	});
});
