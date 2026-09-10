import { describe, it, expect, vi, beforeEach } from 'vitest';

const fetchImage = vi.fn();
vi.mock('$core/stores/signatures.svelte', () => ({
	signatures: { fetchImage: (...a: unknown[]) => fetchImage(...a) }
}));

import { packBodyForSend } from './signaturePack';

function blobOf(text: string, type = 'image/png') {
	return { blob: new Blob([text], { type }), contentType: type };
}

const SIG = 'data-thelemail-signature';
const IMG = 'data-thelemail-sig-image';

describe('packBodyForSend', () => {
	beforeEach(() => fetchImage.mockReset());

	it('returns the body untouched when there is nothing to pack', async () => {
		const out = await packBodyForSend('<p>hello</p>');
		expect(out.bodyHtml).toBe('<p>hello</p>');
		expect(out.relatedParts).toHaveLength(0);
		expect(fetchImage).not.toHaveBeenCalled();
	});

	it('unwraps the signature sentinel but keeps its children', async () => {
		const out = await packBodyForSend(`<p>hi</p><div ${SIG}="1"><p>Ada</p></div>`);
		expect(out.bodyHtml).toBe('<p>hi</p><p>Ada</p>');
	});

	it('converts a signature image into one related part with a cid src', async () => {
		fetchImage.mockImplementation(async () => blobOf('png-bytes'));
		const out = await packBodyForSend(`<div ${SIG}="1"><img ${IMG}="k1" alt=""></div>`);

		expect(out.relatedParts).toHaveLength(1);
		expect(out.relatedParts[0].contentType).toBe('image/png');
		expect(out.bodyHtml).toContain(`src="cid:${out.relatedParts[0].contentId}"`);
		expect(out.bodyHtml).not.toContain(IMG);
	});

	it('emits a single part when the same image is used twice', async () => {
		fetchImage.mockImplementation(async () => blobOf('png-bytes'));
		const out = await packBodyForSend(`<img ${IMG}="k1"><img ${IMG}="k1">`);

		expect(fetchImage).toHaveBeenCalledTimes(1);
		expect(out.relatedParts).toHaveLength(1);
		const cid = out.relatedParts[0].contentId;
		expect(out.bodyHtml?.match(new RegExp(`cid:${cid}`, 'g'))).toHaveLength(2);
	});

	it('gives distinct cids to distinct images', async () => {
		fetchImage.mockImplementation(async (k: string) => blobOf(k));
		const out = await packBodyForSend(`<img ${IMG}="k1"><img ${IMG}="k2">`);

		expect(out.relatedParts).toHaveLength(2);
		expect(out.relatedParts[0].contentId).not.toBe(out.relatedParts[1].contentId);
	});


	it('removes the image entirely when its bytes cannot be read', async () => {
		fetchImage.mockImplementation(async () => ({ blob: null, contentType: '' }));
		const out = await packBodyForSend(`<p>hi</p><img ${IMG}="k1">`);

		expect(out.relatedParts).toHaveLength(0);
		expect(out.bodyHtml).not.toContain('<img');
		expect(out.bodyHtml).toContain('<p>hi</p>');
	});
});
