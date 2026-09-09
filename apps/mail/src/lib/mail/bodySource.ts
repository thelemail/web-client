import { getMessage } from '$lib/api/messages';
import { platform } from '$platform';
import type { MessageDetail } from '$lib/api/types';
import type { MirrorMessage } from '$lib/platform/types';
import { decryptBodyFromUrl, unwrapPgpMime } from './decrypt';
import { getCachedRender, putCachedRender, renderBody, type CachedRender } from './render';
import { detailFromMirror } from './mirrorDetail';

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
	opts: RenderDetailOptions,
	cachedMime?: string
): Promise<CachedRender> {
	const key = `${accountId}:${detail.id}|${opts.stripTracking ? 's' : '0'}|${
		opts.verificationKeysArmored?.length ? 'v' : '0'
	}`;
	const cached = getCachedRender(key);
	if (cached) return cached;

	if (cachedMime) {
		const render = await renderBody({ mime: cachedMime, stripTracking: opts.stripTracking });
		const entry: CachedRender = { render, mime: cachedMime };
		putCachedRender(key, entry);
		return entry;
	}

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
	const entry: CachedRender = { render, signature, mime };
	putCachedRender(key, entry);
	return entry;
}

async function fromMirror(
	accountId: string,
	messageId: string
): Promise<MirrorMessage | null> {
	if (!platform.mirror) return null;
	try {
		return await platform.mirror.message(accountId, messageId);
	} catch {
		return null;
	}
}

export async function loadMessageBody(
	accountId: string,
	messageId: string,
	opts: RenderDetailOptions
): Promise<LoadedBody> {
	const mirrored = await fromMirror(accountId, messageId);
	if (mirrored?.mime) {
		const detail = detailFromMirror(mirrored);
		const { render, signature } = await renderDetail(accountId, detail, opts, mirrored.mime);
		return { detail, render, signature };
	}

	try {
		const detail = await getMessage(messageId);
		const { render, signature } = await renderDetail(accountId, detail, opts);
		return { detail, render, signature };
	} catch (err) {
		if (mirrored) {
			throw new Error('This message has not been saved for offline reading yet.');
		}
		throw err;
	}
}
