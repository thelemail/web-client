import { describe, expect, it, vi } from 'vitest';
import type { SignatureRecord } from '$core/api/signatures';

const decrypt = vi.fn();

vi.mock('$core/keystore/keystore-client', () => ({ keystore: { decrypt } }));

const { openSignature } = await import('./signatureCrypto');

const IMG = 'data-thelemail-sig-image';

const HOSTILE =
	'<style>body{display:none}</style>' +
	'<p style="color:red;background:url(https://evil.example/x.png)">Ada</p>' +
	`<img ${IMG}="k1" src="">`;

function record(over: Partial<SignatureRecord> = {}): SignatureRecord {
	return {
		id: 's1',
		accountId: 'a1',
		addressId: 'addr1',
		enabled: true,
		appendOnReply: true,
		createdAt: '2026-10-15T00:00:00Z',
		updatedAt: '2026-10-15T00:00:00Z',
		...over
	};
}

function sealed(doc: object) {
	decrypt.mockResolvedValueOnce({ ok: true, plaintext: JSON.stringify(doc) });
	return record({ sealedBody: 'AAAA' });
}

function expectClean(html: string) {
	expect(html).not.toContain('<style');
	expect(html).not.toContain('display:none');
	expect(html).not.toContain('evil.example');
	expect(html).toContain('Ada');
	expect(html).toContain('color');
	expect(html).toContain(`${IMG}="k1"`);
}

describe('openSignature', () => {
	it('sanitizes the body of a sealed html-mode signature', async () => {
		const rec = sealed({ v: 1, mode: 'html', source: HOSTILE, bodyHtml: HOSTILE, images: [] });
		const opened = await openSignature('a1', rec);
		if (!opened.ok) throw new Error('expected an opened signature');
		expect(opened.doc.mode).toBe('html');
		expectClean(opened.doc.bodyHtml);
	});

	it('sanitizes a legacy unsealed body', async () => {
		const opened = await openSignature('a1', record({ bodyHtml: HOSTILE }));
		if (!opened.ok) throw new Error('expected an opened signature');
		expect(opened.legacy).toBe(true);
		expectClean(opened.doc.bodyHtml);
		expectClean(opened.doc.source);
	});

	it('leaves an already clean body untouched', async () => {
		const body = `<p>Ada Lovelace</p><p><a href="https://example.com">site</a></p><img ${IMG}="k1" src="">`;
		const rec = sealed({ v: 1, mode: 'rich', source: body, bodyHtml: body, images: [] });
		const opened = await openSignature('a1', rec);
		if (!opened.ok) throw new Error('expected an opened signature');
		expect(opened.doc.bodyHtml).toBe(body);
	});
});
