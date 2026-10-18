import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { Broadcast } from '$core/keystore/protocol';

const me = vi.hoisted(() => ({ listMyKeys: vi.fn() }));
const dir = vi.hoisted(() => ({ lookup: vi.fn(), verify: vi.fn() }));
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
vi.mock('$core/directory/lookup', () => ({ lookupDirectory: (...a: unknown[]) => dir.lookup(...a) }));
vi.mock('$core/directory/verify', () => ({
	verifyDirectoryLookup: (...a: unknown[]) => dir.verify(...a)
}));
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
import { DirectoryVerificationError } from '$core/directory/errors';

const ACCOUNT = 'acc-1';
const CURRENT = 'aa'.repeat(32);
const EARLIER = 'bb'.repeat(32);
const OTHER = 'cc'.repeat(32);
const SIGNATURE = Uint8Array.from([0xc2, 0x02, 0x01, 0x02]);
const ADDRESS = 'nora@thelemail.test';

function hexBytes(hex: string): Uint8Array {
	return Uint8Array.from(hex.match(/../g)!.map((b) => parseInt(b, 16)));
}

function serverKeys() {
	return {
		currentVersion: 2,
		keys: [
			{
				keyVersion: 2,
				keyFingerprint: CURRENT.toUpperCase(),
				encryptedPrivateKey: 'armored-2',
				isCurrent: true,
				transitions: [{ previousKeyFingerprint: EARLIER.toUpperCase(), signature: 'wgIBAg==' }]
			},
			{ keyVersion: 1, keyFingerprint: EARLIER, encryptedPrivateKey: 'armored-1', isCurrent: false, transitions: [] }
		]
	};
}

function statement(keyFingerprint = CURRENT, accountId = ACCOUNT, tlog: unknown = { state: 'verified' }) {
	return { statement: { accountId, keyFingerprint, address: ADDRESS }, tlog };
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
			accounts: [{ accountId: ACCOUNT, email: 'Nora@thelemail.test', unlocked: true, authScheme: 'opaque_v1' }]
		});
		ks.loadAccountKeys.mockResolvedValue({ ok: true, loaded: [CURRENT, EARLIER], failed: [], unverified: [] });
		dir.lookup.mockResolvedValue({ publicKeyArmored: 'public-2' });
		dir.verify.mockResolvedValue(statement());
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
		emit({ type: 'clearedAll' });
	});

	it('hands every server key to the vault and exposes the current one', async () => {
		await accountKeys.load(ACCOUNT);
		expect(ks.loadAccountKeys).toHaveBeenCalledWith({
			accountId: ACCOUNT,
			currentVersion: 2,
			keys: [
				{
					keyVersion: 2,
					fingerprintHex: CURRENT,
					encryptedPrivateKeyArmored: 'armored-2',
					isCurrent: true,
					transitions: [{ previousKeyFingerprintHex: EARLIER, signature: SIGNATURE }]
				},
				{
					keyVersion: 1,
					fingerprintHex: EARLIER,
					encryptedPrivateKeyArmored: 'armored-1',
					isCurrent: false,
					transitions: []
				}
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
		ks.loadAccountKeys.mockResolvedValue({ ok: true, loaded: [CURRENT], failed: [1], unverified: [] });
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

	it('checks its own directory statement without pinning it', async () => {
		await accountKeys.load(ACCOUNT);
		expect(dir.lookup).toHaveBeenCalledWith(ADDRESS);
		expect(dir.verify).toHaveBeenCalledWith({ publicKeyArmored: 'public-2' }, ADDRESS, { pin: false });
		expect(accountKeys.verification).toBe('verified');
		expect(accountKeys.isUnverified(ACCOUNT)).toBe(false);
	});

	it('looks up the primary address the profile reported', async () => {
		accountKeys.noteServerKey(ACCOUNT, CURRENT, 2, 'Primary@thelemail.test');
		await accountKeys.load(ACCOUNT);
		expect(dir.lookup).toHaveBeenCalledWith('primary@thelemail.test');
	});

	it('marks the account unverified when the directory names another key after a reload', async () => {
		dir.verify.mockResolvedValue(statement(OTHER));
		await accountKeys.load(ACCOUNT);
		expect(me.listMyKeys).toHaveBeenCalledTimes(2);
		expect(accountKeys.verification).toBe('unverified');
		expect(accountKeys.isUnverified(ACCOUNT)).toBe(true);
	});

	it('clears a mismatch the reload resolves', async () => {
		dir.verify.mockResolvedValueOnce(statement(OTHER)).mockResolvedValue(statement());
		await accountKeys.load(ACCOUNT);
		expect(me.listMyKeys).toHaveBeenCalledTimes(2);
		expect(accountKeys.verification).toBe('verified');
	});

	it('marks the account unverified when the statement belongs to another account', async () => {
		dir.verify.mockResolvedValue(statement(CURRENT, 'acc-other'));
		await accountKeys.load(ACCOUNT);
		expect(accountKeys.isUnverified(ACCOUNT)).toBe(true);
	});

	it('marks the account unverified when the statement fails verification', async () => {
		dir.verify.mockRejectedValue(new DirectoryVerificationError('signature_invalid', 'bad'));
		await accountKeys.load(ACCOUNT);
		expect(accountKeys.verification).toBe('unverified');
	});

	it('checks the directory even when the vault refuses the key list', async () => {
		ks.loadAccountKeys.mockResolvedValue({ ok: false, code: 'key_list_invalid' });
		dir.verify.mockResolvedValue(statement(OTHER));
		await accountKeys.load(ACCOUNT);
		expect(accountKeys.error).toBe('history_incomplete');
		expect(accountKeys.isUnverified(ACCOUNT)).toBe(true);
	});

	it('retries a statement whose proof is not logged yet without blocking', async () => {
		vi.useFakeTimers();
		try {
			dir.verify.mockResolvedValueOnce(statement(CURRENT, ACCOUNT, { state: 'failed', code: 'tlog_proof_missing' }));
			await accountKeys.load(ACCOUNT);
			expect(accountKeys.verification).toBe('pending');
			expect(accountKeys.isUnverified(ACCOUNT)).toBe(false);
			await vi.advanceTimersByTimeAsync(30_000);
			expect(dir.verify).toHaveBeenCalledTimes(2);
			expect(accountKeys.verification).toBe('verified');
		} finally {
			vi.useRealTimers();
		}
	});

	it('retries after a network failure without blocking', async () => {
		dir.lookup.mockRejectedValue(new ApiCallError(503, null, 'down'));
		await accountKeys.load(ACCOUNT);
		expect(accountKeys.verification).toBe('pending');
		expect(accountKeys.isUnverified(ACCOUNT)).toBe(false);
	});

	it('forgets the result when the vault locks', async () => {
		dir.verify.mockResolvedValue(statement(OTHER));
		await accountKeys.load(ACCOUNT);
		expect(accountKeys.isUnverified(ACCOUNT)).toBe(true);
		emit({ type: 'locked', accountId: ACCOUNT });
		expect(accountKeys.isUnverified(ACCOUNT)).toBe(false);
		expect(accountKeys.verification).toBe('unknown');
	});
});
