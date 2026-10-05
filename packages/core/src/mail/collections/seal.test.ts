import { beforeEach, describe, expect, it, vi } from 'vitest';

const keystore = vi.hoisted(() => ({
	getPublicKey: vi.fn(),
	encrypt: vi.fn(),
	decrypt: vi.fn()
}));

vi.mock('$core/keystore/keystore-client', () => ({ keystore }));

import { CollectionSealError, openCollectionMeta, sealCollectionMeta } from './seal';

describe('collection metadata sealing', () => {
	beforeEach(() => {
		keystore.getPublicKey.mockReset();
		keystore.encrypt.mockReset();
		keystore.decrypt.mockReset();
	});

	it('encrypts name and color to the account key and reports its fingerprint', async () => {
		keystore.getPublicKey.mockResolvedValue({
			ok: true,
			publicKeyArmored: 'PUB',
			fingerprint: new Uint8Array([1, 2, 3])
		});
		keystore.encrypt.mockResolvedValue({ ok: true, ciphertext: new Uint8Array([9, 9]) });

		const sealed = await sealCollectionMeta('acc', { name: 'Clients', color: 'pine' });

		const sent = keystore.encrypt.mock.calls[0][0];
		expect(sent.recipientPublicKeyArmored).toBe('PUB');
		expect(JSON.parse(new TextDecoder().decode(sent.plaintext))).toEqual({ n: 'Clients', c: 'pine' });
		expect(sealed).toEqual({ sealedMeta: 'CQk=', metaKeyFingerprint: 'AQID', metaSchemaVersion: 2 });
	});

	it('seals the favorite flag only when the collection is a favorite', async () => {
		keystore.getPublicKey.mockResolvedValue({
			ok: true,
			publicKeyArmored: 'PUB',
			fingerprint: new Uint8Array([1])
		});
		keystore.encrypt.mockResolvedValue({ ok: true, ciphertext: new Uint8Array([9]) });

		await sealCollectionMeta('acc', { name: 'Clients', color: null, favorite: true });
		await sealCollectionMeta('acc', { name: 'Home', color: null, favorite: false });

		const sent = keystore.encrypt.mock.calls.map((c) =>
			JSON.parse(new TextDecoder().decode(c[0].plaintext))
		);
		expect(sent).toEqual([
			{ n: 'Clients', c: null, f: true },
			{ n: 'Home', c: null }
		]);
	});

	it('refuses to seal while the account is locked', async () => {
		keystore.getPublicKey.mockResolvedValue({ ok: false, code: 'locked' });
		await expect(sealCollectionMeta('acc', { name: 'x', color: null })).rejects.toBeInstanceOf(
			CollectionSealError
		);
		expect(keystore.encrypt).not.toHaveBeenCalled();
	});

	it('opens sealed metadata and rejects blobs without a name', async () => {
		keystore.decrypt.mockResolvedValueOnce({ ok: true, plaintext: '{"n":"Tax / 2026","c":null}' });
		expect(await openCollectionMeta('acc', 'CQk=')).toEqual({
			name: 'Tax / 2026',
			color: null,
			favorite: false
		});

		keystore.decrypt.mockResolvedValueOnce({ ok: true, plaintext: '{"n":"Clients","c":"pine","f":true}' });
		expect(await openCollectionMeta('acc', 'CQk=')).toEqual({
			name: 'Clients',
			color: 'pine',
			favorite: true
		});

		keystore.decrypt.mockResolvedValueOnce({ ok: true, plaintext: '{"n":"Home","f":"yes"}' });
		expect((await openCollectionMeta('acc', 'CQk='))?.favorite).toBe(false);

		keystore.decrypt.mockResolvedValueOnce({ ok: true, plaintext: '{"n":"  "}' });
		expect(await openCollectionMeta('acc', 'CQk=')).toBeNull();

		keystore.decrypt.mockResolvedValueOnce({ ok: false, code: 'no_matching_key' });
		expect(await openCollectionMeta('acc', 'CQk=')).toBeNull();
	});
});
