import { describe, it, expect } from 'vitest';
import { composeMime } from './mime';
import { platform } from '../platform/web';

interface Probe {
	method: string;
	bytes: number;
	sha256: string;
	contentLength: number;
	contentType: string;
	authorization: string;
	accountId: string;
}

function randomFile(size: number, name: string): File {
	const data = new Uint8Array(size);
	for (let off = 0; off < size; off += 65536) {
		crypto.getRandomValues(data.subarray(off, Math.min(off + 65536, size)));
	}
	return new File([data], name, { type: 'application/octet-stream' });
}

async function sha256Hex(blob: Blob): Promise<string> {
	const digest = await crypto.subtle.digest('SHA-256', await blob.arrayBuffer());
	return Array.from(new Uint8Array(digest), (b) => b.toString(16).padStart(2, '0')).join('');
}

async function composeWith(files: File[]): Promise<Blob> {
	return composeMime(
		{
			fromName: 'Ada',
			fromAddress: 'ada@thelemail.com',
			to: [{ display: 'Bob', address: 'bob@example.org' }],
			subject: 'Quarterly numbers',
			body: 'Numbers attached.\nThanks.',
			bodyHtml: '<p>Numbers attached.</p>',
			date: new Date('2026-09-23T10:00:00Z'),
			messageId: 'm-1',
			attachments: files.map((f) => ({ filename: f.name, contentType: f.type, source: f }))
		},
		{
			date: 'Wed, 23 Sep 2026 10:00:00 +0000',
			messageId: '<m-1@thelemail.com>',
			fromName: 'Ada',
			fromAddress: 'ada@thelemail.com'
		}
	);
}

describe('streamed submission upload', () => {
	it('composes large attachments and uploads the exact bytes with a length', async () => {
		const message = await composeWith([
			randomFile(6 * 1024 * 1024 + 17, 'a.bin'),
			randomFile(1234, 'b.bin')
		]);
		expect(message.size).toBeGreaterThan(8 * 1024 * 1024);
		const progress: number[] = [];
		const resp = await platform.submissionUpload(
			'/__submission-probe',
			message,
			{
				'Content-Type': 'message/rfc822',
				Authorization: 'Bearer test-token',
				'X-Account-Id': 'acct-1'
			},
			{ onProgress: (f) => progress.push(f) }
		);
		expect(resp.status).toBe(200);
		const probe = (await resp.json()) as Probe;
		expect(probe.method).toBe('PUT');
		expect(probe.bytes).toBe(message.size);
		expect(probe.contentLength).toBe(message.size);
		expect(probe.contentType).toBe('message/rfc822');
		expect(probe.authorization).toBe('Bearer test-token');
		expect(probe.accountId).toBe('acct-1');
		expect(probe.sha256).toBe(await sha256Hex(message));
		expect(progress.length).toBeGreaterThan(0);
		expect(progress[progress.length - 1]).toBe(1);
	});

	it('produces 7-bit CRLF output in this engine', async () => {
		const message = await composeWith([randomFile(200_000, 'c.bin')]);
		const bytes = new Uint8Array(await message.arrayBuffer());
		let bare = 0;
		for (let i = 0; i < bytes.length; i++) {
			if (bytes[i] >= 0x80 || bytes[i] === 0) throw new Error(`byte ${bytes[i]} at ${i}`);
			if (bytes[i] === 0x0a && bytes[i - 1] !== 0x0d) bare++;
			if (bytes[i] === 0x0d && bytes[i + 1] !== 0x0a) bare++;
		}
		expect(bare).toBe(0);
	});

	it('aborts an upload in flight', async () => {
		const message = await composeWith([randomFile(4 * 1024 * 1024, 'd.bin')]);
		const controller = new AbortController();
		const pending = platform.submissionUpload(
			'/__submission-probe',
			message,
			{ 'Content-Type': 'message/rfc822' },
			{ signal: controller.signal }
		);
		controller.abort();
		await expect(pending).rejects.toMatchObject({ name: 'AbortError' });
	});
});
