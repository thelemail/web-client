import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render } from '@testing-library/svelte';
import PasskeyPage from './+page.svelte';

const webauthn = vi.hoisted(() => ({
	getAssertion: vi.fn(),
	webauthnSupported: vi.fn(() => true),
	webauthnFailure: vi.fn(() => 'notAllowed'),
	webauthnFailureMessage: vi.fn(() => 'The browser closed the request.')
}));
vi.mock('$core/auth/webauthn', () => webauthn);

const nav = vi.hoisted(() => ({ replaceState: vi.fn() }));
vi.mock('$app/navigation', () => nav);

const state = vi.hoisted(() => ({ page: { url: new URL('https://app.test/migrator/passkey') } }));
vi.mock('$app/state', () => state);

const STATE = 'A'.repeat(43);
const OPTIONS = { challenge: 'Y2hhbGxlbmdl', rpId: 'thelemail.test', allowCredentials: [] };
const ACCOUNT = 'ada@thelemail.test';
const CODE = 'AKTC-EUFO';

function encode(value: unknown) {
	return btoa(JSON.stringify(value)).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

function decode(value: string) {
	return JSON.parse(atob(value.replace(/-/g, '+').replace(/_/g, '/')));
}

function request() {
	return `port=49152&state=${STATE}&account=${encodeURIComponent(ACCOUNT)}&options=${encode(OPTIONS)}`;
}

async function ready() {
	await vi.waitFor(() => expect(text()).toContain(CODE));
}

function open(hash: string) {
	state.page.url = new URL(`https://app.test/migrator/passkey#${hash}`);
	render(PasskeyPage);
}

function text() {
	return document.body.textContent ?? '';
}

function button(label: string) {
	return [...document.querySelectorAll('button')].find((b) => b.textContent?.trim() === label);
}

const replace = vi.fn();

beforeEach(() => {
	webauthn.getAssertion.mockReset();
	webauthn.webauthnSupported.mockReturnValue(true);
	nav.replaceState.mockReset();
	replace.mockReset();
	vi.stubGlobal('location', { ...window.location, replace });
});

afterEach(() => {
	cleanup();
	vi.unstubAllGlobals();
});

describe('migrator passkey page', () => {
	it('explains itself when opened without a request', () => {
		open('');
		expect(text()).toContain('This page can’t be used on its own');
		expect(document.querySelector('button')).toBeNull();
	});

	it('rejects a malformed state or port', () => {
		open(`port=0&state=${STATE}&account=${encodeURIComponent(ACCOUNT)}&options=${encode(OPTIONS)}`);
		expect(text()).toContain('This page can’t be used on its own');
		cleanup();
		open(`port=49152&state=short&account=${encodeURIComponent(ACCOUNT)}&options=${encode(OPTIONS)}`);
		expect(text()).toContain('This page can’t be used on its own');
		cleanup();
		open(`port=49152&state=${STATE}&options=${encode(OPTIONS)}`);
		expect(text()).toContain('This page can’t be used on its own');
	});

	it('runs the passkey and hands the assertion back to the local Migrator port', async () => {
		const assertion = { id: 'cred', rawId: 'cred', type: 'public-key', response: { clientDataJSON: 'x' } };
		webauthn.getAssertion.mockResolvedValue(assertion);
		open(request());
		expect(nav.replaceState).toHaveBeenCalledWith('/migrator/passkey', {});
		expect(webauthn.getAssertion).not.toHaveBeenCalled();
		await ready();

		await fireEvent.click(button('Use passkey')!);

		await vi.waitFor(() => expect(replace).toHaveBeenCalledTimes(1));
		expect(webauthn.getAssertion).toHaveBeenCalledWith(OPTIONS);
		const target = new URL(replace.mock.calls[0][0]);
		expect(target.origin).toBe('http://127.0.0.1:49152');
		expect(target.pathname).toBe('/migrator/passkey/result');
		expect(target.searchParams.get('state')).toBe(STATE);
		expect(decode(target.searchParams.get('credential')!)).toEqual(assertion);
	});

	it('keeps the request open after a dismissed prompt', async () => {
		webauthn.getAssertion.mockRejectedValue(new DOMException('dismissed', 'NotAllowedError'));
		open(request());
		await ready();
		await fireEvent.click(button('Use passkey')!);

		await vi.waitFor(() => expect(text()).toContain('The browser closed the request.'));
		expect(replace).not.toHaveBeenCalled();
		expect(button('Try again')).toBeDefined();
	});

	it('shows the account and the code Migrator shows before using the passkey', async () => {
		open(request());
		expect(button('Use passkey')?.disabled).toBe(true);
		await ready();
		expect(text()).toContain(`Signing in as ${ACCOUNT}`);
		expect(text()).toContain('Continue only if it matches');
		expect(button('Use passkey')?.disabled).toBe(false);
	});

	it('cancels back to Migrator', async () => {
		open(request());
		await fireEvent.click(button('Choose another method')!);

		const target = new URL(replace.mock.calls[0][0]);
		expect(target.searchParams.get('cancel')).toBe('1');
		expect(target.searchParams.get('state')).toBe(STATE);
		expect(target.searchParams.has('credential')).toBe(false);
	});

	it('offers only cancel when the browser has no WebAuthn', () => {
		webauthn.webauthnSupported.mockReturnValue(false);
		open(request());
		expect(text()).toContain('This browser can’t use passkeys');
		expect(button('Use passkey')).toBeUndefined();
		expect(button('Choose another method')).toBeDefined();
	});

	it.each([
		['ok', 'Passkey confirmed'],
		['failed', 'Verification didn’t go through'],
		['cancelled', 'Verification cancelled']
	])('shows the %s result Migrator redirects to', (done, title) => {
		open(`done=${done}`);
		expect(text()).toContain(title);
		expect(document.querySelector('button')).toBeNull();
	});
});
