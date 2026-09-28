import { describe, it, expect, vi, beforeEach } from 'vitest';

const listeners = vi.hoisted(() => [] as ((msg: { type: string; accountId?: string }) => void)[]);

vi.mock('$app/environment', () => ({ browser: true }));
vi.mock('$platform', () => ({ platform: { saveBlob: vi.fn().mockResolvedValue(undefined) } }));
vi.mock('$core/keystore/keystore-client', () => ({
	keystore: {
		attachmentHeader: vi.fn(),
		attachmentBytes: vi.fn(),
		subscribe: vi.fn((fn: (msg: { type: string; accountId?: string }) => void) => listeners.push(fn))
	}
}));
vi.mock('$core/stores/aliasKeys.svelte', () => ({
	aliasKeys: { ready: vi.fn().mockResolvedValue(undefined), refresh: vi.fn() }
}));

import { keystore } from '$core/keystore/keystore-client';
import { platform } from '$platform';
import {
	AttachmentError,
	downloadAttachment,
	initialChips,
	loadAttachmentBytes,
	loadAttachmentHeader
} from './attachments';
import type { AttachmentDetail, PresignedPointer } from '$core/api/types';

const attachmentHeader = vi.mocked(keystore.attachmentHeader);
const attachmentBytes = vi.mocked(keystore.attachmentBytes);

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

describe('loadAttachmentBytes', () => {
	beforeEach(() => {
		attachmentBytes.mockReset();
		vi.mocked(platform.saveBlob).mockClear();
	});

	function bytes(size: number) {
		return { ok: true as const, header, payload: new Blob([new Uint8Array(size)]) };
	}

	it('decrypts once for a preview followed by a download', async () => {
		attachmentBytes.mockResolvedValue(bytes(8));

		const shown = await loadAttachmentBytes('acct', chip('pv'));
		await downloadAttachment('acct', chip('pv'));

		expect(attachmentBytes).toHaveBeenCalledTimes(1);
		expect(platform.saveBlob).toHaveBeenCalledWith(shown.blob, 'q3-plan.docx');
	});

	it('shares one worker call between concurrent requests', async () => {
		attachmentBytes.mockResolvedValue(bytes(8));
		const [a, b] = await Promise.all([
			loadAttachmentBytes('acct', chip('both')),
			loadAttachmentBytes('acct', chip('both'))
		]);
		expect(b).toBe(a);
		expect(attachmentBytes).toHaveBeenCalledTimes(1);
	});

	it('keeps only the most recent few attachments', async () => {
		attachmentBytes.mockImplementation(async () => bytes(8));
		for (const id of ['e1', 'e2', 'e3', 'e4']) await loadAttachmentBytes('acct', chip(id));
		await loadAttachmentBytes('acct', chip('e4'));
		expect(attachmentBytes).toHaveBeenCalledTimes(4);
		await loadAttachmentBytes('acct', chip('e1'));
		expect(attachmentBytes).toHaveBeenCalledTimes(5);
	});

	it('does not hold on to very large files', async () => {
		attachmentBytes.mockImplementation(async () => bytes(61 * 1024 * 1024));
		await loadAttachmentBytes('acct', chip('huge'));
		await loadAttachmentBytes('acct', chip('huge'));
		expect(attachmentBytes).toHaveBeenCalledTimes(2);
	});

	it('forgets plaintext when the account locks', async () => {
		attachmentBytes.mockImplementation(async () => bytes(8));
		await loadAttachmentBytes('acct', chip('lk'));
		await loadAttachmentBytes('other', chip('lk'));
		for (const fn of listeners) fn({ type: 'locked', accountId: 'acct' });

		await loadAttachmentBytes('other', chip('lk'));
		expect(attachmentBytes).toHaveBeenCalledTimes(2);
		await loadAttachmentBytes('acct', chip('lk'));
		expect(attachmentBytes).toHaveBeenCalledTimes(3);
	});

	it('does not cache a failed decrypt', async () => {
		attachmentBytes.mockResolvedValueOnce({ ok: false, code: 'unknown' });
		await expect(loadAttachmentBytes('acct', chip('bad'))).rejects.toBeInstanceOf(AttachmentError);
		attachmentBytes.mockResolvedValueOnce(bytes(8));
		await loadAttachmentBytes('acct', chip('bad'));
		expect(attachmentBytes).toHaveBeenCalledTimes(2);
	});
});
