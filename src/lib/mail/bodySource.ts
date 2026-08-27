import { getMessage } from '$lib/api/messages';
import type { MessageDetail } from '$lib/api/types';
import { decryptBodyFromUrl, unwrapPgpMime } from './decrypt';
import { getCachedRender, putCachedRender, renderBody, type RenderResult } from './render';

export interface LoadedBody {
	detail: MessageDetail;
	render: RenderResult;
}

export async function renderDetail(
	accountId: string,
	detail: MessageDetail,
	opts: { stripTracking: boolean }
): Promise<RenderResult> {
	const key = `${accountId}:${detail.id}|${opts.stripTracking ? 's' : '0'}`;
	const cached = getCachedRender(key);
	if (cached) return cached;
	const mime = await unwrapPgpMime(accountId, await decryptBodyFromUrl(accountId, detail.body.url));
	const render = await renderBody({ mime, stripTracking: opts.stripTracking });
	putCachedRender(key, render);
	return render;
}

export async function loadMessageBody(
	accountId: string,
	messageId: string,
	opts: { stripTracking: boolean }
): Promise<LoadedBody> {
	const detail = await getMessage(messageId);
	const render = await renderDetail(accountId, detail, opts);
	return { detail, render };
}
