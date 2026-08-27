import { keystore } from '$lib/keystore/keystore-client';
import type { MessagePreview } from './preview';
import { isPgpEncryptedMime, extractPgpArmor } from './pgpMime';

export class DecryptionError extends Error {
	code: 'locked' | 'invalid_ciphertext' | 'unknown';
	constructor(code: DecryptionError['code'], message?: string) {
		super(message ?? code);
		this.code = code;
		this.name = 'DecryptionError';
	}
}

function base64ToBytes(b64: string): Uint8Array {
	const s = atob(b64);
	const out = new Uint8Array(s.length);
	for (let i = 0; i < s.length; i++) out[i] = s.charCodeAt(i);
	return out;
}

async function decryptBinary(accountId: string, b64: string): Promise<string> {
	const bytes = base64ToBytes(b64);
	const res = await keystore.decrypt({ accountId, ciphertextBinary: bytes });
	if (!res.ok) {
		throw new DecryptionError(res.code);
	}
	if (!('plaintext' in res)) {
		throw new DecryptionError('invalid_ciphertext', 'expected text plaintext');
	}
	return res.plaintext;
}

export async function decryptPreview(
	accountId: string,
	encryptedPreviewB64: string
): Promise<MessagePreview> {
	const plaintext = await decryptPreviewRaw(accountId, encryptedPreviewB64);
	try {
		return JSON.parse(plaintext) as MessagePreview;
	} catch {
		throw new DecryptionError('invalid_ciphertext', 'preview is not valid JSON');
	}
}

export function decryptPreviewRaw(accountId: string, encryptedPreviewB64: string): Promise<string> {
	return decryptBinary(accountId, encryptedPreviewB64);
}

export async function unwrapPgpMime(accountId: string, mime: string): Promise<string> {
	let current = mime;
	for (let depth = 0; depth < 3; depth++) {
		if (!isPgpEncryptedMime(current)) return current;
		const armor = extractPgpArmor(current);
		if (!armor) {
			throw new DecryptionError('invalid_ciphertext', 'missing PGP payload');
		}
		const res = await keystore.decrypt({ accountId, ciphertextArmored: armor });
		if (!res.ok) {
			throw new DecryptionError(res.code);
		}
		if (!('plaintext' in res)) {
			throw new DecryptionError('invalid_ciphertext', 'expected text plaintext');
		}
		current = res.plaintext;
	}
	if (isPgpEncryptedMime(current)) {
		throw new DecryptionError('invalid_ciphertext', 'nesting too deep');
	}
	return current;
}

export async function decryptBodyFromUrl(accountId: string, url: string): Promise<string> {
	const resp = await fetch(url);
	if (!resp.ok) {
		throw new DecryptionError('unknown', `fetch body ${resp.status}`);
	}
	const buf = new Uint8Array(await resp.arrayBuffer());
	const res = await keystore.decrypt({ accountId, ciphertextBinary: buf });
	if (!res.ok) {
		throw new DecryptionError(res.code);
	}
	if (!('plaintext' in res)) {
		throw new DecryptionError('invalid_ciphertext', 'expected text plaintext for body');
	}
	return res.plaintext;
}
