import { describe, it, expect } from 'vitest';
import { forwardSubject, replySubject, strippedSubject } from './subjects';

describe('replySubject', () => {
	it('prefixes a plain subject', () => {
		expect(replySubject('Quarterly report')).toBe('Re: Quarterly report');
	});

	it('keeps an existing Re: prefix regardless of case', () => {
		expect(replySubject('Re: Quarterly report')).toBe('Re: Quarterly report');
		expect(replySubject('RE: Quarterly report')).toBe('RE: Quarterly report');
		expect(replySubject('re: quarterly report')).toBe('re: quarterly report');
	});

	it('is idempotent', () => {
		const once = replySubject('Quarterly report');
		expect(replySubject(once)).toBe(once);
	});

	it('trims before matching the prefix', () => {
		expect(replySubject('  Re: Hello  ')).toBe('Re: Hello');
	});

	it('falls back for empty and whitespace-only subjects', () => {
		expect(replySubject('')).toBe('Re: (no subject)');
		expect(replySubject('   ')).toBe('Re: (no subject)');
	});

	it('stacks on top of a forward prefix', () => {
		expect(replySubject('Fwd: Hello')).toBe('Re: Fwd: Hello');
	});
});

describe('forwardSubject', () => {
	it('prefixes a plain subject', () => {
		expect(forwardSubject('Quarterly report')).toBe('Fwd: Quarterly report');
	});

	it('keeps Fwd: and Fw: prefixes regardless of case', () => {
		expect(forwardSubject('Fwd: Hello')).toBe('Fwd: Hello');
		expect(forwardSubject('FWD: Hello')).toBe('FWD: Hello');
		expect(forwardSubject('Fw: Hello')).toBe('Fw: Hello');
		expect(forwardSubject('fw: hello')).toBe('fw: hello');
	});

	it('is idempotent', () => {
		const once = forwardSubject('Quarterly report');
		expect(forwardSubject(once)).toBe(once);
	});

	it('falls back for empty subjects', () => {
		expect(forwardSubject('')).toBe('Fwd: (no subject)');
	});

	it('stacks on top of a reply prefix', () => {
		expect(forwardSubject('Re: Hello')).toBe('Fwd: Re: Hello');
	});
});

describe('strippedSubject', () => {
	it('removes reply and forward prefixes regardless of case', () => {
		expect(strippedSubject('Re: Hello')).toBe('Hello');
		expect(strippedSubject('RE: Hello')).toBe('Hello');
		expect(strippedSubject('Fwd: Hello')).toBe('Hello');
		expect(strippedSubject('FW: Hello')).toBe('Hello');
	});

	it('trims surrounding whitespace first', () => {
		expect(strippedSubject('  Re: Hello  ')).toBe('Hello');
	});

	it('leaves a plain subject untouched', () => {
		expect(strippedSubject('Hello there')).toBe('Hello there');
	});

	it('handles a bare prefix', () => {
		expect(strippedSubject('Re:')).toBe('');
		expect(strippedSubject('')).toBe('');
	});
});
