import { describe, expect, it } from 'vitest';
import { domainFromInput } from './input';

describe('domainFromInput', () => {
	it('accepts a bare domain and strips scheme, path and trailing dot', () => {
		expect(domainFromInput(' https://Example.com/x ')).toBe('example.com');
		expect(domainFromInput('mail.example.co.uk.')).toBe('mail.example.co.uk');
	});

	it('converts an international name to ASCII', () => {
		expect(domainFromInput('bücher.de')).toBe('xn--bcher-kva.de');
		expect(domainFromInput('BÜCHER.de')).toBe('xn--bcher-kva.de');
	});

	it('rejects anything that is not a plain host name', () => {
		for (const raw of ['localhost', 'a@b.com', 'example.com:25', 'exa mple.com', '', '   ', '-a.com', 'a..com', 'example.com?x', 'http://']) {
			expect(domainFromInput(raw), raw).toBe('');
		}
	});

	it('rejects IP addresses', () => {
		expect(domainFromInput('192.168.0.1')).toBe('');
		expect(domainFromInput('[::1]')).toBe('');
	});
});
