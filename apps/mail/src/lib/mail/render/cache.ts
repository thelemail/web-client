import { browser } from '$app/environment';
import { keystore } from '$lib/keystore/keystore-client';
import type { SignatureVerdict } from '$lib/keystore/protocol';
import type { RenderResult } from './renderBody';

export interface CachedRender {
	render: RenderResult;
	signature?: SignatureVerdict;
	mime?: string;
}

const MAX_ENTRIES = 32;

const cache = new Map<string, CachedRender>();

export function renderCacheKey(accountId: string, suffix: string): string {
	return `${accountId}:${suffix}`;
}

export function getCachedRender(key: string): CachedRender | undefined {
	const v = cache.get(key);
	if (!v) return undefined;
	cache.delete(key);
	cache.set(key, v);
	return v;
}

export function putCachedRender(key: string, value: CachedRender): void {
	if (cache.has(key)) cache.delete(key);
	cache.set(key, value);
	while (cache.size > MAX_ENTRIES) {
		const oldest = cache.keys().next().value;
		if (oldest === undefined) break;
		cache.delete(oldest);
	}
}

export function clearRenderCache(): void {
	cache.clear();
}

export function clearRenderCacheForAccount(accountId: string): void {
	const prefix = `${accountId}:`;
	for (const k of [...cache.keys()]) {
		if (k.startsWith(prefix)) cache.delete(k);
	}
}

let subscribed = false;
function subscribeOnce(): void {
	if (subscribed || !browser) return;
	subscribed = true;
	try {
		keystore.subscribe((msg) => {
			if (msg.type === 'cleared' || msg.type === 'locked') {
				clearRenderCacheForAccount(msg.accountId);
			} else if (msg.type === 'clearedAll') {
				clearRenderCache();
			}
		});
	} catch {
		subscribed = false;
	}
}
subscribeOnce();
