import { describe, expect, it } from 'vitest';

import {
	AMK_LEN,
	CLIENT_IDENTITY_PREFIX,
	KEY_STRETCHING,
	MASTER_KEY_ID_LEN,
	OPAQUE_PARAMS_VERSION,
	RECOVERY_CLIENT_IDENTITY_INFIX,
	SERVER_IDENTITY,
	WRAPPED_MASTER_KEY_LEN,
	base64ToBase64Url,
	base64ToBytes,
	base64UrlToBase64,
	base64UrlToBytes,
	bytesToBase64,
	bytesToBase64Url,
	clientIdentity,
	derivePgpPassphrase,
	deriveMasterKeyId,
	generateAMK,
	unwrapMasterKey,
	wrapMasterKey
} from './opaque-params';

describe('pinned literal constants', () => {
	it('match the server-side wire contract exactly', () => {
		expect(CLIENT_IDENTITY_PREFIX).toBe('thelemail/auth/opaque/v1:');
		expect(RECOVERY_CLIENT_IDENTITY_INFIX).toBe('recovery:');
		expect(SERVER_IDENTITY).toBe('thelemail.com');
		expect(KEY_STRETCHING).toBe('memory-constrained');
		expect(OPAQUE_PARAMS_VERSION).toBe(1);
		expect(WRAPPED_MASTER_KEY_LEN).toBe(61);
		expect(MASTER_KEY_ID_LEN).toBe(16);
		expect(AMK_LEN).toBe(32);
	});
});

describe('clientIdentity', () => {
	const accountId = '11111111-2222-3333-4444-555555555555';

	it('builds the login identity', () => {
		expect(clientIdentity(accountId, false)).toBe(`thelemail/auth/opaque/v1:${accountId}`);
	});

	it('builds the recovery identity', () => {
		expect(clientIdentity(accountId, true)).toBe(`thelemail/auth/opaque/v1:recovery:${accountId}`);
	});
});

describe('base64 encoding helpers', () => {
	it('round-trips standard base64', () => {
		const bytes = crypto.getRandomValues(new Uint8Array(37));
		expect(base64ToBytes(bytesToBase64(bytes))).toEqual(bytes);
	});

	it('round-trips base64url', () => {
		const bytes = crypto.getRandomValues(new Uint8Array(37));
		const url = bytesToBase64Url(bytes);
		expect(url).not.toMatch(/[+/=]/);
		expect(base64UrlToBytes(url)).toEqual(bytes);
	});

	it('converts standard base64 with padding to base64url without padding', () => {
		expect(base64ToBase64Url('+/8=')).toBe('-_8');
		expect(base64UrlToBase64('-_8')).toBe('+/8=');
	});
});

describe('master key wrap / unwrap', () => {
	it('round-trips for the password wrap context', async () => {
		const exportKey = crypto.getRandomValues(new Uint8Array(64));
		const amk = generateAMK();
		const wrapped = await wrapMasterKey(exportKey, amk, false);
		expect(wrapped.length).toBe(WRAPPED_MASTER_KEY_LEN);
		expect(wrapped[0]).toBe(0x01);
		const unwrapped = await unwrapMasterKey(exportKey, wrapped, false);
		expect(unwrapped).toEqual(amk);
	});

	it('round-trips for the recovery wrap context, and is not interchangeable with the password context', async () => {
		const exportKey = crypto.getRandomValues(new Uint8Array(64));
		const amk = generateAMK();
		const wrapped = await wrapMasterKey(exportKey, amk, true);
		const unwrapped = await unwrapMasterKey(exportKey, wrapped, true);
		expect(unwrapped).toEqual(amk);
		await expect(unwrapMasterKey(exportKey, wrapped, false)).rejects.toThrow();
	});

	it('rejects a tampered ciphertext', async () => {
		const exportKey = crypto.getRandomValues(new Uint8Array(64));
		const amk = generateAMK();
		const wrapped = await wrapMasterKey(exportKey, amk, false);
		wrapped[wrapped.length - 1] ^= 0xff;
		await expect(unwrapMasterKey(exportKey, wrapped, false)).rejects.toThrow();
	});

	it('rejects the wrong length or version byte', async () => {
		const exportKey = crypto.getRandomValues(new Uint8Array(64));
		await expect(unwrapMasterKey(exportKey, new Uint8Array(60), false)).rejects.toThrow();
		const badVersion = new Uint8Array(WRAPPED_MASTER_KEY_LEN);
		badVersion[0] = 0x02;
		await expect(unwrapMasterKey(exportKey, badVersion, false)).rejects.toThrow();
	});

	it('derives a stable, distinct master key id and pgp passphrase from the same amk', async () => {
		const amk = generateAMK();
		const id1 = await deriveMasterKeyId(amk);
		const id2 = await deriveMasterKeyId(amk);
		expect(id1).toEqual(id2);
		expect(id1.length).toBe(MASTER_KEY_ID_LEN);

		const passphrase1 = await derivePgpPassphrase(amk);
		const passphrase2 = await derivePgpPassphrase(amk);
		expect(passphrase1).toBe(passphrase2);
		expect(base64ToBytes(passphrase1).length).toBe(32);

		const otherAmk = generateAMK();
		const otherId = await deriveMasterKeyId(otherAmk);
		expect(otherId).not.toEqual(id1);
	});
});
