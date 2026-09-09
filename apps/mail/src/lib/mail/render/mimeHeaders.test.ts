import { describe, it, expect } from 'vitest';
import { splitMimeHeaders } from './mimeHeaders';

describe('splitMimeHeaders', () => {
	it('returns the header block before the first blank line (LF)', () => {
		const mime = 'From: a@example.com\nTo: b@example.com\n\nHello there\n\nBye';
		expect(splitMimeHeaders(mime)).toBe('From: a@example.com\nTo: b@example.com');
	});

	it('returns the header block before the first blank line (CRLF)', () => {
		const mime = 'From: a@example.com\r\nTo: b@example.com\r\n\r\nBody';
		expect(splitMimeHeaders(mime)).toBe('From: a@example.com\r\nTo: b@example.com');
	});

	it('preserves folded header lines', () => {
		const mime =
			'Subject: a very long\n subject that folds\nReceived: from relay\n\tby mx.example.com\n\nBody';
		expect(splitMimeHeaders(mime)).toBe(
			'Subject: a very long\n subject that folds\nReceived: from relay\n\tby mx.example.com'
		);
	});

	it('handles mixed CRLF headers with an LF-only body separator later', () => {
		const mime = 'From: a@example.com\r\nSubject: hi\r\n\r\nfirst\n\nsecond';
		expect(splitMimeHeaders(mime)).toBe('From: a@example.com\r\nSubject: hi');
	});

	it('returns the whole input when no blank line exists', () => {
		expect(splitMimeHeaders('From: a@example.com\nTo: b@example.com\n')).toBe(
			'From: a@example.com\nTo: b@example.com'
		);
	});

	it('returns empty for headerless content', () => {
		expect(splitMimeHeaders('just a plain body with no headers')).toBe('');
		expect(splitMimeHeaders('\nBody after leading blank line')).toBe('');
		expect(splitMimeHeaders('\r\nBody')).toBe('');
	});

	it('returns empty for empty input', () => {
		expect(splitMimeHeaders('')).toBe('');
	});
});
