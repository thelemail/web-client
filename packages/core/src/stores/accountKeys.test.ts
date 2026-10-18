import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { Broadcast } from '$core/keystore/protocol';

const me = vi.hoisted(() => ({ listMyKeys: vi.fn() }));
const ks = vi.hoisted(() => ({
	listeners: [] as ((b: unknown) => void)[],
	status: vi.fn(),
	loadAccountKeys: vi.fn(),
	getPublicKey: vi.fn(),
	listAccountKeys: vi.fn()
}));

vi.mock('$app/environment', () => ({ browser: true }));
vi.mock('$core/products', () => ({ isProductVault: false }));
vi.mock('$core/api/me', () => me);
vi.mock('$core/keystore/keystore-client', () => ({
	keystore: {
		subscribe: (fn: (b: unknown) => void) => {
			ks.listeners.push(fn);
			return () => undefined;
		},
		status: (...a: unknown[]) => ks.status(...a),
		loadAccountKeys: (...a: unknown[]) => ks.loadAccountKeys(...a),
		getPublicKey: (...a: unknown[]) => ks.getPublicKey(...a),
		listAccountKeys: (...a: unknown[]) => ks.listAccountKeys(...a)
	}
}));

import { accountKeys } from './accountKeys.svelte';
import { ApiCallError } from '$core/api/types';

const ACCOUNT = 'acc-1';
const CURRENT = 'aa'.repeat(32);
const EARLIER = 'bb'.repeat(32);

function hexBytes(hex: string): Uint8Array {
	return Uint8Array.from(hex.match(/../g)!.map((b) => parseInt(b, 16)));
}

function serverKeys() {
	return {
		currentVersion: 2,
		keys: [
			{ keyVersion: 2, keyFingerprint: CURRENT.toUpperCase(), encryptedPrivateKey: 'armored-2', isCurrent: true },
			{ keyVersion: 1, keyFingerprint: EARLIER, encryptedPrivateKey: 'armored-1', isCurrent: false }
		]
	};
}

function emit(b: Broadcast) {
	for (const fn of ks.listeners) fn(b);
}

async function settle() {
	for (let i = 0; i < 10; i++) await Promise.resolve();
	await new Promise((r) => setTimeout(r, 0));
}

describe('account keys store', () => {
	beforeEach(() => {
		vi.clearAllMocks();
		ks.status.mockResolvedValue({
			accounts: [{ accountId: ACCOUNT, unlocked: true, authScheme: 'opaque_v1' }]
		});
		ks.loadAccountKeys.mockResolvedValue({ ok: true, loaded: [CURRENT, EARLIER], failed: [] });
		ks.getPublicKey.mockResolvedValue({
			ok: true,
			fingerprint: hexBytes(CURRENT),
			keyVersion: 2,
			publicKeyArmored: 'public-2'
		});
		ks.listAccountKeys.mockResolvedValue({
			ok: true,
			keyVersion: 2,
			keys: [
				{ fingerprintHex: CURRENT, keyVersion: 2, isCurrent: true },
				{ fingerprintHex: EARLIER, keyVersion: 1, isCurrent: false }
			]
		});
		me.listMyKeys.mockResolvedValue(serverKeys());
		accountKeys.setAccount(null);
		accountKeys.setAccount(ACCOUNT);
	});

	it('hands every server key to the vault and exposes the current one', async () => {
		await accountKeys.load(ACCOUNT);
		expect(ks.loadAccountKeys).toHaveBeenCalledWith({
			accountId: ACCOUNT,
			keys: [
				{ keyVersion: 2, fingerprintHex: CURRENT, encryptedPrivateKeyArmored: 'armored-2', isCurrent: true },
				{ keyVersion: 1, fingerprintHex: EARLIER, encryptedPrivateKeyArmored: 'armored-1', isCurrent: false }
			]
		});
		expect(accountKeys.current).toEqual({ fingerprintHex: CURRENT, keyVersion: 2, publicKeyArmored: 'public-2' });
		expect(accountKeys.history.map((k) => k.fingerprintHex)).toEqual([EARLIER]);
		expect(accountKeys.error).toBeNull();
	});

	it('reloads from the server when the vault changes', async () => {
		emit({ type: 'vaultChanged', accountId: ACCOUNT, email: 'nora@thelemail.test' });
		await settle();
		expect(me.listMyKeys).toHaveBeenCalledWith(ACCOUNT);
		expect(ks.loadAccountKeys).toHaveBeenCalledTimes(1);
	});

	it('refreshes from the vault alone when another tab changed the keys', async () => {
		emit({
			type: 'accountKeysChanged',
			accountId: ACCOUNT,
			fingerprints: [CURRENT, EARLIER],
			currentFingerprintHex: CURRENT,
			keyVersion: 2,
			currentChanged: true
		});
		await settle();
		expect(me.listMyKeys).not.toHaveBeenCalled();
		expect(accountKeys.current?.fingerprintHex).toBe(CURRENT);
	});

	it('flags keys the vault could not unlock', async () => {
		ks.loadAccountKeys.mockResolvedValue({ ok: true, loaded: [CURRENT], failed: [1] });
		await accountKeys.load(ACCOUNT);
		expect(accountKeys.error).toBe('history_incomplete');
	});

	it('flags a failed key fetch', async () => {
		me.listMyKeys.mockRejectedValue(new ApiCallError(500, null, 'boom'));
		await accountKeys.load(ACCOUNT);
		expect(accountKeys.error).toBe('account_keys_unavailable');
		expect(accountKeys.current?.fingerprintHex).toBe(CURRENT);
	});

	it('treats a server without key history as having none', async () => {
		me.listMyKeys.mockRejectedValue(new ApiCallError(404, null, 'not found'));
		await accountKeys.load(ACCOUNT);
		expect(ks.loadAccountKeys).not.toHaveBeenCalled();
		expect(accountKeys.error).toBeNull();
		expect(accountKeys.current?.fingerprintHex).toBe(CURRENT);
	});

	it('leaves a matching server key alone', async () => {
		await accountKeys.load(ACCOUNT);
		vi.clearAllMocks();
		accountKeys.noteServerKey(ACCOUNT, CURRENT.toUpperCase(), 2);
		await settle();
		expect(ks.getPublicKey).not.toHaveBeenCalled();
		expect(me.listMyKeys).not.toHaveBeenCalled();
	});

	it('reloads when the profile reports a different key', async () => {
		await accountKeys.load(ACCOUNT);
		me.listMyKeys.mockClear();
		accountKeys.noteServerKey(ACCOUNT, 'cc'.repeat(32), 3);
		await settle();
		expect(me.listMyKeys).toHaveBeenCalledWith(ACCOUNT);
	});

	it('reloads when the profile reports a new version of the same key', async () => {
		await accountKeys.load(ACCOUNT);
		me.listMyKeys.mockClear();
		accountKeys.noteServerKey(ACCOUNT, CURRENT, 3);
		await settle();
		expect(me.listMyKeys).toHaveBeenCalledWith(ACCOUNT);
	});

	it('checks the vault before reloading for a background account', async () => {
		ks.getPublicKey.mockResolvedValue({
			ok: true,
			fingerprint: hexBytes(EARLIER),
			keyVersion: 1,
			publicKeyArmored: 'public-1'
		});
		accountKeys.noteServerKey('acc-2', EARLIER, 1);
		await settle();
		expect(ks.getPublicKey).toHaveBeenCalledWith({ accountId: 'acc-2' });
		expect(me.listMyKeys).not.toHaveBeenCalled();
	});
});
