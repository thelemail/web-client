import * as openpgp from 'openpgp';
import { argon2id } from 'hash-wasm';

export type ArmoredKeypair = {
	publicKey: string;
	privateKey: string;
};

export type WrappedVault = {
	wrappedBlob: string;
	saltHex: string;
};

const ARGON2_ITERATIONS = 3;
const ARGON2_MEMORY_KB = 64 * 1024;
const ARGON2_PARALLELISM = 1;
const ARGON2_HASH_LENGTH = 32;
const AES_IV_BYTES = 12;
const SALT_BYTES = 16;

export async function generateKeypair(name: string, email: string): Promise<ArmoredKeypair> {
	const { privateKey, publicKey } = await openpgp.generateKey({
		type: 'curve25519',
		userIDs: [{ name, email }],
		format: 'armored'
	});
	return { publicKey, privateKey };
}

export function randomSalt(): Uint8Array {
	return crypto.getRandomValues(new Uint8Array(SALT_BYTES));
}

export async function deriveKek(password: string, salt: Uint8Array): Promise<Uint8Array> {
	const hash = await argon2id({
		password,
		salt,
		parallelism: ARGON2_PARALLELISM,
		iterations: ARGON2_ITERATIONS,
		memorySize: ARGON2_MEMORY_KB,
		hashLength: ARGON2_HASH_LENGTH,
		outputType: 'binary'
	});
	return hash;
}

async function importAesKey(rawKey: Uint8Array): Promise<CryptoKey> {
	return crypto.subtle.importKey('raw', rawKey as BufferSource, { name: 'AES-GCM' }, false, [
		'encrypt',
		'decrypt'
	]);
}

export async function wrapPrivateKey(
	armoredPrivateKey: string,
	kek: Uint8Array
): Promise<string> {
	const key = await importAesKey(kek);
	const iv = crypto.getRandomValues(new Uint8Array(AES_IV_BYTES));
	const plaintext = new TextEncoder().encode(armoredPrivateKey);
	const ciphertext = new Uint8Array(
		await crypto.subtle.encrypt({ name: 'AES-GCM', iv }, key, plaintext)
	);
	const combined = new Uint8Array(iv.length + ciphertext.length);
	combined.set(iv, 0);
	combined.set(ciphertext, iv.length);
	return bytesToB64(combined);
}

export async function unwrapPrivateKey(wrappedBlobB64: string, kek: Uint8Array): Promise<string> {
	const combined = b64ToBytes(wrappedBlobB64);
	const iv = combined.slice(0, AES_IV_BYTES);
	const ciphertext = combined.slice(AES_IV_BYTES);
	const key = await importAesKey(kek);
	const plaintext = await crypto.subtle.decrypt({ name: 'AES-GCM', iv }, key, ciphertext);
	return new TextDecoder().decode(plaintext);
}

export async function encryptMessage(
	plaintext: string,
	armoredPublicKey: string
): Promise<string> {
	const publicKey = await openpgp.readKey({ armoredKey: armoredPublicKey });
	const message = await openpgp.createMessage({ text: plaintext });
	const encrypted = await openpgp.encrypt({
		message,
		encryptionKeys: publicKey,
		format: 'armored'
	});
	return encrypted as string;
}

export async function decryptMessage(
	armoredCiphertext: string,
	armoredPrivateKey: string
): Promise<string> {
	const privateKey = await openpgp.readPrivateKey({ armoredKey: armoredPrivateKey });
	const message = await openpgp.readMessage({ armoredMessage: armoredCiphertext });
	const { data } = await openpgp.decrypt({
		message,
		decryptionKeys: privateKey
	});
	return data as string;
}

export function bytesToHex(bytes: Uint8Array): string {
	return Array.from(bytes, (b) => b.toString(16).padStart(2, '0')).join('');
}

export function hexToBytes(hex: string): Uint8Array {
	const out = new Uint8Array(hex.length / 2);
	for (let i = 0; i < out.length; i++) {
		out[i] = parseInt(hex.slice(i * 2, i * 2 + 2), 16);
	}
	return out;
}

export function bytesToB64(bytes: Uint8Array): string {
	let s = '';
	for (let i = 0; i < bytes.length; i++) s += String.fromCharCode(bytes[i]);
	return btoa(s);
}

export function b64ToBytes(b64: string): Uint8Array {
	const s = atob(b64);
	const out = new Uint8Array(s.length);
	for (let i = 0; i < s.length; i++) out[i] = s.charCodeAt(i);
	return out;
}
