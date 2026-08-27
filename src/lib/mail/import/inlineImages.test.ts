import { describe, it, expect, vi, beforeEach } from 'vitest';

const fetchRemoteImages = vi.fn();
const resolveBimi = vi.fn();
vi.mock('$lib/api/messages', () => ({
	fetchRemoteImages: (...a: unknown[]) => fetchRemoteImages(...a),
	resolveBimi: (...a: unknown[]) => resolveBimi(...a)
}));
vi.mock('$lib/crypto', () => ({
	b64ToBytes: (b64: string) => Uint8Array.from(atob(b64), (c) => c.charCodeAt(0))
}));

import { buildInlinedBody } from './inlineImages';
import type { ParsedEml } from './parseEml';

function baseParsed(over: Partial<ParsedEml>): ParsedEml {
	return {
		references: [],
		subject: 's',
		from: { display: '', address: 'a@example.com' },
		recipients: [],
		attachments: [],
		remoteImageUrls: [],
		...over
	};
}

describe('buildInlinedBody', () => {
	beforeEach(() => fetchRemoteImages.mockReset());

	it('rewrites a remote <img> to cid: and adds the fetched bytes as a related part', async () => {
		fetchRemoteImages.mockResolvedValue({
			images: [{ url: 'https://x.example/a.png', contentType: 'image/png', dataBase64: btoa('img') }]
		});
		const parsed = baseParsed({
			html: '<p>hi</p><img src="https://x.example/a.png">',
			remoteImageUrls: ['https://x.example/a.png']
		});

		const out = await buildInlinedBody(parsed);

		expect(out.related).toHaveLength(1);
		const cid = out.related[0].contentId;
		expect(out.html).toContain(`cid:${cid}`);
		expect(out.html).not.toContain('https://x.example/a.png');
		expect(fetchRemoteImages).toHaveBeenCalledOnce();
	});

	it('keeps existing inline cid: images as related parts and does not fetch', async () => {
		const parsed = baseParsed({
			html: '<img src="cid:logo">',
			attachments: [
				{
					filename: 'logo.png',
					mimeType: 'image/png',
					disposition: 'inline',
					contentId: 'logo',
					bytes: new Uint8Array([1, 2, 3])
				}
			]
		});

		const out = await buildInlinedBody(parsed);

		expect(out.related).toHaveLength(1);
		expect(out.related[0].contentId).toBe('logo');
		expect(fetchRemoteImages).not.toHaveBeenCalled();
	});

	it('leaves the body untouched when the proxy returns no image (stays remote)', async () => {
		fetchRemoteImages.mockResolvedValue({ images: [] });
		const parsed = baseParsed({
			html: '<img src="https://x.example/a.png">',
			remoteImageUrls: ['https://x.example/a.png']
		});

		const out = await buildInlinedBody(parsed);

		expect(out.related).toHaveLength(0);
		expect(out.html).toContain('https://x.example/a.png');
	});
});
