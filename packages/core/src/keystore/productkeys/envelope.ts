import { concat, sha256 } from './encoding';
import { fail } from './errors';
import { utf8 } from './canonical';

export const KDF = 'hkdf-sha256';
export const AEAD = 'aes-256-gcm';
export const SALT_LEN = 32;
export const NONCE_LEN = 12;
export const SECRET_LEN = 32;

export async function deriveSecret(ikm: Uint8Array, salt: Uint8Array, info: string, aad: Uint8Array): Promise<Uint8Array> {
	const label = concat(utf8(info), new Uint8Array([0]), await sha256(aad));
	const base = await crypto.subtle.importKey('raw', ikm as BufferSource, 'HKDF', false, ['deriveBits']);
	return new Uint8Array(
		await crypto.subtle.deriveBits({ name: 'HKDF', hash: 'SHA-256', salt: salt as BufferSource, info: label as BufferSource }, base, 256)
	);
}

async function deriveKey(ikm: Uint8Array, salt: Uint8Array, info: string, aad: Uint8Array): Promise<CryptoKey> {
	const bits = await deriveSecret(ikm, salt, info, aad);
	try {
		return await crypto.subtle.importKey('raw', bits as BufferSource, 'AES-GCM', false, ['encrypt', 'decrypt']);
	} finally {
		bits.fill(0);
	}
}

export async function seal(
	ikm: Uint8Array,
	info: string,
	aad: Uint8Array,
	salt: Uint8Array,
	nonce: Uint8Array,
	plaintext: Uint8Array
): Promise<Uint8Array> {
	const key = await deriveKey(ikm, salt, info, aad);
	return new Uint8Array(
		await crypto.subtle.encrypt(
			{ name: 'AES-GCM', iv: nonce as BufferSource, additionalData: aad as BufferSource, tagLength: 128 },
			key,
			plaintext as BufferSource
		)
	);
}

export async function open(
	ikm: Uint8Array,
	info: string,
	aad: Uint8Array,
	salt: Uint8Array,
	nonce: Uint8Array,
	ciphertext: Uint8Array
): Promise<Uint8Array> {
	const key = await deriveKey(ikm, salt, info, aad);
	try {
		return new Uint8Array(
			await crypto.subtle.decrypt(
				{ name: 'AES-GCM', iv: nonce as BufferSource, additionalData: aad as BufferSource, tagLength: 128 },
				key,
				ciphertext as BufferSource
			)
		);
	} catch {
		fail('decrypt');
	}
}

export function randomBytes(n: number): Uint8Array {
	return crypto.getRandomValues(new Uint8Array(n));
}

export function checkCipher(kdf: string, aead: string, salt: Uint8Array, nonce: Uint8Array, ciphertext: Uint8Array): void {
	if (kdf !== KDF || aead !== AEAD) fail('malformed', 'algorithm');
	if (salt.length !== SALT_LEN || nonce.length !== NONCE_LEN || ciphertext.length < 16) {
		fail('malformed', 'salt, nonce or ciphertext length');
	}
}

export async function transcriptHash(domain: string, raw: Uint8Array): Promise<Uint8Array> {
	return sha256(transcript(domain, raw));
}

export function transcript(domain: string, raw: Uint8Array): Uint8Array {
	return concat(utf8(domain), new Uint8Array([0]), raw);
}
