import { describe, it, expect, vi, beforeEach } from 'vitest';

vi.mock('$lib/keystore/keystore-client', () => ({
	keystore: {
		attachmentHeader: vi.fn(),
		attachmentBytes: vi.fn()
	}
}));
vi.mock('$lib/stores/aliasKeys.svelte', () => ({
	aliasKeys: { ready: vi.fn().mockResolvedValue(undefined), refresh: vi.fn() }
}));

import { keystore } from '$lib/keystore/keystore-client';
import { AttachmentError, initialChips, loadAttachmentHeader } from './attachments';
import type { AttachmentDetail, PresignedPointer } from '$lib/api/types';

const attachmentHeader = vi.mocked(keystore.attachmentHeader);

const header = {
	filename: 'q3-plan.docx',
	contentType: 'application/msword',
	disposition: 'attachment' as const,
	contentId: null,
	plaintextSize: 8
};

function chip(id: string, url = `https://blob/${id}`) {
	return {
		id,
		ordinal: 0,
		pointer: { url, expiresAt: '', sizeBytes: 64 } as PresignedPointer,
		state: 'loading' as const
	};
}

function att(overrides: Partial<AttachmentDetail> & Pick<AttachmentDetail, 'id' | 'ordinal'>): AttachmentDetail {
	return {
		pointer: { url: `https://blob/${overrides.id}`, expiresAt: '', sizeBytes: 0 },
		isInline: false,
		...overrides
	};
}

describe('initialChips', () => {
	it('drops inline parts and keeps real attachments', () => {
		const chips = initialChips([
			att({ id: 'a', ordinal: 0, isInline: true }),
			att({ id: 'b', ordinal: 1, isInline: false }),
			att({ id: 'c', ordinal: 2, isInline: true })
		]);
		expect(chips.map((c) => c.id)).toEqual(['b']);
		expect(chips[0].ordinal).toBe(1);
		expect(chips[0].state).toBe('loading');
	});

	it('preserves order and pointer for non-inline parts', () => {
		const chips = initialChips([
			att({ id: 'x', ordinal: 3 }),
			att({ id: 'y', ordinal: 5 })
		]);
		expect(chips.map((c) => c.id)).toEqual(['x', 'y']);
		expect(chips.map((c) => c.ordinal)).toEqual([3, 5]);
		expect(chips[0].pointer.url).toBe('https://blob/x');
	});

	it('returns nothing when every part is inline', () => {
		const chips = initialChips([
			att({ id: 'a', ordinal: 0, isInline: true }),
			att({ id: 'b', ordinal: 1, isInline: true })
		]);
		expect(chips).toEqual([]);
	});
});

describe('loadAttachmentHeader', () => {
	beforeEach(() => {
		attachmentHeader.mockReset();
	});

	it('makes one worker call for concurrent loads of the same attachment, then caches it', async () => {
		attachmentHeader.mockResolvedValue({ ok: true, header });

		const [a, b] = await Promise.all([
			loadAttachmentHeader('acct', chip('dedup')),
			loadAttachmentHeader('acct', chip('dedup'))
		]);
		expect(a.filename).toBe('q3-plan.docx');
		expect(b).toBe(a);
		expect(attachmentHeader).toHaveBeenCalledTimes(1);

		await loadAttachmentHeader('acct', chip('dedup'));
		expect(attachmentHeader).toHaveBeenCalledTimes(1);
	});

	it('passes the pointer key fingerprint through as a decryption hint', async () => {
		attachmentHeader.mockResolvedValue({ ok: true, header });
		const c = chip('hinted');
		c.pointer.keyFingerprint = 'abc123';

		await loadAttachmentHeader('acct', c);
		expect(attachmentHeader).toHaveBeenCalledWith({
			accountId: 'acct',
			url: 'https://blob/hinted',
			keyFingerprintHex: 'abc123'
		});
	});

	it('refreshes an expired pointer once and retries', async () => {
		attachmentHeader
			.mockResolvedValueOnce({ ok: false, code: 'network' })
			.mockResolvedValueOnce({ ok: true, header });
		const refresh = vi.fn().mockResolvedValue({
			url: 'https://blob/fresh',
			expiresAt: '',
			sizeBytes: 64
		} as PresignedPointer);

		const got = await loadAttachmentHeader('acct', chip('expired'), refresh);
		expect(got.filename).toBe('q3-plan.docx');
		expect(refresh).toHaveBeenCalledTimes(1);
		expect(refresh).toHaveBeenCalledWith('expired');
		expect(attachmentHeader).toHaveBeenNthCalledWith(2, expect.objectContaining({ url: 'https://blob/fresh' }));
	});

	it('does not retry failures that a fresh pointer cannot fix', async () => {
		attachmentHeader.mockResolvedValue({ ok: false, code: 'no_matching_key' });
		const refresh = vi.fn();

		await expect(loadAttachmentHeader('acct', chip('nokey'), refresh)).rejects.toMatchObject({
			code: 'no_matching_key'
		});
		expect(refresh).not.toHaveBeenCalled();
		expect(attachmentHeader).toHaveBeenCalledTimes(1);
	});

	it('does not cache a failure, so retrying calls the worker again', async () => {
		attachmentHeader.mockResolvedValueOnce({ ok: false, code: 'unknown' });
		await expect(loadAttachmentHeader('acct', chip('flaky'))).rejects.toBeInstanceOf(AttachmentError);

		attachmentHeader.mockResolvedValueOnce({ ok: true, header });
		const got = await loadAttachmentHeader('acct', chip('flaky'));
		expect(got.filename).toBe('q3-plan.docx');
		expect(attachmentHeader).toHaveBeenCalledTimes(2);
	});
});
