import { describe, expect, it } from 'vitest';
import { inlineScriptHashes, resolveOrigins } from '../../../scripts/csp.ts';

const complete = {
	PUBLIC_API_BASE_URL: 'https://api.thelemail.com/',
	PUBLIC_SUBMISSION_BASE_URL: 'https://submission.thelemail.com'
};

describe('resolveOrigins', () => {
	it('reduces configured urls to origins', () => {
		expect(resolveOrigins(complete)).toEqual(['https://api.thelemail.com', 'https://submission.thelemail.com']);
	});

	it('collapses duplicates', () => {
		const origins = resolveOrigins({ ...complete, PUBLIC_SUBMISSION_BASE_URL: 'https://api.thelemail.com/submit' });
		expect(origins).toEqual(['https://api.thelemail.com']);
	});

	it('never lets an object-store origin into the policy', () => {
		const origins = resolveOrigins({ ...complete, PUBLIC_BLOB_ORIGIN: 'https://fsn1.your-objectstorage.com' });
		expect(origins).toEqual(['https://api.thelemail.com', 'https://submission.thelemail.com']);
	});

	for (const name of Object.keys(complete)) {
		it(`refuses to build without ${name}`, () => {
			expect(() => resolveOrigins({ ...complete, [name]: '' })).toThrow(name);
		});
	}

	it('rejects a value that is not an absolute url', () => {
		expect(() => resolveOrigins({ ...complete, PUBLIC_SUBMISSION_BASE_URL: 'submission.thelemail.com' })).toThrow(
			'PUBLIC_SUBMISSION_BASE_URL'
		);
	});
});

describe('inlineScriptHashes', () => {
	it('returns the body of inline scripts', () => {
		expect(inlineScriptHashes('<script>a()</script>')).toEqual(['a()']);
	});

	it('ignores scripts with a src', () => {
		expect(inlineScriptHashes('<script src="/x.js"></script>')).toEqual([]);
	});
});
