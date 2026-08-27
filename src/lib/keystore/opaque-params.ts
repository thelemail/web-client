export const CLIENT_IDENTITY_PREFIX = 'thelemail/auth/opaque/v1:';
export const RECOVERY_CLIENT_IDENTITY_INFIX = 'recovery:';
export const SERVER_IDENTITY = 'thelemail.com';
export const KEY_STRETCHING = 'memory-constrained' as const;
export const OPAQUE_PARAMS_VERSION = 1;

export const WRAPPED_MASTER_KEY_LEN = 61;
export const MASTER_KEY_ID_LEN = 16;
export const AMK_LEN = 32;

export function clientIdentity(accountId: string, recovery: boolean): string {
	return recovery
		? CLIENT_IDENTITY_PREFIX + RECOVERY_CLIENT_IDENTITY_INFIX + accountId
		: CLIENT_IDENTITY_PREFIX + accountId;
}

export function bytesToBase64(bytes: Uint8Array): string {
	let binary = '';
	for (let i = 0; i < bytes.length; i++) binary += String.fromCharCode(bytes[i]);
	return btoa(binary);
}

export function base64ToBytes(b64: string): Uint8Array {
	const binary = atob(b64);
	const out = new Uint8Array(binary.length);
	for (let i = 0; i < binary.length; i++) out[i] = binary.charCodeAt(i);
	return out;
}

export function base64UrlToBase64(b64url: string): string {
	let b64 = b64url.replace(/-/g, '+').replace(/_/g, '/');
	while (b64.length % 4) b64 += '=';
	return b64;
}

export function base64ToBase64Url(b64: string): string {
	return b64.replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

export function base64UrlToBytes(b64url: string): Uint8Array {
	return base64ToBytes(base64UrlToBase64(b64url));
}

export function bytesToBase64Url(bytes: Uint8Array): string {
	return base64ToBase64Url(bytesToBase64(bytes));
}

const INFO_AMK_WRAP_PW = new TextEncoder().encode('thelemail/amk-wrap/v1');
const INFO_AMK_WRAP_RECOVERY = new TextEncoder().encode('thelemail/amk-wrap/recovery/v1');
const INFO_AMK_ID = new TextEncoder().encode('thelemail/amk-id/v1');
const INFO_PGP_PASSPHRASE = new TextEncoder().encode('thelemail/pgp-passphrase/v1');

async function hkdf(ikm: Uint8Array, info: Uint8Array, lengthBytes: number): Promise<Uint8Array> {
	const key = await crypto.subtle.importKey('raw', ikm as BufferSource, 'HKDF', false, ['deriveBits']);
	const bits = await crypto.subtle.deriveBits(
		{
			name: 'HKDF',
			hash: 'SHA-256',
			salt: new Uint8Array(0) as BufferSource,
			info: info as BufferSource
		},
		key,
		lengthBytes * 8
	);
	return new Uint8Array(bits);
}

export function generateAMK(): Uint8Array {
	return crypto.getRandomValues(new Uint8Array(AMK_LEN));
}

export async function wrapMasterKey(
	exportKey: Uint8Array,
	amk: Uint8Array,
	recovery: boolean
): Promise<Uint8Array> {
	const info = recovery ? INFO_AMK_WRAP_RECOVERY : INFO_AMK_WRAP_PW;
	const wrapKeyBytes = await hkdf(exportKey, info, 32);
	const wrapKey = await crypto.subtle.importKey('raw', wrapKeyBytes as BufferSource, 'AES-GCM', false, [
		'encrypt'
	]);
	const nonce = crypto.getRandomValues(new Uint8Array(12));
	const ciphertext = new Uint8Array(
		await crypto.subtle.encrypt(
			{ name: 'AES-GCM', iv: nonce as BufferSource, additionalData: info as BufferSource },
			wrapKey,
			amk as BufferSource
		)
	);
	const out = new Uint8Array(1 + nonce.length + ciphertext.length);
	out[0] = 0x01;
	out.set(nonce, 1);
	out.set(ciphertext, 1 + nonce.length);
	return out;
}

export async function unwrapMasterKey(
	exportKey: Uint8Array,
	wrapped: Uint8Array,
	recovery: boolean
): Promise<Uint8Array> {
	if (wrapped.length !== WRAPPED_MASTER_KEY_LEN || wrapped[0] !== 0x01) {
		throw new Error('opaque: invalid wrapped master key');
	}
	const info = recovery ? INFO_AMK_WRAP_RECOVERY : INFO_AMK_WRAP_PW;
	const nonce = wrapped.slice(1, 13);
	const ciphertext = wrapped.slice(13);
	const wrapKeyBytes = await hkdf(exportKey, info, 32);
	const wrapKey = await crypto.subtle.importKey('raw', wrapKeyBytes as BufferSource, 'AES-GCM', false, [
		'decrypt'
	]);
	const plaintext = await crypto.subtle.decrypt(
		{ name: 'AES-GCM', iv: nonce as BufferSource, additionalData: info as BufferSource },
		wrapKey,
		ciphertext as BufferSource
	);
	return new Uint8Array(plaintext);
}

export async function deriveMasterKeyId(amk: Uint8Array): Promise<Uint8Array> {
	return hkdf(amk, INFO_AMK_ID, MASTER_KEY_ID_LEN);
}

export async function derivePgpPassphrase(amk: Uint8Array): Promise<string> {
	const bytes = await hkdf(amk, INFO_PGP_PASSPHRASE, 32);
	return bytesToBase64(bytes);
}
