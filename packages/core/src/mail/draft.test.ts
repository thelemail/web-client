import { describe, it, expect, vi, beforeEach } from 'vitest';

vi.mock('$core/keystore/keystore-client', () => ({
	keystore: {
		decrypt: vi.fn()
	}
}));

vi.mock('$platform', () => ({
	platform: {
		blobFetch: vi.fn(),
		blobPut: vi.fn()
	}
}));

vi.mock('$core/api/drafts', () => ({
	issueDraftAttachmentUpload: vi.fn()
}));

vi.mock('./decrypt', () => {
	class DecryptionError extends Error {
		code: string;
		constructor(code: string, message?: string) {
			super(message ?? code);
			this.code = code;
		}
	}
	return { DecryptionError, decryptBodyFromUrl: vi.fn() };
});

vi.mock('./attachments', () => ({
	decryptAttachmentFull: vi.fn()
}));

vi.mock('./send', () => ({
	senderKey: vi.fn(async () => ({ publicKeyArmored: 'own-key', fingerprintB64: 'own-fp' })),
	buildEnvelope: vi.fn(async () => ({
		encryptedPreview: 'p',
		previewKeyFingerprint: 'own-fp',
		encryptedBody: 'b',
		bodyKeyFingerprint: 'own-fp',
		bodySha256: 's',
		bodySizeBytes: 1,
		attachments: []
	})),
	encryptTo: vi.fn(async (_accountId: string, plaintext: Uint8Array) => plaintext.map((b) => b ^ 0x5a)),
	sha256B64: async (bytes: Uint8Array) => {
		const digest = new Uint8Array(await crypto.subtle.digest('SHA-256', bytes as BufferSource));
		return btoa(String.fromCharCode(...digest));
	}
}));

import { keystore } from '$core/keystore/keystore-client';
import { platform } from '$platform';
import { issueDraftAttachmentUpload } from '$core/api/drafts';
import { decryptBodyFromUrl } from './decrypt';
import { encryptTo } from './send';
import {
	buildDraftEnvelope,
	loadDraftDoc,
	packDraftBundle,
	restoreDraftAttachments,
	unpackDraftBundle,
	uploadDraftBundle,
	DRAFT_DOC_VERSION,
	type DraftDoc
} from './draft';
import type { DraftDetail, PresignedPointer } from '$core/api/types';

function unxor(bytes: Uint8Array): Uint8Array {
	return bytes.map((b) => b ^ 0x5a);
}

function file(name: string, body: string, type = 'text/plain'): File {
	return new File([body], name, { type });
}

function baseDoc(): DraftDoc {
	return {
		v: DRAFT_DOC_VERSION,
		from: { email: 'me@thelemail.com', name: 'Me' },
		to: [{ address: 'you@example.com' }],
		cc: [],
		bcc: [],
		subject: 'Hi',
		bodyHtml: '<p>Hi</p>',
		bodyText: 'Hi',
		attachments: []
	};
}

async function sha(bytes: Uint8Array): Promise<string> {
	const digest = new Uint8Array(await crypto.subtle.digest('SHA-256', bytes as BufferSource));
	return btoa(String.fromCharCode(...digest));
}

beforeEach(() => {
	vi.clearAllMocks();
});

describe('draft attachment bundle', () => {
	it('packs every attachment into one ciphertext and restores them in order', async () => {
		const packed = await packDraftBundle('acct', [
			{ file: file('notes.txt', 'first file'), disposition: 'attachment' },
			{ file: file('logo.png', 'png-bytes', 'image/png'), disposition: 'inline', contentId: 'logo@x' }
		]);

		expect(encryptTo).toHaveBeenCalledTimes(1);
		expect(vi.mocked(encryptTo).mock.calls[0][2]).toBe('own-key');
		expect(packed.fingerprintB64).toBe('own-fp');
		expect(packed.sha256B64).toBe(await sha(packed.ciphertext));
		expect(packed.metas.map((m) => [m.filename, m.offset])).toEqual([
			['notes.txt', 0],
			['logo.png', packed.metas[0].length]
		]);
		expect(packed.metas[1].offset + packed.metas[1].length).toBe(packed.ciphertext.byteLength);

		const restored = unpackDraftBundle(unxor(packed.ciphertext), packed.metas);
		expect(restored.map((r) => r.file.name)).toEqual(['notes.txt', 'logo.png']);
		expect(await restored[0].file.text()).toBe('first file');
		expect(restored[1].file.type).toBe('image/png');
		expect(restored[1].disposition).toBe('inline');
		expect(restored[1].contentId).toBe('logo@x');
	});

	it('rejects metadata that points outside the bundle', async () => {
		const packed = await packDraftBundle('acct', [{ file: file('a.txt', 'aaa'), disposition: 'attachment' }]);
		const meta = { ...packed.metas[0], length: packed.metas[0].length + 10 };
		expect(() => unpackDraftBundle(unxor(packed.ciphertext), [meta])).toThrow();
	});

	it('uploads the bundle through a grant for exactly its size', async () => {
		vi.mocked(issueDraftAttachmentUpload).mockResolvedValue({
			uploadId: 'up-1',
			putUrl: 'https://store.example/put',
			putHeaders: { 'x-amz-content-sha256': 'abc' },
			expiresAt: '2026-10-14T00:00:00Z'
		});
		vi.mocked(platform.blobPut).mockResolvedValue(new Response(null, { status: 200 }));
		const packed = await packDraftBundle('acct', [{ file: file('a.txt', 'aaa'), disposition: 'attachment' }]);

		await expect(uploadDraftBundle('draft-1', packed)).resolves.toBe('up-1');
		expect(issueDraftAttachmentUpload).toHaveBeenCalledWith('draft-1', {
			ciphertextSizeBytes: packed.ciphertext.byteLength,
			ciphertextSha256: packed.sha256B64,
			keyFingerprint: 'own-fp'
		});
		const [, sent, headers] = vi.mocked(platform.blobPut).mock.calls[0];
		expect((sent as Blob).size).toBe(packed.ciphertext.byteLength);
		expect(headers).toEqual({ 'x-amz-content-sha256': 'abc' });
	});

	it('fails the upload when storage refuses the bundle', async () => {
		vi.mocked(issueDraftAttachmentUpload).mockResolvedValue({
			uploadId: 'up-1',
			putUrl: 'https://store.example/put',
			putHeaders: { 'x-amz-content-sha256': 'abc' },
			expiresAt: '2026-10-14T00:00:00Z'
		});
		vi.mocked(platform.blobPut).mockResolvedValue(new Response(null, { status: 403 }));
		const packed = await packDraftBundle('acct', [{ file: file('a.txt', 'aaa'), disposition: 'attachment' }]);
		await expect(uploadDraftBundle('draft-1', packed)).rejects.toThrow();
	});

	it('restores attachments after checking the downloaded bundle', async () => {
		const packed = await packDraftBundle('acct', [{ file: file('a.txt', 'hello'), disposition: 'attachment' }]);
		vi.mocked(platform.blobFetch).mockResolvedValue(new Response(packed.ciphertext as BodyInit));
		vi.mocked(keystore.decrypt).mockResolvedValue({ ok: true, plaintextBinary: unxor(packed.ciphertext) });
		const pointer: PresignedPointer = {
			url: 'https://store.example/get',
			expiresAt: '2026-10-14T00:00:00Z',
			sizeBytes: packed.ciphertext.byteLength,
			sha256: packed.sha256B64
		};

		const restored = await restoreDraftAttachments('acct', { ...baseDoc(), attachments: packed.metas }, pointer);
		expect(await restored[0].file.text()).toBe('hello');
		expect(vi.mocked(keystore.decrypt).mock.calls[0][0]).toMatchObject({ accountId: 'acct', binary: true });
	});

	it('refuses a downloaded bundle whose checksum does not match', async () => {
		const packed = await packDraftBundle('acct', [{ file: file('a.txt', 'hello'), disposition: 'attachment' }]);
		vi.mocked(platform.blobFetch).mockResolvedValue(new Response(new Uint8Array([1, 2, 3]) as BodyInit));
		const pointer: PresignedPointer = {
			url: 'https://store.example/get',
			expiresAt: '2026-10-14T00:00:00Z',
			sizeBytes: 3,
			sha256: packed.sha256B64
		};

		await expect(
			restoreDraftAttachments('acct', { ...baseDoc(), attachments: packed.metas }, pointer)
		).rejects.toThrow();
		expect(keystore.decrypt).not.toHaveBeenCalled();
	});
});

describe('draft envelope', () => {
	it('never sends attachment descriptors and passes the attachments change through', async () => {
		const req = await buildDraftEnvelope('acct', baseDoc(), { action: 'replace', uploadId: 'up-1', count: 2 });
		expect(req.sealed.attachments).toEqual([]);
		expect(req.attachments).toEqual({ action: 'replace', uploadId: 'up-1', count: 2 });

		const keep = await buildDraftEnvelope('acct', baseDoc());
		expect(keep.attachments).toBeUndefined();
	});

	it('drops attachment entries from documents written before bundles', async () => {
		const legacy = {
			...baseDoc(),
			v: 1,
			attachments: [{ ordinal: 0, objectKey: 'm/x/y/att-0.pgp', filename: 'old.pdf' }]
		};
		vi.mocked(decryptBodyFromUrl).mockResolvedValue({ plaintext: JSON.stringify(legacy) });
		const detail = { body: { url: 'https://store.example/body' } } as DraftDetail;

		const doc = await loadDraftDoc('acct', detail);
		expect(doc.subject).toBe('Hi');
		expect(doc.attachments).toEqual([]);
	});
});
