import { describe, expect, it } from 'vitest';
import { resolveReturnTo } from './return-to';

describe('resolveReturnTo', () => {
	it('falls back to the inbox without a redirect', () => {
		expect(resolveReturnTo(null, 0)).toBe('/u/0/mail/inbox');
		expect(resolveReturnTo('', 2)).toBe('/u/2/mail/inbox');
	});

	it('rewrites a foreign slot to the one just signed in', () => {
		expect(resolveReturnTo('/u/4/mail/inbox/abc', 0)).toBe('/u/0/mail/inbox/abc');
		expect(resolveReturnTo('/u/12/settings/profile', 3)).toBe('/u/3/settings/profile');
	});

	it('keeps the query string', () => {
		expect(resolveReturnTo('/u/4/mail/inbox?q=hi', 1)).toBe('/u/1/mail/inbox?q=hi');
	});

	it('keeps an invite path as it is', () => {
		expect(resolveReturnTo('/invite/tok3n', 0)).toBe('/invite/tok3n');
	});

	it('sends a bare account root to the inbox', () => {
		expect(resolveReturnTo('/u/4', 0)).toBe('/u/0/mail/inbox');
	});

	it('refuses a target that would loop back to an auth screen', () => {
		expect(resolveReturnTo('/', 0)).toBe('/u/0/mail/inbox');
		expect(resolveReturnTo('/login', 0)).toBe('/u/0/mail/inbox');
		expect(resolveReturnTo('/register?plan=pro', 1)).toBe('/u/1/mail/inbox');
	});

	it('refuses anything that could leave the origin', () => {
		expect(resolveReturnTo('//evil.example/x', 0)).toBe('/u/0/mail/inbox');
		expect(resolveReturnTo('/\\evil.example/x', 0)).toBe('/u/0/mail/inbox');
		expect(resolveReturnTo('https://evil.example', 0)).toBe('/u/0/mail/inbox');
		expect(resolveReturnTo('u/4/mail/inbox', 0)).toBe('/u/0/mail/inbox');
		expect(resolveReturnTo('/invite/a/../../evil', 0)).toBe('/u/0/mail/inbox');
	});
});
