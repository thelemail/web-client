import { keystore } from '$lib/keystore/keystore-client';
import type { SignatureVerdict } from '$lib/keystore/protocol';
import type { MessagePreview } from './preview';
import { isPgpEncryptedMime, extractPgpArmor } from './pgpMime';

export type { SignatureVerdict } from '$lib/keystore/protocol';

export interface DecryptedText {
	plaintext: string;
	signature?: SignatureVerdict;
}

export class DecryptionError extends Error {
	code: 'locked' | 'invalid_ciphertext' | 'no_matching_key' | 'unknown';
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

export async function unwrapPgpMime(
	accountId: string,
	mime: DecryptedText,
	verificationKeysArmored?: string[]
): Promise<DecryptedText> {
	let current = mime.plaintext;
	let signature = mime.signature;
	for (let depth = 0; depth < 3; depth++) {
		if (!isPgpEncryptedMime(current)) return { plaintext: current, signature };
		const armor = extractPgpArmor(current);
		if (!armor) {
			throw new DecryptionError('invalid_ciphertext', 'missing PGP payload');
		}
		const res = await keystore.decrypt({
			accountId,
			ciphertextArmored: armor,
			verificationKeysArmored
		});
		if (!res.ok) {
			throw new DecryptionError(res.code);
		}
		if (!('plaintext' in res)) {
			throw new DecryptionError('invalid_ciphertext', 'expected text plaintext');
		}
		current = res.plaintext;
		if (res.signature && res.signature.state !== 'none') signature = res.signature;
	}
	if (isPgpEncryptedMime(current)) {
		throw new DecryptionError('invalid_ciphertext', 'nesting too deep');
	}
	return { plaintext: current, signature };
}

export async function decryptBodyFromUrl(
	accountId: string,
	url: string,
	verificationKeysArmored?: string[]
): Promise<DecryptedText> {
	const resp = await fetch(url);
	if (!resp.ok) {
		throw new DecryptionError('unknown', `fetch body ${resp.status}`);
	}
	const buf = new Uint8Array(await resp.arrayBuffer());
	const res = await keystore.decrypt({
		accountId,
		ciphertextBinary: buf,
		verificationKeysArmored
	});
	if (!res.ok) {
		throw new DecryptionError(res.code);
	}
	if (!('plaintext' in res)) {
		throw new DecryptionError('invalid_ciphertext', 'expected text plaintext for body');
	}
	return { plaintext: res.plaintext, signature: res.signature };
}
