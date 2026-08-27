import { b64ToBytes } from '$lib/crypto';
import { fetchRemoteImages, resolveBimi } from '$lib/api/messages';
import type { RelatedMIMEPart } from '../send';
import type { ParsedEml } from './parseEml';

export interface InlinedBody {
	html?: string;
	text?: string;
	related: RelatedMIMEPart[];
}

const MAX_REMOTE_FETCH = 100;

async function fetchRemote(
	urls: string[]
): Promise<Map<string, { contentType: string; bytes: Uint8Array }>> {
	const out = new Map<string, { contentType: string; bytes: Uint8Array }>();
	const unique = [...new Set(urls)].slice(0, MAX_REMOTE_FETCH);
	if (unique.length === 0) return out;
	try {
		const res = await fetchRemoteImages({ urls: unique });
		for (const img of res.images) {
			out.set(img.url, { contentType: img.contentType, bytes: b64ToBytes(img.dataBase64) });
		}
	} catch {
	}
	return out;
}

export async function buildInlinedBody(parsed: ParsedEml): Promise<InlinedBody> {
	const related: RelatedMIMEPart[] = [];
	for (const a of parsed.attachments) {
		if (a.disposition === 'inline' && a.contentId) {
			related.push({ contentId: a.contentId, contentType: a.mimeType, bytes: a.bytes });
		}
	}

	let html = parsed.html;
	if (html && parsed.remoteImageUrls.length > 0) {
		const doc = new DOMParser().parseFromString(html, 'text/html');
		const imgs = Array.from(doc.querySelectorAll('img'));
		const urls = imgs
			.map((img) => img.getAttribute('src') ?? '')
			.filter((s) => /^https?:/i.test(s));
		const fetched = await fetchRemote(urls);
		if (fetched.size > 0) {
			const cidByUrl = new Map<string, string>();
			let n = 0;
			for (const img of imgs) {
				const src = img.getAttribute('src') ?? '';
				const f = fetched.get(src);
				if (!f) continue;
				let cid = cidByUrl.get(src);
				if (!cid) {
					cid = `ri-${n++}@thelemail.import`;
					cidByUrl.set(src, cid);
					related.push({ contentId: cid, contentType: f.contentType, bytes: f.bytes });
				}
				img.setAttribute('src', `cid:${cid}`);
			}
			html = '<!DOCTYPE html>' + doc.documentElement.outerHTML;
		}
	}

	return { html, text: parsed.text, related };
}

const bimiCache = new Map<string, Promise<string>>();

export function resolveBimiDomain(domain: string): Promise<string> {
	const d = domain.trim().toLowerCase();
	if (!d) return Promise.resolve('');
	let p = bimiCache.get(d);
	if (!p) {
		p = resolveBimi({ domains: [d] })
			.then((r) => r.eligible[0] ?? '')
			.catch(() => '');
		bimiCache.set(d, p);
	}
	return p;
}
