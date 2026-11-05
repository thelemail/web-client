/// <reference lib="webworker" />

import * as openpgp from 'openpgp';
import { isAllowedBlobUrl } from '../blobOrigins';
import { currentProduct, isProductVault } from '../../products';
import { MAX_HEADER_BYTES, parseHeaderPrefix } from '$core/mail/attframe';
import type { DecryptedAttachmentHeader } from '$core/mail/attframe';
import type {
	AttachmentBytesArgs,
	AttachmentBytesResponse,
	AttachmentFailureCode,
	AttachmentHeaderArgs,
	AttachmentHeaderResponse,
	DecryptArgs,
	DecryptResponse,
	EncryptArgs,
	EncryptResponse,
	EncryptToKeysArgs,
	EncryptToKeysResponse,
	SignDetachedArgs,
	SignDetachedResponse,
	SealIndexArgs,
	SealIndexResponse,
	OpenIndexArgs,
	OpenIndexResponse,
	GetPublicKeyArgs,
	GetPublicKeyResponse,
	SignatureVerdict
} from '../protocol';
import type { VaultState } from './state';
import { vaults, indexKeys, hexToBytes, fingerprintHexOf, accountKeysByVersion } from './state';

export const HKDF_INFO_SEARCH_INDEX = new TextEncoder().encode(
	isProductVault
		? `thelemail-search-index-product-v1:${currentProduct}`
		: 'thelemail-search-index-v1'
);

export async function searchIndexKey(accountId: string): Promise<CryptoKey | null> {
	const cached = indexKeys.get(accountId);
	if (cached) return cached;
	const v = vaults.get(accountId);
	if (!v) return null;
	const ikm = await crypto.subtle.importKey(
		'raw',
		new TextEncoder().encode(v.keyPassword) as BufferSource,
		'HKDF',
		false,
		['deriveKey']
	);
	const key = await crypto.subtle.deriveKey(
		{
			name: 'HKDF',
			hash: 'SHA-256',
			salt: new TextEncoder().encode(accountId) as BufferSource,
			info: HKDF_INFO_SEARCH_INDEX as BufferSource
		},
		ikm,
		{ name: 'AES-GCM', length: 256 },
		false,
		['encrypt', 'decrypt']
	);
	indexKeys.set(accountId, key);
	return key;
}

export async function handleSealIndex(args: SealIndexArgs): Promise<SealIndexResponse> {
	const key = await searchIndexKey(args.accountId);
	if (!key) return { ok: false, code: 'locked' };
	try {
		const iv = crypto.getRandomValues(new Uint8Array(12));
		const ciphertext = new Uint8Array(
			await crypto.subtle.encrypt(
				{ name: 'AES-GCM', iv: iv as BufferSource },
				key,
				args.plaintext as BufferSource
			)
		);
		return { ok: true, iv, ciphertext };
	} catch {
		return { ok: false, code: 'unknown' };
	}
}

export async function handleOpenIndex(args: OpenIndexArgs): Promise<OpenIndexResponse> {
	const key = await searchIndexKey(args.accountId);
	if (!key) return { ok: false, code: 'locked' };
	try {
		const plaintext = new Uint8Array(
			await crypto.subtle.decrypt(
				{ name: 'AES-GCM', iv: args.iv as BufferSource },
				key,
				args.ciphertext as BufferSource
			)
		);
		return { ok: true, plaintext };
	} catch {
		return { ok: false, code: 'invalid_ciphertext' };
	}
}

export function aliasSigningKey(v: VaultState, aliasId: string | undefined): openpgp.PrivateKey | null {
	if (!aliasId) return v.privateKey;
	const fp = v.aliasCurrent.get(aliasId);
	if (!fp) return null;
	return v.aliasKeys.get(fp)?.privateKey ?? null;
}

export async function handleGetPublicKey(args: GetPublicKeyArgs): Promise<GetPublicKeyResponse> {
	const v = vaults.get(args.accountId);
	if (!v) {
		return { ok: false, code: 'locked' };
	}
	const signing = aliasSigningKey(v, args.aliasId);
	if (!signing) {
		return { ok: false, code: 'locked' };
	}
	const pub = signing.toPublic();
	const fp = pub.getFingerprint();
	const fingerprint = typeof fp === 'string' ? hexToBytes(fp) : new Uint8Array(fp as ArrayLike<number>);
	return {
		ok: true,
		publicKeyArmored: pub.armor(),
		fingerprint,
		keyVersion: args.aliasId ? undefined : v.keyVersion
	};
}

export async function handleEncrypt(args: EncryptArgs): Promise<EncryptResponse> {
	const v = vaults.get(args.accountId);
	if (!v) {
		return { ok: false, code: 'locked' };
	}
	let recipientKey;
	try {
		recipientKey = await openpgp.readKey({ armoredKey: args.recipientPublicKeyArmored });
	} catch (err) {
		console.warn('keystore: encrypt invalid recipient key', err);
		return { ok: false, code: 'invalid_recipient_key' };
	}
	try {
		const message = await openpgp.createMessage({ binary: args.plaintext });
		const signWith = args.signWithVaultKey ?? true;
		const signingKey = aliasSigningKey(v, args.aliasId);
		if (signWith && !signingKey) {
			return { ok: false, code: 'locked' };
		}
		const ciphertext = await openpgp.encrypt({
			message,
			encryptionKeys: recipientKey,
			signingKeys: signWith ? (signingKey as openpgp.PrivateKey) : undefined,
			format: 'binary'
		});
		return { ok: true, ciphertext: ciphertext as Uint8Array };
	} catch (err) {
		console.warn('keystore: encrypt failed', err);
		return { ok: false, code: 'unknown' };
	}
}

export async function handleSignDetached(args: SignDetachedArgs): Promise<SignDetachedResponse> {
	const v = vaults.get(args.accountId);
	if (!v) {
		return { ok: false, code: 'locked' };
	}
	const signingKey = v.privateKey;
	if (!signingKey) {
		return { ok: false, code: 'locked' };
	}
	try {
		const message = await openpgp.createMessage({ binary: args.data });
		const signature = await openpgp.sign({
			message,
			signingKeys: signingKey,
			detached: true,
			format: 'binary'
		});
		return {
			ok: true,
			signature: signature as Uint8Array,
			keyFingerprintHex: signingKey.getFingerprint().toLowerCase()
		};
	} catch (err) {
		console.warn('keystore: signDetached failed', err);
		return { ok: false, code: 'unknown' };
	}
}

export async function handleEncryptToKeys(args: EncryptToKeysArgs): Promise<EncryptToKeysResponse> {
	const v = vaults.get(args.accountId);
	if (!v) {
		return { ok: false, code: 'locked' };
	}
	if (args.recipientPublicKeysArmored.length === 0) {
		return { ok: false, code: 'no_recipients' };
	}
	let recipientKeys;
	try {
		recipientKeys = await Promise.all(
			args.recipientPublicKeysArmored.map((armoredKey) => openpgp.readKey({ armoredKey }))
		);
	} catch (err) {
		console.warn('keystore: encryptToKeys invalid recipient key', err);
		return { ok: false, code: 'invalid_recipient_key' };
	}
	try {
		const message = await openpgp.createMessage({ binary: args.plaintext });
		const signWith = args.signWithVaultKey ?? true;
		const signingKey = aliasSigningKey(v, args.aliasId);
		if (signWith && !signingKey) {
			return { ok: false, code: 'locked' };
		}
		const armored = await openpgp.encrypt({
			message,
			encryptionKeys: recipientKeys,
			signingKeys: signWith ? (signingKey as openpgp.PrivateKey) : undefined,
			format: 'armored'
		});
		return { ok: true, armored: armored as string };
	} catch (err) {
		console.warn('keystore: encryptToKeys failed', err);
		return { ok: false, code: 'unknown' };
	}
}

export interface PgpVerification {
	keyID: { toHex(): string };
	verified: Promise<true>;
	signature: Promise<openpgp.Signature>;
}

export async function verdictFor(
	signatures: PgpVerification[],
	keys: openpgp.PublicKey[]
): Promise<SignatureVerdict> {
	if (signatures.length === 0) return { state: 'none' };
	let unknown: SignatureVerdict | null = null;
	for (const sig of signatures) {
		const keyID = sig.keyID.toHex().toLowerCase();
		const match = keys.find((k) =>
			k.getKeys().some((sub) => sub.getKeyID().toHex().toLowerCase() === keyID)
		);
		if (!match) {
			if (!unknown) unknown = { state: 'unknown_key', issuerKeyIdHex: keyID, ...(await issuerOf(sig)) };
			continue;
		}
		try {
			await sig.verified;
		} catch {
			return { state: 'invalid', keyFingerprintHex: match.getFingerprint().toLowerCase() };
		}
		let signedAtMillis: number | undefined;
		try {
			const parsed = await sig.signature;
			signedAtMillis = parsed.packets[0]?.created?.getTime();
		} catch {
			signedAtMillis = undefined;
		}
		return {
			state: 'valid',
			keyFingerprintHex: match.getFingerprint().toLowerCase(),
			signedAtMillis
		};
	}
	return unknown ?? { state: 'none' };
}

export async function issuerOf(sig: PgpVerification): Promise<Pick<SignatureVerdict, 'issuerFingerprintHex' | 'signedAtMillis'>> {
	try {
		const packet = (await sig.signature).packets[0];
		const fp = packet?.issuerFingerprint;
		return {
			issuerFingerprintHex: fp && fp.length ? [...fp].map((b) => b.toString(16).padStart(2, '0')).join('') : undefined,
			signedAtMillis: packet?.created?.getTime()
		};
	} catch {
		return {};
	}
}

export function decryptionKeysFor(
	v: VaultState,
	keyFingerprintHex?: string
): openpgp.PrivateKey | openpgp.PrivateKey[] {
	const hint = keyFingerprintHex?.toLowerCase();
	if (hint) {
		if (hint === fingerprintHexOf(v.privateKey)) return v.privateKey;
		const hinted = v.accountKeys.get(hint) ?? v.aliasKeys.get(hint);
		if (hinted) return hinted.privateKey;
	}
	return [...accountKeysByVersion(v), ...[...v.aliasKeys.values()].map((e) => e.privateKey)];
}

export async function handleDecrypt(args: DecryptArgs): Promise<DecryptResponse> {
	const v = vaults.get(args.accountId);
	if (!v) {
		return { ok: false, code: 'locked' };
	}
	if (!args.ciphertextArmored && !args.ciphertextBinary) {
		return { ok: false, code: 'invalid_ciphertext' };
	}
	let verificationKeys: openpgp.PublicKey[] = [];
	if (args.verificationKeysArmored?.length) {
		try {
			verificationKeys = (await Promise.all(
				args.verificationKeysArmored.map((armoredKey) => openpgp.readKey({ armoredKey }))
			)) as openpgp.PublicKey[];
		} catch (err) {
			console.warn('keystore: decrypt invalid verification key', err);
			verificationKeys = [];
		}
	}
	const wanted = args.verificationKeysArmored?.length ? true : false;
	const decryptionKeys = decryptionKeysFor(v, args.keyFingerprintHex);
	try {
		const message = args.ciphertextArmored
			? await openpgp.readMessage({ armoredMessage: args.ciphertextArmored })
			: await openpgp.readMessage({ binaryMessage: args.ciphertextBinary as Uint8Array });
		if (args.binary) {
			const { data, signatures } = await openpgp.decrypt({
				message,
				decryptionKeys,
				verificationKeys: verificationKeys.length ? verificationKeys : undefined,
				expectSigned: false,
				format: 'binary'
			});
			if (!(data instanceof Uint8Array)) {
				return { ok: false, code: 'invalid_ciphertext' };
			}
			return {
				ok: true,
				plaintextBinary: data,
				signature: wanted ? await verdictFor(signatures, verificationKeys) : undefined
			};
		}
		const { data, signatures } = await openpgp.decrypt({
			message,
			decryptionKeys,
			verificationKeys: verificationKeys.length ? verificationKeys : undefined,
			expectSigned: false
		});
		if (typeof data !== 'string') {
			return { ok: false, code: 'invalid_ciphertext' };
		}
		return {
			ok: true,
			plaintext: data,
			signature: wanted ? await verdictFor(signatures, verificationKeys) : undefined
		};
	} catch (err) {
		const msg = err instanceof Error ? err.message : String(err);
		if (/no decryption key|session key decryption failed/i.test(msg)) {
			return { ok: false, code: 'no_matching_key' };
		}
		if (/armor|message|read|decrypt/i.test(msg)) {
			return { ok: false, code: 'invalid_ciphertext' };
		}
		console.warn('keystore: decrypt failed', err);
		return { ok: false, code: 'unknown' };
	}
}

export const ATTACHMENT_HEADER_TIMEOUT_MS = 25_000;
export const HEADER_PEEK_CIPHERTEXT_LIMIT = 512 * 1024;
export const ATTACHMENT_BYTES_TIMEOUT_MS = 170_000;

export function attachmentFailure(err: unknown): AttachmentFailureCode {
	const msg = err instanceof Error ? err.message : String(err);
	if (/no decryption key|session key decryption failed/i.test(msg)) return 'no_matching_key';
	if (/attframe|armor|message|read|decrypt|modification detected/i.test(msg)) {
		return 'invalid_ciphertext';
	}
	console.warn('keystore: attachment failed', err);
	return 'unknown';
}

class AttachmentNetworkError extends Error {}

export async function openAttachmentStream(
	url: string,
	headers: Record<string, string> | undefined,
	signal: AbortSignal
): Promise<ReadableStream<Uint8Array>> {
	if (!isAllowedBlobUrl(url)) throw new AttachmentNetworkError('blocked origin');
	let resp: Response;
	try {
		resp = await fetch(url, { signal, headers });
	} catch (err) {
		throw new AttachmentNetworkError(err instanceof Error ? err.message : 'fetch failed');
	}
	if (!resp.ok) throw new AttachmentNetworkError(`fetch ${resp.status}`);
	if (!resp.body) throw new AttachmentNetworkError('empty response body');
	return resp.body;
}

export function truncateStream(
	src: ReadableStream<Uint8Array>,
	limit: number
): ReadableStream<Uint8Array> {
	let sent = 0;
	return src.pipeThrough(
		new TransformStream<Uint8Array, Uint8Array>({
			transform(chunk, controller) {
				if (sent >= limit) return;
				const room = limit - sent;
				controller.enqueue(chunk.byteLength <= room ? chunk : chunk.subarray(0, room));
				sent += Math.min(room, chunk.byteLength);
				if (sent >= limit) controller.terminate();
			}
		})
	);
}

export async function decryptAttachmentStream(
	v: VaultState,
	url: string,
	headers: Record<string, string> | undefined,
	keyFingerprintHex: string | undefined,
	signal: AbortSignal,
	allowUnauthenticated: boolean,
	ciphertextLimit?: number
): Promise<ReadableStreamDefaultReader<Uint8Array>> {
	const fetched = await openAttachmentStream(url, headers, signal);
	const body = ciphertextLimit ? truncateStream(fetched, ciphertextLimit) : fetched;
	const message = await openpgp.readMessage({ binaryMessage: body });
	const { data } = await openpgp.decrypt({
		message,
		decryptionKeys: decryptionKeysFor(v, keyFingerprintHex),
		expectSigned: false,
		format: 'binary',
		config: allowUnauthenticated ? { allowUnauthenticatedStream: true } : undefined
	});
	if (data instanceof Uint8Array) {
		return new ReadableStream<Uint8Array>({
			start(controller) {
				controller.enqueue(data);
				controller.close();
			}
		}).getReader();
	}
	return (data as ReadableStream<Uint8Array>).getReader();
}

export function concatChunks(chunks: Uint8Array[], total: number): Uint8Array {
	const out = new Uint8Array(total);
	let off = 0;
	for (const c of chunks) {
		out.set(c, off);
		off += c.byteLength;
	}
	return out;
}

export async function peekAttachmentHeader(
	v: VaultState,
	args: AttachmentHeaderArgs,
	ciphertextLimit?: number
): Promise<DecryptedAttachmentHeader> {
	const abort = new AbortController();
	const timer = setTimeout(() => abort.abort(), ATTACHMENT_HEADER_TIMEOUT_MS);
	let reader: ReadableStreamDefaultReader<Uint8Array> | null = null;
	try {
		reader = await decryptAttachmentStream(
			v,
			args.url,
			args.headers,
			args.keyFingerprintHex,
			abort.signal,
			true,
			ciphertextLimit
		);
		const chunks: Uint8Array[] = [];
		let total = 0;
		const limit = MAX_HEADER_BYTES + 9;
		for (;;) {
			const { value, done } = await reader.read();
			if (value) {
				chunks.push(value);
				total += value.byteLength;
				const parsed = parseHeaderPrefix(concatChunks(chunks, total));
				if (parsed) return parsed.header;
			}
			if (done) throw new Error('attframe: truncated header');
			if (total > limit) throw new Error('attframe: header exceeds limit');
		}
	} finally {
		clearTimeout(timer);
		void reader?.cancel().catch(() => {});
		abort.abort();
	}
}

export async function handleAttachmentHeader(
	args: AttachmentHeaderArgs
): Promise<AttachmentHeaderResponse> {
	const v = vaults.get(args.accountId);
	if (!v) return { ok: false, code: 'locked' };
	try {
		return { ok: true, header: await peekAttachmentHeader(v, args, HEADER_PEEK_CIPHERTEXT_LIMIT) };
	} catch (err) {
		if (err instanceof AttachmentNetworkError) return { ok: false, code: 'network' };
	}
	try {
		return { ok: true, header: await peekAttachmentHeader(v, args) };
	} catch (err) {
		if (err instanceof AttachmentNetworkError) return { ok: false, code: 'network' };
		return { ok: false, code: attachmentFailure(err) };
	}
}

export async function handleAttachmentBytes(args: AttachmentBytesArgs): Promise<AttachmentBytesResponse> {
	const v = vaults.get(args.accountId);
	if (!v) return { ok: false, code: 'locked' };

	const abort = new AbortController();
	const timer = setTimeout(() => abort.abort(), ATTACHMENT_BYTES_TIMEOUT_MS);
	try {
		const reader = await decryptAttachmentStream(
			v,
			args.url,
			args.headers,
			args.keyFingerprintHex,
			abort.signal,
			false
		);
		const chunks: BlobPart[] = [];
		const lead: Uint8Array[] = [];
		let leadTotal = 0;
		let header: { header: DecryptedAttachmentHeader; headerEnd: number } | null = null;
		for (;;) {
			const { value, done } = await reader.read();
			if (value) {
				chunks.push(value as BlobPart);
				if (!header) {
					lead.push(value);
					leadTotal += value.byteLength;
					header = parseHeaderPrefix(concatChunks(lead, leadTotal));
					if (header) lead.length = 0;
					else if (leadTotal > MAX_HEADER_BYTES + 9) {
						throw new Error('attframe: header exceeds limit');
					}
				}
			}
			if (done) break;
		}
		if (!header) throw new Error('attframe: truncated header');
		const framed = new Blob(chunks);
		const payload = framed.slice(
			header.headerEnd,
			framed.size,
			header.header.contentType || 'application/octet-stream'
		);
		if (payload.size !== header.header.plaintextSize) {
			throw new Error(
				`attframe: payload size mismatch: header=${header.header.plaintextSize} got=${payload.size}`
			);
		}
		return { ok: true, header: header.header, payload };
	} catch (err) {
		if (err instanceof AttachmentNetworkError || abort.signal.aborted) {
			return { ok: false, code: 'network' };
		}
		return { ok: false, code: attachmentFailure(err) };
	} finally {
		clearTimeout(timer);
		abort.abort();
	}
}
