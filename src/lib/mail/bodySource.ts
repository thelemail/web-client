import { getMessage } from '$lib/api/messages';
import type { MessageDetail } from '$lib/api/types';
import { decryptBodyFromUrl, unwrapPgpMime } from './decrypt';
import { getCachedRender, putCachedRender, renderBody, type CachedRender } from './render';

export interface LoadedBody extends CachedRender {
	detail: MessageDetail;
}

export interface RenderDetailOptions {
	stripTracking: boolean;
	verificationKeysArmored?: string[];
}

export async function renderDetail(
	accountId: string,
	detail: MessageDetail,
	opts: RenderDetailOptions
): Promise<CachedRender> {
	const key = `${accountId}:${detail.id}|${opts.stripTracking ? 's' : '0'}|${
		opts.verificationKeysArmored?.length ? 'v' : '0'
	}`;
	const cached = getCachedRender(key);
	if (cached) return cached;
	const outer = await decryptBodyFromUrl(
		accountId,
		detail.body.url,
		opts.verificationKeysArmored
	);
	const { plaintext: mime, signature } = await unwrapPgpMime(
		accountId,
		outer,
		opts.verificationKeysArmored
	);
	const render = await renderBody({ mime, stripTracking: opts.stripTracking });
	const entry: CachedRender = { render, signature };
	putCachedRender(key, entry);
	return entry;
}

export async function loadMessageBody(
	accountId: string,
	messageId: string,
	opts: RenderDetailOptions
): Promise<LoadedBody> {
	const detail = await getMessage(messageId);
	const { render, signature } = await renderDetail(accountId, detail, opts);
	return { detail, render, signature };
}
