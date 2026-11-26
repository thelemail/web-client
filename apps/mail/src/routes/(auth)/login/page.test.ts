import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render } from '@testing-library/svelte';
import { m } from '$paraglide/messages.js';
import { ApiCallError, type ErrorCode } from '$core/api/types';
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
const route = vi.hoisted(() => ({ page: { params: {}, url: new URL('http://localhost/login') } }));
vi.mock('$app/state', () => route);
const session = vi.hoisted(() => ({
	auth: { email: null, loadProfile: vi.fn(async () => undefined), mailOnlyFor: vi.fn(() => false), authOriginEnrolledFor: vi.fn(() => false) }
}));
vi.mock('$core/stores/session.svelte', () => session);
const vault = vi.hoisted(() => ({
	keystore: {
		lock: vi.fn(async () => undefined),
		status: vi.fn(async () => ({ accounts: [] as { accountId: string; unlocked: boolean }[] }))
	}
}));
vi.mock('$core/keystore/keystore-client', () => vault);
const known = vi.hoisted(() => ({
	bySlot: vi.fn(),
	byId: vi.fn((id: string) => (id === 'acc-open' ? { accountId: 'acc-open', slot: 0, email: 'ivy@thelemail.com' } : id === 'acc-locked' ? { accountId: 'acc-locked', slot: 1, email: 'hal@thelemail.com' } : null) as { accountId: string; slot: number; email: string } | null),
	refresh: vi.fn(async () => undefined),
	list: [] as { accountId: string }[]
}));
vi.mock('$core/stores/accounts.svelte', () => ({ accounts: known }));
const custody = vi.hoisted(() => ({
	mailOnlyAccountId: vi.fn(async (_target: { slot?: number | null; identifier?: string }) => null as string | null),
	unlockAtAuth: vi.fn((_accountId: string, _redirect: string | null) => new Promise<never>(() => {})),
	signInMovedToAuth: vi.fn(async () => false),
	signInAtAuth: vi.fn((_redirect: string | null) => new Promise<never>(() => {}))
}));
vi.mock('$core/custody/unlock', () => custody);
const tab = vi.hoisted(() => {
	let listener: ((r: { accountId: string; path: string }) => void) | null = null;
	return {
		openAuthTab: vi.fn((_accountId: string | null, _route: string) => true),
		authTabPendingFor: vi.fn((_accountId: string | null) => false),
		awaitAuthTab: vi.fn((_accountId: string | null, done: (r: { accountId: string; path: string }) => void) => {
			listener = done;
			return () => {
				listener = null;
			};
		}),
		arrive: (r: { accountId: string; path: string; email?: string }) => listener?.(r)
	};
});
vi.mock('$core/producthandoff/tab', () => tab);
const transition = vi.hoisted(() => ({ announceArrival: vi.fn() }));
vi.mock('$core/stores/accountTransition.svelte', () => ({
	accountTransition: { run: async (_k: string, _a: string | null, work: () => Promise<void>) => work(), announceArrival: transition.announceArrival }
}));

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

function plain(text: string) {
	return text.replace(/<[^>]+>/g, '');
}

function changeEmail() {
	return document.querySelector<HTMLButtonElement>('.field .lab button.aux');
}

async function enterEmail(value = 'r@thelemail.com') {
	await vi.waitFor(() => expect(document.querySelector('#login-email')).not.toBeNull());
	await fireEvent.input(document.querySelector('#login-email')!, { target: { value } });
	await fireEvent.submit(document.querySelector('form')!);
}

async function submitCredentials(email = 'r@thelemail.com') {
	await enterEmail(email);
	await fireEvent.input(document.querySelector('input[type="password"]')!, { target: { value: 'hunter22' } });
	await fireEvent.submit(document.querySelector('form')!);
}

async function reachTwoFactor() {
	await submitCredentials();
	await vi.waitFor(() => expect(document.querySelector('#twofa-code')).not.toBeNull());
}

function rejection(status: number, code: ErrorCode) {
	return new ApiCallError(status, { error: { code, message: code } }, code);
}

async function submitCode() {
	await fireEvent.input(document.querySelector('#twofa-code')!, { target: { value: '123456' } });
	await fireEvent.click(button(m.auth_2fa_verify_code())!);
}

beforeEach(() => {
	for (const fn of [
		login.performLogin,
		login.abandonTwoFactorLogin,
		login.submitTwoFactorTotp,
		nav.goto,
		known.bySlot
	]) {
		fn.mockReset();
	}
	route.page.url = new URL('http://localhost/login');
	custody.mailOnlyAccountId.mockReset();
	custody.mailOnlyAccountId.mockResolvedValue(null);
	custody.unlockAtAuth.mockReset();
	custody.unlockAtAuth.mockImplementation(() => new Promise<never>(() => {}));
	custody.signInMovedToAuth.mockReset();
	custody.signInMovedToAuth.mockResolvedValue(false);
	custody.signInAtAuth.mockReset();
	custody.signInAtAuth.mockImplementation(() => new Promise<never>(() => {}));
	session.auth.mailOnlyFor.mockReset();
	session.auth.mailOnlyFor.mockReturnValue(false);
	session.auth.authOriginEnrolledFor.mockReset();
	session.auth.authOriginEnrolledFor.mockReturnValue(false);
	vault.keystore.lock.mockClear();
	vault.keystore.status.mockReset();
	vault.keystore.status.mockResolvedValue({ accounts: [] });
	tab.openAuthTab.mockClear();
	tab.authTabPendingFor.mockReset();
	tab.authTabPendingFor.mockReturnValue(false);
	tab.awaitAuthTab.mockClear();
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

		await vi.waitFor(() => expect(document.querySelector('#twofa-code')).toBeNull());
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
			await vi.waitFor(() => expect(document.querySelector<HTMLInputElement>('#twofa-code')!.disabled).toBe(false));
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
		await vi.waitFor(() => expect(document.querySelector('#twofa-code')).toBeNull());
	});

	it('leaves a completed login alone on the way out', async () => {
		login.submitTwoFactorTotp.mockResolvedValue({ status: 'complete', result: { accountId: 'acct', slot: 0 } });
		const { unmount } = render(LoginPage);
		await reachTwoFactor();

		await submitCode();
		await vi.waitFor(() => expect(nav.goto).toHaveBeenCalled());
		unmount();

		expect(login.abandonTwoFactorLogin).not.toHaveBeenCalled();
	});
});

describe('login page errors and proof of work', () => {
	it.each([
		[429, 'rate_limited', () => m.auth_login_rate_limited()],
		[503, 'server_busy', () => m.auth_login_busy()],
		[422, 'proof_required', () => m.auth_proof_failed()],
		[422, 'proof_invalid', () => m.auth_proof_failed()],
		[401, 'invalid_credentials', () => m.auth_login_wrong_credentials()]
	] as const)('shows a plain message for HTTP %s %s', async (status, code, message) => {
		login.performLogin.mockRejectedValue(rejection(status, code));
		render(LoginPage);

		await submitCredentials();

		await vi.waitFor(() => expect(document.querySelector('#login-err')?.textContent?.trim()).toBe(message()));
		expect(document.body.textContent).not.toContain('HTTP');
	});

	it('says it is checking the browser while the proof is solved', async () => {
		let finishSolve!: () => void;
		login.performLogin.mockImplementation(
			async ({ onVerifying }: { onVerifying: (active: boolean) => void }) => {
				onVerifying(true);
				await new Promise<void>((resolve) => (finishSolve = resolve));
				onVerifying(false);
				return { status: 'twoFactorRequired', pending };
			}
		);
		render(LoginPage);

		await submitCredentials();

		await vi.waitFor(() => expect(button(m.auth_login_verifying())).toBeDefined());
		finishSolve();
		await vi.waitFor(() => expect(document.querySelector('#twofa-code')).not.toBeNull());
	});

	it('aborts a running solve when the page goes away', async () => {
		let signal!: AbortSignal;
		login.performLogin.mockImplementation(async (input: { signal: AbortSignal }) => {
			signal = input.signal;
			return new Promise(() => {});
		});
		const { unmount } = render(LoginPage);

		await submitCredentials();
		await vi.waitFor(() => expect(signal).toBeDefined());
		unmount();

		expect(signal.aborted).toBe(true);
	});
});

describe('login page identifier step', () => {
	it('moves to the password step without touching the network', async () => {
		const fetchSpy = vi.spyOn(globalThis, 'fetch');
		render(LoginPage);

		await enterEmail('nobody-here@example.org');

		expect(document.querySelector('#login-email')).toBeNull();
		expect(document.querySelector<HTMLInputElement>('#login-identifier')!.value).toBe('nobody-here@example.org');
		expect(fetchSpy).not.toHaveBeenCalled();
		expect(login.performLogin).not.toHaveBeenCalled();
		fetchSpy.mockRestore();
	});

	it('renders the same password step for any address', async () => {
		const markup = (address: string) =>
			document
				.querySelector('.card-surface')!
				.innerHTML.replaceAll('<wbr>', '')
				.replaceAll(encodeURIComponent(address), 'ADDR')
				.replaceAll(address, 'ADDR')
				.replace(/"c\d+"/g, '"ID"');
		render(LoginPage);
		await enterEmail('r@thelemail.com');
		const first = markup('r@thelemail.com');
		cleanup();

		render(LoginPage);
		await enterEmail('ghost@nowhere.example');
		const second = markup('ghost@nowhere.example');

		expect(second).toBe(first);
	});

	it('flags a malformed address and stays on the email step', async () => {
		render(LoginPage);

		await enterEmail('not-an-address');

		expect(document.querySelector('#login-email')).not.toBeNull();
		expect(document.querySelector('#login-email-err')?.textContent?.trim()).toBe(m.auth_login_email_invalid());
		expect(document.querySelector('#login-email')!.getAttribute('aria-invalid')).toBe('true');
	});

	it('pairs the address with the password for password managers', async () => {
		render(LoginPage);

		await enterEmail();

		const username = document.querySelector<HTMLInputElement>('#login-identifier')!;
		const password = document.querySelector<HTMLInputElement>('input[type="password"]')!;
		expect(username.readOnly).toBe(true);
		expect(username.autocomplete).toBe('username');
		expect(password.autocomplete).toBe('current-password');
		expect(username.form).toBe(password.form);
		expect(document.activeElement).toBe(password);
	});

	it('signs in with the address committed on the first step', async () => {
		render(LoginPage);

		await submitCredentials('  r@thelemail.com ');

		await vi.waitFor(() => expect(login.performLogin).toHaveBeenCalledTimes(1));
		expect(login.performLogin.mock.calls[0][0]).toMatchObject({ email: 'r@thelemail.com', password: 'hunter22' });
	});

	it('clears the password when the email is changed', async () => {
		render(LoginPage);
		await enterEmail();
		await fireEvent.input(document.querySelector('input[type="password"]')!, { target: { value: 'hunter22' } });

		await fireEvent.click(changeEmail()!);

		const email = document.querySelector<HTMLInputElement>('#login-email')!;
		expect(email.value).toBe('r@thelemail.com');
		expect(document.activeElement).toBe(email);
		await fireEvent.submit(document.querySelector('form')!);
		expect(document.querySelector<HTMLInputElement>('input[type="password"]')!.value).toBe('');
	});

	it('does not let the email change while an attempt is running', async () => {
		login.performLogin.mockImplementation(() => new Promise(() => {}));
		render(LoginPage);

		await submitCredentials();

		await vi.waitFor(() => expect(changeEmail()!.disabled).toBe(true));
		await fireEvent.click(changeEmail()!);
		expect(document.querySelector('#login-email')).toBeNull();
	});

	it('abandons a two-factor step that lands after the page went away', async () => {
		let land!: () => void;
		login.performLogin.mockImplementation(
			() => new Promise((resolve) => (land = () => resolve({ status: 'twoFactorRequired', pending })))
		);
		const { unmount } = render(LoginPage);
		await submitCredentials();
		await vi.waitFor(() => expect(land).toBeDefined());

		unmount();
		land();

		await vi.waitFor(() => expect(login.abandonTwoFactorLogin).toHaveBeenCalledWith(pending));
	});

	it('opens straight on the password step to sign a known account back in', async () => {
		route.page.url = new URL('http://localhost/login?slot=2');
		known.bySlot.mockImplementation((slot: number) => (slot === 2 ? { email: 'kept@thelemail.com' } : undefined));

		render(LoginPage);

		await vi.waitFor(() => expect(document.querySelector('#login-identifier')).not.toBeNull());
		expect(custody.mailOnlyAccountId).toHaveBeenCalledWith({ slot: 2 });
		expect(document.querySelector('#login-email')).toBeNull();
		expect(document.querySelector<HTMLInputElement>('#login-identifier')!.value).toBe('kept@thelemail.com');
		expect(document.querySelector('#login-password')).not.toBeNull();
		expect(document.body.textContent).toContain('Unlock');
		expect(custody.unlockAtAuth).not.toHaveBeenCalled();
	});

	it('sends a locked mail-only account to the account origin without asking for a password', async () => {
		route.page.url = new URL('http://localhost/login?slot=2&redirect=%2Fu%2F2%2Fmail%2Finbox');
		known.bySlot.mockImplementation((slot: number) => (slot === 2 ? { email: 'kept@thelemail.com' } : undefined));
		custody.mailOnlyAccountId.mockResolvedValue('acc-mail-only');

		render(LoginPage);

		await vi.waitFor(() => expect(custody.unlockAtAuth).toHaveBeenCalledWith('acc-mail-only', '/u/2/mail/inbox'));
		expect(document.querySelector('input[type="password"]')).toBeNull();
		expect(document.querySelector('#login-identifier')).toBeNull();
		expect(document.querySelector('#login-email')).toBeNull();
		expect(document.body.textContent).toContain(m.handoff_opening());
		expect(login.performLogin).not.toHaveBeenCalled();
	});

	it('sends a mail-only account to the account origin when its address is typed', async () => {
		custody.mailOnlyAccountId.mockImplementation(async (target: { identifier?: string }) => (target.identifier === 'r@thelemail.com' ? 'acc-mail-only' : null));

		render(LoginPage);
		await enterEmail('r@thelemail.com');

		await vi.waitFor(() => expect(custody.unlockAtAuth).toHaveBeenCalledWith('acc-mail-only', null));
		expect(document.querySelector('input[type="password"]')).toBeNull();
		expect(login.performLogin).not.toHaveBeenCalled();
	});

	it('says so when the account origin cannot be opened', async () => {
		route.page.url = new URL('http://localhost/login?slot=2');
		known.bySlot.mockImplementation((slot: number) => (slot === 2 ? { email: 'kept@thelemail.com' } : undefined));
		custody.mailOnlyAccountId.mockResolvedValue('acc-mail-only');
		custody.unlockAtAuth.mockRejectedValue(new Error('offline'));

		render(LoginPage);

		await vi.waitFor(() => expect(document.body.textContent).toContain(m.handoff_failed()));
		expect(document.querySelector('input[type="password"]')).toBeNull();
	});

	it('starts adding an account on an empty email step', async () => {
		route.page.url = new URL('http://localhost/login?addAccount=1');

		render(LoginPage);

		await vi.waitFor(() => expect(document.querySelector('#login-email')).not.toBeNull());
		expect(document.querySelector<HTMLInputElement>('#login-email')!.value).toBe('');
		expect(document.body.textContent).toContain(m.auth_s_add_note());
	});

	it('keeps the password in place while the mailbox opens', async () => {
		login.performLogin.mockResolvedValue({ status: 'complete', result: { slot: 0 } });
		const leaving = Promise.withResolvers<void>();
		nav.goto.mockReturnValue(leaving.promise);
		render(LoginPage);

		await submitCredentials();
		await vi.waitFor(() => expect(nav.goto).toHaveBeenCalled());

		expect(document.querySelector<HTMLInputElement>('input[type="password"]')?.value).toBe('hunter22');
		leaving.resolve();
	});

	it('says it is signed in while the mailbox opens', async () => {
		login.performLogin.mockResolvedValue({ status: 'complete', result: { slot: 0 } });
		const leaving = Promise.withResolvers<void>();
		nav.goto.mockReturnValue(leaving.promise);
		render(LoginPage);

		await submitCredentials();
		await vi.waitFor(() => expect(nav.goto).toHaveBeenCalled());

		expect(document.querySelector('.af-status[data-tone="ok"]')?.textContent).toContain(m.auth_login_signed_in());
		expect(document.querySelector('#login-err')).toBeNull();
		leaving.resolve();
	});

	it('drops the signed-in line when the mailbox cannot open', async () => {
		login.performLogin.mockResolvedValue({ status: 'complete', result: { slot: 0 } });
		nav.goto.mockRejectedValue(new Error('navigation failed'));
		render(LoginPage);

		await submitCredentials();
		await vi.waitFor(() => expect(document.querySelector('#login-err')?.textContent).toContain('navigation failed'));
		expect(document.querySelector('.af-status[data-tone="ok"]')).toBeNull();
	});
});

describe('login page account origin', () => {
	it('hands every sign-in to the account origin once the switch is on', async () => {
		route.page.url = new URL('http://localhost/login?redirect=%2Fu%2F0%2Fmail%2Finbox');
		custody.signInMovedToAuth.mockResolvedValue(true);
		render(LoginPage);

		await vi.waitFor(() => expect(custody.signInAtAuth).toHaveBeenCalledWith('/u/0/mail/inbox'));
		expect(document.querySelector('#login-email')).toBeNull();
		expect(login.performLogin).not.toHaveBeenCalled();
	});

	it('asks the account origin for the same account when a known slot reloads after the switch', async () => {
		route.page.url = new URL('http://localhost/login?slot=1&redirect=%2Fu%2F1%2Fmail%2Finbox');
		known.bySlot.mockImplementation((slot: number) => (slot === 1 ? { accountId: 'acc-legacy', email: 'nora@thelemail.com' } : undefined));
		custody.signInMovedToAuth.mockResolvedValue(true);
		render(LoginPage);

		await vi.waitFor(() => expect(custody.unlockAtAuth).toHaveBeenCalledWith('acc-legacy', '/u/1/mail/inbox'));
		expect(custody.signInAtAuth).not.toHaveBeenCalled();
		expect(document.querySelector('#login-email')).toBeNull();
	});

	it('locks a product-key account after a password sign-in and opens it at the account origin', async () => {
		login.performLogin.mockResolvedValue({ status: 'complete', result: { slot: 0 } });
		known.bySlot.mockImplementation((slot: number) => (slot === 0 ? { accountId: 'acc-converted', email: 'r@thelemail.com' } : undefined));
		session.auth.mailOnlyFor.mockReturnValue(true);
		session.auth.authOriginEnrolledFor.mockReturnValue(true);
		render(LoginPage);

		await submitCredentials();

		await vi.waitFor(() => expect(custody.unlockAtAuth).toHaveBeenCalledWith('acc-converted', null));
		expect(vault.keystore.lock).toHaveBeenCalledWith({ accountId: 'acc-converted' });
		expect(nav.goto).not.toHaveBeenCalled();
	});

	it('opens the mailbox for an account still on the old keys', async () => {
		login.performLogin.mockResolvedValue({ status: 'complete', result: { slot: 0 } });
		known.bySlot.mockImplementation((slot: number) => (slot === 0 ? { accountId: 'acc-legacy', email: 'r@thelemail.com' } : undefined));
		render(LoginPage);

		await submitCredentials();

		await vi.waitFor(() => expect(nav.goto).toHaveBeenCalled());
		expect(vault.keystore.lock).not.toHaveBeenCalled();
		expect(custody.unlockAtAuth).not.toHaveBeenCalled();
	});
});

describe('login page with another account open', () => {
	beforeEach(() => {
		route.page.url = new URL('http://localhost/login?slot=1&redirect=%2Fu%2F1%2Fmail%2Finbox');
		custody.mailOnlyAccountId.mockResolvedValue('acc-locked');
		vault.keystore.status.mockResolvedValue({ accounts: [{ accountId: 'acc-open', unlocked: true }, { accountId: 'acc-locked', unlocked: false }] });
	});

	it('waits for the sign-in tab the switcher opened and never leaves this page', async () => {
		tab.authTabPendingFor.mockReturnValue(true);
		render(LoginPage);

		await vi.waitFor(() => expect(document.body.textContent).toContain(plain(m.handoff_tab_waiting_sentence())));
		expect(document.body.textContent).toContain('hal@thelemail.com');
		expect(document.body.textContent).toContain(m.handoff_tab_waiting_line());
		expect(custody.unlockAtAuth).not.toHaveBeenCalled();
		expect(tab.awaitAuthTab).toHaveBeenCalledWith('acc-locked', expect.any(Function));

		tab.arrive({ accountId: 'acc-locked', path: '/u/1/mail/inbox' });
		await vi.waitFor(() => expect(nav.goto).toHaveBeenCalledWith('/u/1/mail/inbox', { replace: true }));
		expect(known.refresh).toHaveBeenCalled();
		await vi.waitFor(() => expect(transition.announceArrival).toHaveBeenCalledWith('hal@thelemail.com'));
	});

	it('asks before opening a tab when none could be opened from the switcher', async () => {
		render(LoginPage);

		await vi.waitFor(() => expect(button(m.handoff_tab_open())).toBeDefined());
		expect(document.body.textContent).toContain('To unlock hal@thelemail.com, open the sign-in tab.');
		await fireEvent.click(button(m.handoff_tab_open())!);

		expect(tab.openAuthTab).toHaveBeenCalledWith('acc-locked', '/u/1/mail/inbox');
		await vi.waitFor(() => expect(document.body.textContent).toContain('hal@thelemail.com is waiting for you in the sign-in tab.'));
		expect(custody.unlockAtAuth).not.toHaveBeenCalled();
	});

	it('signs in in this tab when asked to', async () => {
		render(LoginPage);

		await vi.waitFor(() => expect(button(m.handoff_tab_here())).toBeDefined());
		await fireEvent.click(button(m.handoff_tab_here())!);

		await vi.waitFor(() => expect(custody.unlockAtAuth).toHaveBeenCalledWith('acc-locked', '/u/1/mail/inbox'));
		expect(tab.openAuthTab).not.toHaveBeenCalled();
	});

	it('offers the way back to the account that is still open', async () => {
		render(LoginPage);

		await vi.waitFor(() => expect(document.querySelector('a[href="/u/0/mail/inbox"]')).not.toBeNull());
	});

	it('adds a new account in a tab so the open account keeps its keys', async () => {
		route.page.url = new URL('http://localhost/login?addAccount=1');
		custody.signInMovedToAuth.mockResolvedValue(true);
		tab.authTabPendingFor.mockImplementation((id: string | null) => id === null);
		render(LoginPage);

		await vi.waitFor(() => expect(document.body.textContent).toContain(m.handoff_tab_waiting_new()));
		expect(custody.signInAtAuth).not.toHaveBeenCalled();
		expect(tab.awaitAuthTab).toHaveBeenCalledWith(null, expect.any(Function));
		tab.arrive({ accountId: 'acc-new', path: '/u/2/mail/inbox', email: 'kit@thelemail.com' });
		await vi.waitFor(() => expect(nav.goto).toHaveBeenCalledWith('/u/2/mail/inbox', { replace: true }));
		await vi.waitFor(() => expect(transition.announceArrival).toHaveBeenCalledWith('kit@thelemail.com'));
	});

	it('goes to the account origin in this tab when no other account is open', async () => {
		vault.keystore.status.mockResolvedValue({ accounts: [{ accountId: 'acc-locked', unlocked: false }] });
		render(LoginPage);

		await vi.waitFor(() => expect(custody.unlockAtAuth).toHaveBeenCalledWith('acc-locked', '/u/1/mail/inbox'));
		expect(tab.awaitAuthTab).not.toHaveBeenCalled();
	});
});
