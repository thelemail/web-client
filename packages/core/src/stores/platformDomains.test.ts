import { describe, it, expect } from 'vitest';
import { domainOf, isPlatformAddress } from './platformDomains.svelte';

const DOMAINS = ['temail.org', 'thelemail.com'];

describe('isPlatformAddress', () => {
	it('accepts every platform domain in any case', () => {
		expect(isPlatformAddress('anna@temail.org', DOMAINS)).toBe(true);
		expect(isPlatformAddress('Anna@TEmail.ORG', DOMAINS)).toBe(true);
		expect(isPlatformAddress('anna@thelemail.com', DOMAINS)).toBe(true);
		expect(isPlatformAddress('Anna@Thelemail.COM', DOMAINS)).toBe(true);
	});

	it('rejects anything else', () => {
		expect(isPlatformAddress('anna@example.com', DOMAINS)).toBe(false);
		expect(isPlatformAddress('anna@sub.temail.org', DOMAINS)).toBe(false);
		expect(isPlatformAddress('anna@sub.thelemail.com', DOMAINS)).toBe(false);
		expect(isPlatformAddress('anna@temail.org', [])).toBe(false);
		expect(isPlatformAddress('anna', DOMAINS)).toBe(false);
		expect(isPlatformAddress('', DOMAINS)).toBe(false);
	});
});

describe('domainOf', () => {
	it('lowercases the part after the last @', () => {
		expect(domainOf('a@b@TEmail.org')).toBe('temail.org');
		expect(domainOf('nobody')).toBe('');
	});
});
