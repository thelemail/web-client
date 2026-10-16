import { describe, it, expect, vi, beforeEach } from 'vitest';

vi.mock('$core/api/messages', () => ({ getMessage: vi.fn() }));
vi.mock('./decrypt', () => ({ decryptBody: vi.fn() }));

import { getMessage } from '$core/api/messages';
import type { MessageDetail } from '$core/api/types';
import { decryptBody } from './decrypt';
import { loadOriginalHeaders } from './originalHeaders';

const fetchDetail = vi.mocked(getMessage);
const decrypt = vi.mocked(decryptBody);

function detail(path: string): MessageDetail {
	return { id: 'm1', body: { url: 'https://blob.example' + path, path } } as MessageDetail;
}

beforeEach(() => {
	vi.resetAllMocks();
});

describe('loadOriginalHeaders', () => {
	it('fetches the message, decrypts its body and returns the header block', async () => {
		fetchDetail.mockResolvedValue(detail('/v1/messages/one/body'));
		decrypt.mockResolvedValue({ plaintext: 'Received: from mx.example.com\r\n\tby thelemail\r\nFrom: a@example.com\r\nSubject: hi\r\n\r\nbody text' });
		const headers = await loadOriginalHeaders('acc-1', 'm1');
		expect(headers).toBe(
			'Received: from mx.example.com\r\n\tby thelemail\r\nFrom: a@example.com\r\nSubject: hi'
		);
		expect(decrypt).toHaveBeenCalledWith('acc-1', expect.objectContaining({ path: '/v1/messages/one/body' }));
	});

	it('re-fetches the message on every call', async () => {
		fetchDetail
			.mockResolvedValueOnce(detail('/v1/messages/one/body'))
			.mockResolvedValueOnce(detail('/v1/messages/two/body'));
		decrypt.mockResolvedValue({ plaintext: 'From: a@example.com\n\nbody' });
		await loadOriginalHeaders('acc-1', 'm1');
		await loadOriginalHeaders('acc-1', 'm1');
		expect(fetchDetail).toHaveBeenCalledTimes(2);
		expect(decrypt.mock.calls.map((c) => c[1].path)).toEqual([
			'/v1/messages/one/body',
			'/v1/messages/two/body'
		]);
	});

	it('keeps the outer headers of a PGP/MIME message', async () => {
		fetchDetail.mockResolvedValue(detail('/v1/messages/pgp/body'));
		decrypt.mockResolvedValue({ plaintext: 'From: a@example.com\nContent-Type: multipart/encrypted;\n boundary="b1"\n\n--b1\nContent-Type: application/pgp-encrypted\n\nVersion: 1\n' });
		expect(await loadOriginalHeaders('acc-1', 'm1')).toBe(
			'From: a@example.com\nContent-Type: multipart/encrypted;\n boundary="b1"'
		);
	});

	it('returns an empty block when the payload carries no headers', async () => {
		fetchDetail.mockResolvedValue(detail('/v1/messages/raw/body'));
		decrypt.mockResolvedValue({ plaintext: 'just a body' });
		expect(await loadOriginalHeaders('acc-1', 'm1')).toBe('');
	});

	it('propagates decryption failures', async () => {
		fetchDetail.mockResolvedValue(detail('/v1/messages/one/body'));
		decrypt.mockRejectedValue(new Error('locked'));
		await expect(loadOriginalHeaders('acc-1', 'm1')).rejects.toThrow('locked');
	});
});
