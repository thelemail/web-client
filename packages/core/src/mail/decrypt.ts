import { keystore } from '$core/keystore/keystore-client';
import { aliasKeys } from '$core/stores/aliasKeys.svelte';
import type { SignatureVerdict } from '$core/keystore/protocol';
import type { MessagePreview } from './preview';
import { isPgpEncryptedMime, extractPgpArmor } from './pgpMime';
import { apiBlobFetch } from '$core/api/client';
import { ApiCallError, type BlobPointer } from '$core/api/types';
import { b64ToHex, bytesToB64 } from '$core/keys/encode';

export type { SignatureVerdict } from '$core/keystore/protocol';

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

async function withAliasKeys<T>(
	accountId: string,
	run: () => Promise<T>,
	fingerprintHint?: string
): Promise<T> {
	await aliasKeys.ready(accountId);
	try {
		return await run();
	} catch (err) {
		if (!(err instanceof DecryptionError) || err.code !== 'no_matching_key') throw err;
		await aliasKeys.refresh(accountId);
		void fingerprintHint;
		return run();
	}
}

function base64ToBytes(b64: string): Uint8Array {
	const s = atob(b64);
	const out = new Uint8Array(s.length);
	for (let i = 0; i < s.length; i++) out[i] = s.charCodeAt(i);
	return out;
}

async function decryptBinary(
	accountId: string,
	b64: string,
	keyFingerprintHex?: string
): Promise<string> {
	const bytes = base64ToBytes(b64);
	return withAliasKeys(accountId, async () => {
		const res = await keystore.decrypt({
			accountId,
			ciphertextBinary: bytes,
			keyFingerprintHex
		});
		if (!res.ok) {
			throw new DecryptionError(res.code);
		}
		if (!('plaintext' in res)) {
			throw new DecryptionError('invalid_ciphertext', 'expected text plaintext');
		}
		return res.plaintext;
	});
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
	await aliasKeys.ready(accountId);
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

async function fetchBody(accountId: string, pointer: BlobPointer): Promise<Uint8Array> {
	try {
		const resp = await apiBlobFetch(pointer.path, { accountId });
		return new Uint8Array(await resp.arrayBuffer());
	} catch (err) {
		if (err instanceof ApiCallError) throw new DecryptionError('unknown', `fetch body ${err.status}`);
		throw err;
	}
}

export async function decryptBody(
	accountId: string,
	pointer: BlobPointer,
	verificationKeysArmored?: string[]
): Promise<DecryptedText> {
	const buf = await fetchBody(accountId, pointer);
	return withAliasKeys(accountId, async () => {
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
	});
}

export class BlobChangedError extends Error {
	constructor() {
		super('blob changed');
		this.name = 'BlobChangedError';
	}
}

export interface StoredBody {
	storedBytes: number;
	mime: Uint8Array;
}

async function matchesPointer(ciphertext: Uint8Array, pointer: BlobPointer): Promise<boolean> {
	if (ciphertext.length !== pointer.sizeBytes) return false;
	if (!pointer.sha256) return true;
	const digest = new Uint8Array(await crypto.subtle.digest('SHA-256', ciphertext as BufferSource));
	return bytesToB64(digest) === pointer.sha256;
}

export async function decryptStoredBody(accountId: string, pointer: BlobPointer, signal?: AbortSignal): Promise<StoredBody> {
	const resp = await apiBlobFetch(pointer.path, { accountId, signal });
	const ciphertext = new Uint8Array(await resp.arrayBuffer());
	if (!(await matchesPointer(ciphertext, pointer))) throw new BlobChangedError();
	const keyFingerprintHex = pointer.keyFingerprint ? b64ToHex(pointer.keyFingerprint) : undefined;
	const stored = await withAliasKeys(accountId, async () => {
		const res = await keystore.decrypt({ accountId, ciphertextBinary: ciphertext, binary: true, keyFingerprintHex });
		if (!res.ok) throw new DecryptionError(res.code);
		if (!('plaintextBinary' in res)) throw new DecryptionError('invalid_ciphertext', 'expected binary plaintext for body');
		return res.plaintextBinary;
	});
	const text = new TextDecoder().decode(stored);
	if (!isPgpEncryptedMime(text)) return { storedBytes: stored.length, mime: stored };
	const inner = await unwrapPgpMime(accountId, { plaintext: text });
	return { storedBytes: stored.length, mime: new TextEncoder().encode(inner.plaintext) };
}
