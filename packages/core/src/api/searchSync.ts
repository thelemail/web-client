import { apiFetch, apiFetchWithStatus, apiRawFetch } from './client';
import {
	ApiCallError,
	type SearchArtifactFetchItem,
	type SearchArtifactKey,
	type SearchArtifactPage,
	type SearchArtifactUploadItem,
	type SearchArtifactUploadResponse,
	type SearchGeneration,
	type SearchSyncState
} from './types';

const PREFIX = 4;
const MAX_MANIFEST = 256 << 10;

export class FrameError extends Error {
	constructor(message: string) {
		super(message);
		this.name = 'FrameError';
	}
}

export function encodeFrames(manifest: unknown, items: readonly Uint8Array[]): Blob {
	const head = new TextEncoder().encode(JSON.stringify(manifest));
	const prefix = new Uint8Array(PREFIX);
	new DataView(prefix.buffer).setUint32(0, head.byteLength);
	return new Blob([prefix, head, ...items] as BlobPart[], { type: 'application/octet-stream' });
}

export function decodeFrames<T>(raw: Uint8Array, lengths: (manifest: T) => number[]): { manifest: T; items: Uint8Array[] } {
	if (raw.byteLength < PREFIX) throw new FrameError('short frame');
	const size = new DataView(raw.buffer, raw.byteOffset, raw.byteLength).getUint32(0);
	if (size > MAX_MANIFEST || PREFIX + size > raw.byteLength) throw new FrameError('short manifest');
	let manifest: T;
	try {
		manifest = JSON.parse(new TextDecoder('utf-8', { fatal: true }).decode(raw.subarray(PREFIX, PREFIX + size))) as T;
	} catch {
		throw new FrameError('malformed manifest');
	}
	const items: Uint8Array[] = [];
	let at = PREFIX + size;
	for (const n of lengths(manifest)) {
		if (!Number.isSafeInteger(n) || n < 0 || at + n > raw.byteLength) throw new FrameError('short item');
		items.push(raw.slice(at, at + n));
		at += n;
	}
	if (at !== raw.byteLength) throw new FrameError('trailing bytes');
	return { manifest, items };
}

export function getSearchSyncState(accountId: string): Promise<SearchSyncState> {
	return apiFetch('/v1/search/sync/state', { accountId });
}

export function enableSearchSync(accountId: string): Promise<SearchSyncState> {
	return apiFetch('/v1/search/sync/settings', { method: 'PUT', accountId, body: { enabled: true } });
}

export async function disableSearchSync(accountId: string): Promise<void> {
	await apiFetch('/v1/search/sync', { method: 'DELETE', accountId });
}

export type GenerationResult = { created: SearchGeneration } | { exists: SearchGeneration };

export async function createSearchGeneration(
	accountId: string,
	body: { generationId: string; productKeyEpoch: number; bundle: string }
): Promise<GenerationResult> {
	try {
		const res = await apiFetchWithStatus<SearchGeneration>('/v1/search/sync/generations', {
			method: 'POST',
			accountId,
			body,
			headers: { 'If-None-Match': '*' }
		});
		return { created: res.body };
	} catch (error) {
		const existing = error instanceof ApiCallError && error.status === 412 ? error.envelope?.error?.generation : undefined;
		if (existing) return { exists: existing };
		throw error;
	}
}

export function listSearchArtifacts(accountId: string, generationId: string, afterSeq: number, limit: number): Promise<SearchArtifactPage> {
	const params = new URLSearchParams({ generationId, afterSeq: String(afterSeq), limit: String(limit) });
	return apiFetch(`/v1/search/artifacts?${params}`, { accountId });
}

export async function uploadSearchArtifacts(
	accountId: string,
	generationId: string,
	items: readonly { item: SearchArtifactUploadItem; bytes: Uint8Array }[]
): Promise<SearchArtifactUploadResponse> {
	const body = encodeFrames(
		{ generationId, items: items.map((i) => i.item) },
		items.map((i) => i.bytes)
	);
	const resp = await apiRawFetch('/v1/search/artifacts', { method: 'PUT', body, contentType: 'application/octet-stream' }, { accountId });
	return (await resp.json()) as SearchArtifactUploadResponse;
}

export interface FetchedArtifact {
	item: SearchArtifactFetchItem;
	bytes: Uint8Array | null;
}

export async function fetchSearchArtifacts(accountId: string, generationId: string, keys: readonly SearchArtifactKey[]): Promise<FetchedArtifact[]> {
	const resp = await apiRawFetch(
		'/v1/search/artifacts/fetch',
		{ method: 'POST', body: JSON.stringify({ generationId, items: keys }), contentType: 'application/json' },
		{ accountId }
	);
	const raw = new Uint8Array(await resp.arrayBuffer());
	const { manifest, items } = decodeFrames<{ items: SearchArtifactFetchItem[] }>(raw, (m) => {
		if (!Array.isArray(m?.items)) throw new FrameError('malformed manifest');
		return m.items.filter((i) => i.status === 'ready').map((i) => i.length ?? -1);
	});
	let next = 0;
	return manifest.items.map((item) => ({ item, bytes: item.status === 'ready' ? items[next++] : null }));
}
