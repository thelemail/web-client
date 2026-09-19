import { describe, expect, it } from 'vitest';
import { localeCookies, readLocaleCookie } from './cookie';

describe('localeCookies', () => {
	it('shares the choice with the marketing site and drops the host-only copy', () => {
		expect(localeCookies('app.thelemail.com', 'de')).toEqual([
			'thelemail_locale=; Max-Age=0; Path=/; SameSite=Lax',
			'thelemail_locale=de; Max-Age=31536000; Path=/; SameSite=Lax; Domain=.thelemail.com; Secure'
		]);
	});

	it('clears the shared cookie when following the browser again', () => {
		const [, shared] = localeCookies('calendar.thelemail.com', null);
		expect(shared).toContain('Max-Age=0');
		expect(shared).toContain('Domain=.thelemail.com');
	});

	it('stays host-only elsewhere', () => {
		expect(localeCookies('localhost', 'fr')).toEqual([
			'thelemail_locale=fr; Max-Age=31536000; Path=/; SameSite=Lax'
		]);
		expect(localeCookies('thelemail.com.evil.test', 'fr')[0]).not.toContain('Domain');
	});
});

describe('readLocaleCookie', () => {
	it('finds the locale among other cookies', () => {
		expect(readLocaleCookie('a=1; thelemail_locale=pt; thelemail_session=1')).toBe('pt');
	});

	it('ignores an empty or missing value', () => {
		expect(readLocaleCookie('thelemail_locale=')).toBeNull();
		expect(readLocaleCookie('other=de')).toBeNull();
	});
});
