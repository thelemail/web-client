import { b64ToBytes, bytesToB64 } from '$core/keys/encode';
import { keystore } from '$core/keystore/keystore-client';

export const COLLECTION_META_VERSION = 1;

export interface CollectionMeta {
	name: string;
	color: string | null;
}

export interface SealedCollectionMeta {
	sealedMeta: string;
	metaKeyFingerprint: string;
	metaSchemaVersion: number;
}

export class CollectionSealError extends Error {
	constructor(readonly code: 'locked' | 'failed') {
		super(code);
		this.name = 'CollectionSealError';
	}
}

export async function sealCollectionMeta(
	accountId: string,
	meta: CollectionMeta
): Promise<SealedCollectionMeta> {
	const key = await keystore.getPublicKey({ accountId });
	if (!key.ok) throw new CollectionSealError('locked');
	const res = await keystore.encrypt({
		accountId,
		recipientPublicKeyArmored: key.publicKeyArmored,
		plaintext: new TextEncoder().encode(JSON.stringify({ n: meta.name, c: meta.color }))
	});
	if (!res.ok) throw new CollectionSealError(res.code === 'locked' ? 'locked' : 'failed');
	return {
		sealedMeta: bytesToB64(res.ciphertext),
		metaKeyFingerprint: bytesToB64(key.fingerprint),
		metaSchemaVersion: COLLECTION_META_VERSION
	};
}

export async function openCollectionMeta(
	accountId: string,
	sealedMeta: string
): Promise<CollectionMeta | null> {
	let bytes: Uint8Array;
	try {
		bytes = b64ToBytes(sealedMeta);
	} catch {
		return null;
	}
	const res = await keystore.decrypt({ accountId, ciphertextBinary: bytes });
	if (!res.ok || !('plaintext' in res)) return null;
	try {
		const parsed = JSON.parse(res.plaintext) as { n?: unknown; c?: unknown };
		if (typeof parsed.n !== 'string' || !parsed.n.trim()) return null;
		return { name: parsed.n, color: typeof parsed.c === 'string' ? parsed.c : null };
	} catch {
		return null;
	}
}
