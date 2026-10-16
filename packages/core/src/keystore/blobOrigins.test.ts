import { describe, expect, it } from 'vitest';
import { isAllowedBlobUrl } from './blobOrigins';

describe('isAllowedBlobUrl', () => {
	it('rejects the object store', () => {
		expect(isAllowedBlobUrl('https://fsn1.your-objectstorage.com/thelemail/m/a/att-0.pgp')).toBe(false);
	});

	it('accepts the API origin', () => {
		expect(isAllowedBlobUrl('https://api.test.thelemail.local/v1/messages/abc/body')).toBe(true);
	});

	it('rejects an unrelated origin', () => {
		expect(isAllowedBlobUrl('https://evil.example/steal')).toBe(false);
	});

	it('rejects a lookalike host', () => {
		expect(isAllowedBlobUrl('https://api.test.thelemail.local.evil.example/steal')).toBe(false);
	});

	it('rejects a non-http scheme', () => {
		expect(isAllowedBlobUrl('file:///etc/passwd')).toBe(false);
		expect(isAllowedBlobUrl('data:text/plain,hello')).toBe(false);
	});

	it('rejects a malformed url', () => {
		expect(isAllowedBlobUrl('not a url')).toBe(false);
		expect(isAllowedBlobUrl('')).toBe(false);
	});
});
