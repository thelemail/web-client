import { beforeEach, describe, expect, it, vi } from 'vitest';

const apiBlobFetch = vi.fn();
const decrypt = vi.fn();

vi.mock('$core/api/client', () => ({ apiBlobFetch: (...a: unknown[]) => apiBlobFetch(...a) }));
vi.mock('$core/keystore/keystore-client', () => ({ keystore: { decrypt: (...a: unknown[]) => decrypt(...a) } }));
vi.mock('$core/stores/aliasKeys.svelte', () => ({
	aliasKeys: { ready: async () => {}, refresh: async () => {} }
}));

import { ApiCallError, type PresignedPointer } from '$core/api/types';
import { DecryptionError, decryptBody } from './decrypt';

const pointer: PresignedPointer = {
	url: 'https://fsn1.your-objectstorage.com/thelemail/m/a/b/body.pgp?X-Amz-Signature=s',
	path: '/v1/messages/m1/body',
	expiresAt: '2026-10-16T12:00:00Z',
	sizeBytes: 3
};

beforeEach(() => {
	apiBlobFetch.mockReset();
	decrypt.mockReset();
});

describe('decryptBody', () => {
	it('reads the body through the api for the owning account, never the object store', async () => {
		apiBlobFetch.mockResolvedValue(new Response(new Uint8Array([1, 2, 3])));
		decrypt.mockResolvedValue({ ok: true, plaintext: 'hello' });

		const out = await decryptBody('acct-1', pointer);

		expect(out.plaintext).toBe('hello');
		expect(apiBlobFetch).toHaveBeenCalledWith('/v1/messages/m1/body', { accountId: 'acct-1' });
		expect(decrypt.mock.calls[0][0]).toMatchObject({
			accountId: 'acct-1',
			ciphertextBinary: new Uint8Array([1, 2, 3])
		});
	});

	it('reports a refused fetch as a decryption failure with its status', async () => {
		apiBlobFetch.mockRejectedValue(new ApiCallError(404, null, 'not found'));

		const err = await decryptBody('acct-1', pointer).catch((e) => e);

		expect(err).toBeInstanceOf(DecryptionError);
		expect((err as DecryptionError).message).toBe('fetch body 404');
		expect(decrypt).not.toHaveBeenCalled();
	});
});
