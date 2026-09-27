import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render } from '@testing-library/svelte';
import { m } from '$paraglide/messages.js';
import LoginPage from './+page.svelte';

const login = vi.hoisted(() => {
	class TwoFactorRejectedError extends Error {}
	class TwoFactorExpiredError extends Error {}
	return {
		performLogin: vi.fn(),
		abandonTwoFactorLogin: vi.fn(),
		submitTwoFactorTotp: vi.fn(),
		submitTwoFactorBackupCode: vi.fn(),
		submitTwoFactorWebauthn: vi.fn(),
		TwoFactorRejectedError,
		TwoFactorExpiredError
	};
});
vi.mock('$core/auth/perform-login', () => login);

const nav = vi.hoisted(() => ({ goto: vi.fn() }));
vi.mock('$app/navigation', () => nav);
vi.mock('$app/state', () => ({ page: { params: {}, url: new URL('http://localhost/login') } }));
vi.mock('$core/stores/auth.svelte', () => ({ auth: { email: null } }));
vi.mock('$core/stores/accounts.svelte', () => ({ accounts: { bySlot: () => undefined } }));

const OPERATION = 'op-1';
let pending: {
	pendingToken: string;
	methods: string[];
	email: string;
	rememberMe: boolean;
	expiresAt: number;
	opaqueOperationId: string;
};

function button(label: string) {
	return [...document.querySelectorAll('button')].find((b) => b.textContent?.trim() === label);
}

async function reachTwoFactor() {
	await fireEvent.input(document.querySelector('#login-email')!, { target: { value: 'r@thelemail.com' } });
	await fireEvent.input(document.querySelector('input[type="password"]')!, { target: { value: 'hunter22' } });
	await fireEvent.keyDown(document.querySelector('#login-email')!, { key: 'Enter' });
	await vi.waitFor(() => expect(document.querySelector('#otp-0')).not.toBeNull());
}

async function submitCode() {
	for (let i = 0; i < 6; i++) {
		await fireEvent.input(document.querySelector(`#otp-${i}`)!, { target: { value: String(i + 1) } });
	}
	await fireEvent.click(button(m.auth_2fa_verify_code())!);
}

beforeEach(() => {
	for (const fn of [
		login.performLogin,
		login.abandonTwoFactorLogin,
		login.submitTwoFactorTotp,
		nav.goto
	]) {
		fn.mockReset();
	}
	pending = {
		pendingToken: 'pt-1',
		methods: ['totp'],
		email: 'r@thelemail.com',
		rememberMe: false,
		expiresAt: Date.now() + 5 * 60 * 1000,
		opaqueOperationId: OPERATION
	};
	login.performLogin.mockImplementation(async () => ({ status: 'twoFactorRequired', pending }));
	login.abandonTwoFactorLogin.mockResolvedValue(undefined);
});

afterEach(() => {
	cleanup();
	vi.useRealTimers();
});

describe('login page two-factor step', () => {
	it('abandons the pending OPAQUE operation when backing out', async () => {
		render(LoginPage);
		await reachTwoFactor();

		await fireEvent.click(button(m.auth_2fa_back_to_sign_in())!);

		await vi.waitFor(() => expect(document.querySelector('#otp-0')).toBeNull());
		expect(login.abandonTwoFactorLogin).toHaveBeenCalledTimes(1);
		expect(login.abandonTwoFactorLogin).toHaveBeenCalledWith(pending);
		expect(login.abandonTwoFactorLogin.mock.calls[0][0].opaqueOperationId).toBe(OPERATION);
	});

	it('abandons the operation once the challenge expires', async () => {
		vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout', 'Date'] });
		render(LoginPage);
		await reachTwoFactor();
		expect(login.abandonTwoFactorLogin).not.toHaveBeenCalled();

		await vi.advanceTimersByTimeAsync(5 * 60 * 1000 + 1);

		expect(login.abandonTwoFactorLogin).toHaveBeenCalledWith(pending);
		await vi.waitFor(() => expect(document.body.textContent).toContain(m.auth_login_2fa_expired()));
	});

	it('abandons the operation after too many rejected codes', async () => {
		login.submitTwoFactorTotp.mockRejectedValue(new login.TwoFactorRejectedError());
		render(LoginPage);
		await reachTwoFactor();

		for (let attempt = 1; attempt < 5; attempt++) {
			await submitCode();
			await vi.waitFor(() => expect(login.submitTwoFactorTotp).toHaveBeenCalledTimes(attempt));
			await vi.waitFor(() => expect(document.querySelector<HTMLInputElement>('#otp-0')!.disabled).toBe(false));
		}
		expect(login.abandonTwoFactorLogin).not.toHaveBeenCalled();

		await submitCode();

		await vi.waitFor(() => expect(login.abandonTwoFactorLogin).toHaveBeenCalledWith(pending));
		await vi.waitFor(() => expect(document.body.textContent).toContain(m.auth_login_2fa_expired()));
	});

	it('abandons the operation when the server says the challenge is gone', async () => {
		login.submitTwoFactorTotp.mockRejectedValue(new login.TwoFactorExpiredError());
		render(LoginPage);
		await reachTwoFactor();

		await submitCode();

		await vi.waitFor(() => expect(login.abandonTwoFactorLogin).toHaveBeenCalledWith(pending));
	});

	it('abandons the operation when the page is torn down mid-challenge', async () => {
		const { unmount } = render(LoginPage);
		await reachTwoFactor();

		unmount();

		expect(login.abandonTwoFactorLogin).toHaveBeenCalledTimes(1);
		expect(login.abandonTwoFactorLogin).toHaveBeenCalledWith(pending);
	});

	it('abandons the operation when the tab is hidden for navigation', async () => {
		render(LoginPage);
		await reachTwoFactor();

		window.dispatchEvent(new Event('pagehide'));

		await vi.waitFor(() => expect(login.abandonTwoFactorLogin).toHaveBeenCalledWith(pending));
		await vi.waitFor(() => expect(document.querySelector('#otp-0')).toBeNull());
	});

	it('leaves a completed login alone on the way out', async () => {
		login.submitTwoFactorTotp.mockResolvedValue({ slot: 0 });
		const { unmount } = render(LoginPage);
		await reachTwoFactor();

		await submitCode();
		await vi.waitFor(() => expect(nav.goto).toHaveBeenCalled());
		unmount();

		expect(login.abandonTwoFactorLogin).not.toHaveBeenCalled();
	});
});
