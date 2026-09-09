import { describe, it, expect, vi, beforeEach } from 'vitest';

vi.mock('openpgp', () => ({}));
vi.mock('hash-wasm', () => ({ argon2id: vi.fn() }));

vi.mock('$lib/api/blockedSenders', () => ({
	addBlockedSender: vi.fn()
}));

vi.mock('$lib/keystore/keystore-client', () => ({
	keystore: {
		getPublicKey: vi.fn(),
		encrypt: vi.fn(),
		decrypt: vi.fn()
	}
}));

import { addBlockedSender } from '$lib/api/blockedSenders';
import { keystore } from '$lib/keystore/keystore-client';
import { blockSender, normalizeAddress, sealAddress, unsealAddress } from './blockedSenders';

const add = vi.mocked(addBlockedSender);
const getPublicKey = vi.mocked(keystore.getPublicKey);
const encrypt = vi.mocked(keystore.encrypt);
const decrypt = vi.mocked(keystore.decrypt);

beforeEach(() => {
	vi.resetAllMocks();
	getPublicKey.mockResolvedValue({
		ok: true,
		publicKeyArmored: 'PUB',
		fingerprint: new Uint8Array([1, 2, 3])
	});
	encrypt.mockResolvedValue({ ok: true, ciphertext: new Uint8Array([9, 8, 7]) });
	add.mockResolvedValue({ id: 'b1', createdAt: '2026-08-07T10:00:00Z', sealedLabel: 'CQgH' });
});

describe('normalizeAddress', () => {
	it('trims and lowercases', () => {
		expect(normalizeAddress('  Spoof@Evil.Example ')).toBe('spoof@evil.example');
	});
});

describe('sealAddress', () => {
	it('encrypts the normalized address to the account key', async () => {
		const sealed = await sealAddress('acc', ' Spoof@Evil.Example ');
		expect(encrypt).toHaveBeenCalledWith({
			accountId: 'acc',
			recipientPublicKeyArmored: 'PUB',
			plaintext: new TextEncoder().encode('spoof@evil.example')
		});
		expect(sealed).toBe('CQgH');
	});

	it('throws when the vault is locked', async () => {
		getPublicKey.mockResolvedValue({ ok: false, code: 'locked' });
		await expect(sealAddress('acc', 'a@b.example')).rejects.toThrow('Unlock this account');
		expect(encrypt).not.toHaveBeenCalled();
	});
});

describe('unsealAddress', () => {
	it('decrypts a sealed label', async () => {
		decrypt.mockResolvedValue({ ok: true, plaintext: 'spoof@evil.example\n' });
		expect(await unsealAddress('acc', 'CQgH')).toBe('spoof@evil.example');
	});

	it('returns null for a missing or undecryptable label', async () => {
		expect(await unsealAddress('acc', null)).toBeNull();
		decrypt.mockResolvedValue({ ok: false, code: 'locked' });
		expect(await unsealAddress('acc', 'CQgH')).toBeNull();
	});
});

describe('blockSender', () => {
	it('posts the normalized address alongside the sealed label', async () => {
		await blockSender('acc', 'Spoof@Evil.Example');
		expect(add).toHaveBeenCalledWith({ address: 'spoof@evil.example', sealedLabel: 'CQgH' });
	});

	it('does not block when the label cannot be sealed', async () => {
		encrypt.mockResolvedValue({ ok: false, code: 'unknown' });
		await expect(blockSender('acc', 'spoof@evil.example')).rejects.toThrow('could not be encrypted');
		expect(add).not.toHaveBeenCalled();
	});
});
