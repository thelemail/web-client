// @vitest-environment node
import { describe, expect, it } from 'vitest';
import vectors from '../interop/vectors/opaque.json';
import {
	MASTER_KEY_ID_LEN,
	OPAQUE_PARAMS_VERSION,
	SERVER_IDENTITY,
	WRAPPED_MASTER_KEY_LEN,
	base64ToBytes,
	bytesToBase64,
	clientIdentity,
	deriveMasterKeyId,
	derivePgpPassphrase,
	unwrapMasterKey,
	wrapMasterKey
} from './opaque-params';

describe('OPAQUE key schedule agrees with trust', () => {
	it('pins the same parameter set', () => {
		expect(vectors.params.opaqueParamsVersion).toBe(OPAQUE_PARAMS_VERSION);
		expect(vectors.params.serverIdentity).toBe(SERVER_IDENTITY);
		expect(vectors.params.ksf).toMatchObject({ name: 'argon2id', timeCost: 3, memoryKib: 65536, threads: 4, outputLength: 64 });
		expect(base64ToBytes(vectors.params.ksf.salt)).toEqual(new Uint8Array(16));
	});

	for (const c of vectors.cases) {
		describe(c.name, () => {
			const exportKey = base64ToBytes(c.exportKey);

			it('builds the same client identity', () => {
				expect(clientIdentity(c.accountId, c.recovery)).toBe(c.clientIdentity);
				expect(c.serverIdentity).toBe(SERVER_IDENTITY);
			});

			it('unwraps the master key trust wrapped', async () => {
				const amk = await unwrapMasterKey(exportKey, base64ToBytes(c.wrappedMasterKey), c.recovery);
				expect(bytesToBase64(amk)).toBe(c.masterKey);
			});

			it('refuses the wrap under the other credential', async () => {
				await expect(unwrapMasterKey(exportKey, base64ToBytes(c.wrappedMasterKey), !c.recovery)).rejects.toThrow();
			});

			it('derives the same master key id and passphrase', async () => {
				const amk = base64ToBytes(c.masterKey);
				const id = await deriveMasterKeyId(amk);
				expect(id.length).toBe(MASTER_KEY_ID_LEN);
				expect(bytesToBase64(id)).toBe(c.masterKeyId);
				expect(await derivePgpPassphrase(amk)).toBe(c.pgpPassphrase);
			});

			it('wraps in a layout trust can open', async () => {
				const wrapped = await wrapMasterKey(exportKey, base64ToBytes(c.masterKey), c.recovery);
				expect(wrapped.length).toBe(WRAPPED_MASTER_KEY_LEN);
				expect(wrapped[0]).toBe(base64ToBytes(c.wrappedMasterKey)[0]);
				const back = await unwrapMasterKey(exportKey, wrapped, c.recovery);
				expect(bytesToBase64(back)).toBe(c.masterKey);
			});
		});
	}
});
