import { beforeAll, describe, it, expect, vi } from 'vitest';
import { domainOf, isPlatformAddress, platformDomains } from './platformDomains.svelte';

vi.mock('$core/api/auth', () => ({
	getPlatformDomains: vi.fn().mockResolvedValue({
		domains: ['temail.org'],
		hosted: ['temail.org', 'Thelemail.com'],
		default: 'temail.org'
	})
}));

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

describe('platformDomains', () => {
	beforeAll(() => platformDomains.load());

	it('hosts the legacy domain without offering it', () => {
		expect(platformDomains.includes('thelemail.com')).toBe(true);
		expect(platformDomains.offers('thelemail.com')).toBe(false);
		expect(platformDomains.includes('temail.org')).toBe(true);
		expect(platformDomains.offers('temail.org')).toBe(true);
	});

	it('treats a legacy address as a platform address', () => {
		expect(platformDomains.isPlatformAddress('anna@thelemail.com')).toBe(true);
		expect(platformDomains.isPlatformAddress('anna@example.com')).toBe(false);
	});

	it('offers only the signup domains', () => {
		expect(platformDomains.list).toEqual(['temail.org']);
		expect(platformDomains.hosted).toEqual(['temail.org', 'thelemail.com']);
		expect(platformDomains.default).toBe('temail.org');
	});
});
