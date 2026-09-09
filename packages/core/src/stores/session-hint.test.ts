import { describe, expect, it } from 'vitest';
import { readSessionHint, sessionHintCookie } from './session-hint';

describe('sessionHintCookie', () => {
	it('scopes the flag to the apex so the marketing site can read it', () => {
		expect(sessionHintCookie('app.thelemail.com', true)).toBe(
			'thelemail_session=1; Path=/; SameSite=Lax; Domain=.thelemail.com; Secure; Max-Age=31536000'
		);
		expect(sessionHintCookie('thelemail.com', true)).toContain('Domain=.thelemail.com');
	});

	it('expires the flag when no account is left', () => {
		expect(sessionHintCookie('app.thelemail.com', false)).toContain('Max-Age=0');
	});

	it('stays host-only and insecure on localhost', () => {
		expect(sessionHintCookie('localhost', true)).toBe(
			'thelemail_session=1; Path=/; SameSite=Lax; Max-Age=31536000'
		);
		expect(sessionHintCookie('127.0.0.1', true)).not.toContain('Secure');
	});

	it('writes nothing on origins that do not share the site domain', () => {
		expect(sessionHintCookie('tauri.localhost', true)).toBeNull();
		expect(sessionHintCookie('thelemail.com.evil.test', true)).toBeNull();
	});
});

describe('readSessionHint', () => {
	it('finds the flag among other cookies', () => {
		expect(readSessionHint('thelemail_locale=de; thelemail_session=1')).toBe(true);
		expect(readSessionHint('thelemail_locale=de')).toBe(false);
		expect(readSessionHint('')).toBe(false);
	});
});
