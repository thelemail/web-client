import { beforeEach, describe, expect, it, vi } from 'vitest';

async function fresh() {
	vi.resetModules();
	return import('./signup-session');
}

describe('signupSession', () => {
	beforeEach(() => sessionStorage.clear());

	it('keeps one random value for the whole signup', async () => {
		const { signupSession } = await fresh();
		const first = signupSession();
		expect(first).toMatch(/^[0-9a-f]{32}$/);
		expect(signupSession()).toBe(first);
	});

	it('survives a reload within the tab', async () => {
		const first = (await fresh()).signupSession();
		expect((await fresh()).signupSession()).toBe(first);
	});

	it('starts over once the account is created', async () => {
		const { signupSession, endSignupSession } = await fresh();
		const first = signupSession();
		endSignupSession();
		expect(sessionStorage.getItem('thelemail:signup-session')).toBeNull();
		expect(signupSession()).not.toBe(first);
	});

	it('replaces a tampered stored value', async () => {
		sessionStorage.setItem('thelemail:signup-session', 'not-a-session');
		expect((await fresh()).signupSession()).toMatch(/^[0-9a-f]{32}$/);
	});
});
