import { keystore } from '$core/keystore/keystore-client';
import type { IndexChunk, IndexedText } from './types';

export class SealError extends Error {
	code: 'locked' | 'invalid_ciphertext' | 'unknown';
	constructor(code: SealError['code']) {
		super(code);
		this.code = code;
		this.name = 'SealError';
	}
}

export async function sealChunk(
	accountId: string,
	chunkId: number,
	texts: IndexedText[]
): Promise<IndexChunk> {
	const plaintext = new TextEncoder().encode(JSON.stringify(texts));
	const res = await keystore.sealIndex({ accountId, plaintext });
	if (!res.ok) throw new SealError(res.code);
	return { accountId, chunkId, iv: res.iv, ciphertext: res.ciphertext };
}

export async function openChunk(accountId: string, chunk: IndexChunk): Promise<IndexedText[]> {
	const res = await keystore.openIndex({
		accountId,
		iv: chunk.iv,
		ciphertext: chunk.ciphertext
	});
	if (!res.ok) throw new SealError(res.code);
	const parsed = JSON.parse(new TextDecoder().decode(res.plaintext));
	return Array.isArray(parsed) ? (parsed as IndexedText[]) : [];
}
