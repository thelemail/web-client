import { signatures } from '$core/stores/signatures.svelte';
import { unwrapSignatureSentinel } from './signatureRegion';
import { SIGNATURE_IMAGE_ATTR } from './editor/signatureImage';

export interface RelatedPart {
	contentId: string;
	contentType: string;
	bytes: Uint8Array;
}

export interface PackedBody {
	bodyHtml?: string;
	relatedParts: RelatedPart[];
}

export async function packBodyForSend(bodyHtml: string | undefined): Promise<PackedBody> {
	if (!bodyHtml || typeof DOMParser === 'undefined') {
		return { bodyHtml, relatedParts: [] };
	}
	const stripped = unwrapSignatureSentinel(bodyHtml);
	const doc = new DOMParser().parseFromString(`<div>${stripped}</div>`, 'text/html');
	const wrapper = doc.body.firstElementChild as HTMLElement | null;
	if (!wrapper) return { bodyHtml: stripped, relatedParts: [] };
	const imgs = Array.from(wrapper.querySelectorAll<HTMLImageElement>(`img[${SIGNATURE_IMAGE_ATTR}]`));
	if (imgs.length === 0) {
		return { bodyHtml: wrapper.innerHTML, relatedParts: [] };
	}
	const relatedParts: RelatedPart[] = [];
	const cidByKey = new Map<string, string>();
	const stamp = Date.now().toString(36);
	for (const img of imgs) {
		const key = img.getAttribute(SIGNATURE_IMAGE_ATTR);
		if (!key) {
			img.remove();
			continue;
		}
		const known = cidByKey.get(key);
		if (known) {
			img.setAttribute('src', `cid:${known}`);
			img.removeAttribute(SIGNATURE_IMAGE_ATTR);
			continue;
		}
		try {
			const fetched = await signatures.fetchImage(key);
			const bytes = new Uint8Array(await fetched.blob.arrayBuffer());
			const cid = `sig-${relatedParts.length}-${stamp}@thelemail.local`;
			relatedParts.push({
				contentId: cid,
				contentType: fetched.contentType || 'application/octet-stream',
				bytes
			});
			cidByKey.set(key, cid);
			img.setAttribute('src', `cid:${cid}`);
			img.removeAttribute(SIGNATURE_IMAGE_ATTR);
		} catch {
			img.remove();
		}
	}
	return { bodyHtml: wrapper.innerHTML, relatedParts };
}
