import { describe, it, expect, vi, beforeEach } from 'vitest';

vi.mock('$lib/api/messages', () => ({
	reportMessage: vi.fn()
}));

vi.mock('./originalHeaders', () => ({
	loadOriginalHeaders: vi.fn()
}));

import { reportMessage } from '$lib/api/messages';
import { ApiCallError } from '$lib/api/types';
import { loadOriginalHeaders } from './originalHeaders';
import { buildReportRequest, submitReport } from './report';

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
