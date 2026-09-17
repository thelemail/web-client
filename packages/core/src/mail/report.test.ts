import { describe, it, expect, vi, beforeEach } from 'vitest';

vi.mock('$core/api/messages', () => ({
	reportMessage: vi.fn()
}));

vi.mock('./originalHeaders', () => ({
	loadOriginalHeaders: vi.fn()
}));

import { reportMessage } from '$core/api/messages';
import { ApiCallError } from '$core/api/types';
import { loadOriginalHeaders } from './originalHeaders';
import { buildReportRequest, capHeaderBytes, submitReport } from './report';

const report = vi.mocked(reportMessage);
const headers = vi.mocked(loadOriginalHeaders);

beforeEach(() => {
	vi.resetAllMocks();
	report.mockResolvedValue(undefined);
	headers.mockResolvedValue('From: spoof@evil.example\r\nSubject: hi');
});

describe('buildReportRequest', () => {
	it('sends only the kind when consent is withheld', () => {
		expect(
			buildReportRequest('phishing', false, 'From: a@b.example', 'a@b.example')
		).toEqual({ kind: 'phishing' });
	});

	it('includes headers and sender address once consent is given', () => {
		expect(buildReportRequest('spam', true, 'From: a@b.example', 'A@B.example  ')).toEqual({
			kind: 'spam',
			headers: 'From: a@b.example',
			senderAddress: 'A@B.example'
		});
	});

	it('omits empty fields rather than sending blanks', () => {
		expect(buildReportRequest('spam', true, '   \n ', '')).toEqual({ kind: 'spam' });
	});

	it('caps the header block at 64 KiB', () => {
		const big = 'x'.repeat(70000);
		const req = buildReportRequest('phishing', true, big, undefined);
		expect(req.headers).toHaveLength(65536);
	});

	it('caps by UTF-8 bytes, not characters, and cuts on a line boundary', () => {
		const line = 'Subject: ' + 'é'.repeat(100) + '\r\n';
		const big = line.repeat(400);
		const req = buildReportRequest('spam', true, big, undefined);
		const bytes = new TextEncoder().encode(req.headers ?? '');
		expect(bytes.length).toBeLessThanOrEqual(65536);
		expect(bytes.length).toBeGreaterThan(65536 - line.length * 2);
		expect(req.headers?.endsWith('é')).toBe(true);
		expect(req.headers).not.toContain('\uFFFD');
	});
});

describe('submitReport', () => {
	it('never touches the stored message when consent is withheld', async () => {
		const outcome = await submitReport('acc', 'msg', {
			kind: 'phishing',
			includeHeaders: false,
			senderAddress: 'spoof@evil.example'
		});
		expect(headers).not.toHaveBeenCalled();
		expect(report).toHaveBeenCalledWith('msg', { kind: 'phishing' });
		expect(outcome).toEqual({
			headersRequested: false,
			headersIncluded: false,
			duplicate: false
		});
	});

	it('decrypts and attaches the headers when consent is given', async () => {
		const outcome = await submitReport('acc', 'msg', {
			kind: 'spam',
			includeHeaders: true,
			senderAddress: 'spoof@evil.example'
		});
		expect(headers).toHaveBeenCalledWith('acc', 'msg');
		expect(report).toHaveBeenCalledWith('msg', {
			kind: 'spam',
			headers: 'From: spoof@evil.example\r\nSubject: hi',
			senderAddress: 'spoof@evil.example'
		});
		expect(outcome.headersRequested).toBe(true);
		expect(outcome.headersIncluded).toBe(true);
	});

	it('still reports when the headers cannot be decrypted', async () => {
		headers.mockRejectedValue(new Error('locked'));
		const outcome = await submitReport('acc', 'msg', {
			kind: 'phishing',
			includeHeaders: true,
			senderAddress: 'spoof@evil.example'
		});
		expect(report).toHaveBeenCalledWith('msg', {
			kind: 'phishing',
			senderAddress: 'spoof@evil.example'
		});
		expect(outcome).toEqual({
			headersRequested: true,
			headersIncluded: false,
			duplicate: false
		});
	});

	it('treats a repeat report as a duplicate instead of an error', async () => {
		report.mockRejectedValue(new ApiCallError(409, null, 'already reported'));
		const outcome = await submitReport('acc', 'msg', {
			kind: 'spam',
			includeHeaders: false
		});
		expect(outcome.duplicate).toBe(true);
	});

	it('propagates other failures', async () => {
		report.mockRejectedValue(new ApiCallError(500, null, 'boom'));
		await expect(
			submitReport('acc', 'msg', { kind: 'spam', includeHeaders: false })
		).rejects.toThrow('boom');
	});
});

describe('capHeaderBytes', () => {
	it('leaves a block under the limit untouched', () => {
		expect(capHeaderBytes('From: a@b.example\r\nTo: c@d.example', 1024)).toBe(
			'From: a@b.example\r\nTo: c@d.example'
		);
	});

	it('never splits a multi-byte character without a line to cut on', () => {
		const out = capHeaderBytes('ééé', 5);
		expect(out).toBe('éé');
	});
});
