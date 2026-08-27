import { signatures } from '$lib/stores/signatures.svelte';
import { unwrapSignatureSentinel } from './signatureRegion';

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
	const imgs = Array.from(
		wrapper.querySelectorAll<HTMLImageElement>('img[data-thelemail-sig-image]')
	);
	if (imgs.length === 0) {
		return { bodyHtml: wrapper.innerHTML, relatedParts: [] };
	}
	const relatedParts: RelatedPart[] = [];
	for (let i = 0; i < imgs.length; i++) {
		const img = imgs[i];
		const key = img.getAttribute('data-thelemail-sig-image');
		if (!key) continue;
		try {
			const fetched = await signatures.fetchImage(key);
			const bytes = new Uint8Array(await fetched.blob.arrayBuffer());
			const cid = `sig-${i}-${Date.now().toString(36)}@thelemail.local`;
			relatedParts.push({
				contentId: cid,
				contentType: fetched.contentType || img.getAttribute('data-content-type') || 'application/octet-stream',
				bytes
			});
			img.setAttribute('src', `cid:${cid}`);
			img.removeAttribute('data-thelemail-sig-image');
		} catch (err) {
			img.removeAttribute('data-thelemail-sig-image');
		}
	}
	return { bodyHtml: wrapper.innerHTML, relatedParts };
}
