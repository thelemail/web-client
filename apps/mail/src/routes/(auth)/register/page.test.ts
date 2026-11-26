import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render } from '@testing-library/svelte';
import RegisterPage from './+page.svelte';

const authApi = vi.hoisted(() => ({
	getPlatformDomains: vi.fn(),
	checkAddressAvailability: vi.fn(),
	registrationInit: vi.fn(),
	register: vi.fn()
}));
vi.mock('$core/api/auth', () => authApi);

const keystore = vi.hoisted(() => ({
	opaqueStartRegistration: vi.fn(),
	opaqueFinishRegistration: vi.fn(),
	opaqueFinalizeRegister: vi.fn()
}));
vi.mock('$core/keystore/keystore-client', () => ({ keystore }));

const pow = vi.hoisted(() => ({ prepare: vi.fn(), dispose: vi.fn(), take: vi.fn() }));
vi.mock('$core/auth/proof-of-work', () => ({
	createProofOfWork: () => pow,
	withProofOfWork: (_proof: unknown, email: string, run: (payload: undefined) => unknown) => {
		pow.take(email);
		return run(undefined);
	}
}));
const performLogin = vi.hoisted(() => vi.fn());
vi.mock('$core/auth/perform-login', () => ({ performLogin }));
vi.mock('$core/stores/session.svelte', () => ({ auth: { email: null } }));
vi.mock('$platform', () => ({ platform: { returnOrigin: () => 'http://localhost', openExternal: vi.fn() } }));
const goto = vi.hoisted(() => vi.fn());
vi.mock('$app/navigation', () => ({ goto }));
vi.mock('$app/state', () => ({ page: { params: {}, url: new URL('http://localhost/register') } }));

function select(): HTMLSelectElement | null {
	return document.querySelector('select');
}

function button(label: string) {
	return [...document.querySelectorAll('button')].find((b) => b.textContent?.trim() === label);
}

function suffix() {
	return document.querySelector('.af-suffix')?.textContent;
}

async function typeAddress(handle: string) {
	await vi.waitFor(() => expect(document.querySelector('#register-handle')).not.toBeNull());
	await fireEvent.input(document.querySelector('#register-handle')!, { target: { value: handle } });
}

async function next() {
	await vi.waitFor(() => expect(button('Continue')?.disabled).toBe(false));
	await fireEvent.click(button('Continue')!);
}

async function continueToPassword(handle: string) {
	await typeAddress(handle);
	await next();
	await fireEvent.input(document.querySelector('#register-name')!, { target: { value: 'Camille Roux' } });
}

async function fillPassword(value: string) {
	await fireEvent.input(document.querySelector('#register-password')!, { target: { value } });
	await fireEvent.input(document.querySelector('#register-confirm')!, { target: { value } });
}

async function acceptTerms() {
	await fireEvent.click(document.querySelector('.af-tick input')!);
}

async function submitPassword() {
	await fillPassword('Quiet-harbour-lantern-47');
	await acceptTerms();
	await fireEvent.click(button('Create my account')!);
}

function legal() {
	return [...document.querySelectorAll('.af-fine')].map((e) => e.textContent).join(' ');
}

beforeEach(() => {
	for (const fn of [...Object.values(authApi), ...Object.values(keystore), ...Object.values(pow)]) fn.mockReset();
	authApi.getPlatformDomains.mockResolvedValue({
		domains: ['temail.org'],
		hosted: ['temail.org', 'thelemail.com'],
		default: 'temail.org'
	});
	authApi.checkAddressAvailability.mockResolvedValue({ available: true });
	performLogin.mockReset();
	goto.mockReset();
});

function succeedRegistration() {
	keystore.opaqueStartRegistration.mockResolvedValue({ operationId: 'op1', registrationRequest: 'req' });
	authApi.registrationInit.mockResolvedValue({ accountId: 'acc-1', registrationResponse: 'resp', registrationId: 'reg-1' });
	keystore.opaqueFinishRegistration.mockResolvedValue({ ok: true, opaqueRecord: 'rec' });
	authApi.register.mockResolvedValue({});
	keystore.opaqueFinalizeRegister.mockResolvedValue({ ok: true });
	performLogin.mockResolvedValue({ status: 'complete', result: { slot: 0 } });
}

afterEach(() => {
	cleanup();
});

describe('register page', () => {
	it('shows a fixed suffix when only one domain is offered', async () => {
		render(RegisterPage);

		await vi.waitFor(() => expect(suffix()).toBe('@temail.org'));
		expect(select()).toBeNull();
	});

	it('asks for the address before the name', async () => {
		render(RegisterPage);

		await vi.waitFor(() => expect(document.querySelector('#register-handle')).not.toBeNull());
		expect(document.querySelector('#register-name')).toBeNull();
		expect(document.querySelector('#register-password')).toBeNull();
	});

	it('checks the handle once and names only the new address', async () => {
		render(RegisterPage);

		await typeAddress('camille');
		await vi.waitFor(() => expect(authApi.checkAddressAvailability).toHaveBeenCalledWith('camille', expect.stringMatching(/^[0-9a-f]{32}$/)));
		await vi.waitFor(() => expect(document.querySelector('#register-handle-msg')?.textContent).toContain('camille@temail.org is available.'));
		expect(document.querySelector('#register-handle-msg')?.textContent).not.toContain('thelemail.com');
		expect(authApi.checkAddressAvailability).toHaveBeenCalledTimes(1);
	});

	it('keeps one status line and says it is checking only after a pause', async () => {
		const held = Promise.withResolvers<{ available: boolean }>();
		authApi.checkAddressAvailability.mockReturnValue(held.promise);
		render(RegisterPage);
		await vi.waitFor(() => expect(document.querySelector('#register-handle')).not.toBeNull());
		vi.useFakeTimers();
		try {
			const status = () => document.querySelector('#register-handle-msg');
			const first = status();
			await fireEvent.input(document.querySelector('#register-handle')!, { target: { value: 'ca' } });
			await vi.advanceTimersByTimeAsync(100);
			expect(status()?.getAttribute('data-tone')).toBe('hint');
			await vi.advanceTimersByTimeAsync(400);
			expect(status()?.getAttribute('data-tone')).toBe('bad');

			await fireEvent.input(document.querySelector('#register-handle')!, { target: { value: 'camille' } });
			await vi.advanceTimersByTimeAsync(299);
			expect(status()?.textContent).not.toContain('Checking');
			await vi.advanceTimersByTimeAsync(1);
			expect(status()?.textContent).toContain('Checking');

			held.resolve({ available: true });
			await vi.advanceTimersByTimeAsync(400);
			expect(status()?.textContent).toContain('camille@temail.org is available.');
			expect(status()).toBe(first);
		} finally {
			vi.useRealTimers();
		}
	});

	it('names a taken address and keeps Continue off', async () => {
		authApi.checkAddressAvailability.mockResolvedValue({ available: false });
		render(RegisterPage);

		await typeAddress('camille');
		await vi.waitFor(() => expect(document.body.textContent).toContain('camille@temail.org is taken.'));
		expect(button('Continue')?.disabled).toBe(true);
		expect(document.querySelector('#register-handle')!.getAttribute('aria-invalid')).toBe('true');
		expect(document.querySelector('.af-chip')).toBeNull();
	});

	it('offers free variants of a taken address and takes one on a click', async () => {
		authApi.checkAddressAvailability.mockImplementation(async (handle: string) => ({
			available: handle !== 'camille' && handle !== 'camillemail'
		}));
		render(RegisterPage);

		await typeAddress('camille');
		await vi.waitFor(() =>
			expect([...document.querySelectorAll('.af-chip')].map((c) => c.textContent)).toEqual([
				'camille.mail@temail.org',
				'camille.post@temail.org'
			])
		);
		await fireEvent.click(document.querySelector('.af-chip')!);
		expect(document.querySelector<HTMLInputElement>('#register-handle')!.value).toBe('camille.mail');
		await vi.waitFor(() => expect(button('Continue')?.disabled).toBe(false));
	});

	it('registers on the offered domain and keeps the legal line to it', async () => {
		keystore.opaqueStartRegistration.mockRejectedValue(new Error('stop'));
		render(RegisterPage);
		await vi.waitFor(() => expect(suffix()).toBe('@temail.org'));

		await continueToPassword('camille');
		await fillPassword('Quiet-harbour-lantern-47');
		expect(legal()).toContain('temail.org');
		expect(legal()).not.toContain('thelemail.com');
		await acceptTerms();
		await fireEvent.click(button('Create my account')!);

		await vi.waitFor(() => expect(keystore.opaqueStartRegistration).toHaveBeenCalled());
		expect(keystore.opaqueStartRegistration.mock.calls[0][0].email).toBe('camille@temail.org');
		expect(authApi.register).not.toHaveBeenCalled();
	});

	it('sends the name typed on the second card', async () => {
		succeedRegistration();
		render(RegisterPage);
		await continueToPassword('camille');
		await submitPassword();

		await vi.waitFor(() => expect(authApi.register).toHaveBeenCalled());
		expect(authApi.register.mock.calls[0][0]).toMatchObject({ email: 'camille@temail.org', fullName: 'Camille Roux' });
	});

	it('will not create the account before the terms are accepted', async () => {
		render(RegisterPage);
		await vi.waitFor(() => expect(suffix()).toBe('@temail.org'));
		await continueToPassword('camille');
		await fillPassword('Quiet-harbour-lantern-47');

		expect(button('Create my account')?.disabled).toBe(true);
		await acceptTerms();
		expect(button('Create my account')?.disabled).toBe(false);
	});

	it('will not create the account without a name', async () => {
		render(RegisterPage);
		await continueToPassword('camille');
		await fireEvent.input(document.querySelector('#register-name')!, { target: { value: '  ' } });
		await fillPassword('Quiet-harbour-lantern-47');
		await acceptTerms();

		expect(button('Create my account')?.disabled).toBe(true);
	});

	it('binds the proof of work to the chosen address', async () => {
		authApi.registrationInit.mockRejectedValue(new Error('stop'));
		keystore.opaqueStartRegistration.mockResolvedValue({ operationId: 'op1', registrationRequest: 'req' });
		render(RegisterPage);
		await vi.waitFor(() => expect(suffix()).toBe('@temail.org'));

		await continueToPassword('camille');
		await vi.waitFor(() => expect(pow.prepare).toHaveBeenLastCalledWith('camille@temail.org'));
		await fireEvent.click(button('Change')!);
		await continueToPassword('camilla');
		await vi.waitFor(() => expect(pow.prepare).toHaveBeenLastCalledWith('camilla@temail.org'));

		await submitPassword();
		await vi.waitFor(() => expect(pow.take).toHaveBeenCalledWith('camilla@temail.org'));
	});

	it('refuses short and common passwords and accepts a plain long one', async () => {
		render(RegisterPage);
		await vi.waitFor(() => expect(suffix()).toBe('@temail.org'));
		await continueToPassword('camille');
		await acceptTerms();

		await fillPassword('Password1234');
		expect(button('Create my account')?.disabled).toBe(true);
		await fillPassword('harbourlamp');
		expect(button('Create my account')?.disabled).toBe(true);
		await fillPassword('harbour lamp');
		expect(button('Create my account')?.disabled).toBe(false);
	});

	it('shows the setup steps for the new address while the mailbox opens', async () => {
		succeedRegistration();
		const leaving = Promise.withResolvers<void>();
		goto.mockReturnValue(leaving.promise);
		render(RegisterPage);
		await vi.waitFor(() => expect(suffix()).toBe('@temail.org'));
		await continueToPassword('camille');

		await submitPassword();
		await vi.waitFor(() => expect(goto).toHaveBeenCalled());

		expect(document.querySelector('h1')?.textContent).toBe('Your account is ready');
		expect(document.body.textContent).toContain('camille@temail.org');
		expect(document.body.textContent).toContain('Opening your mailbox');
		expect(document.querySelectorAll('.af-work li.done')).toHaveLength(3);
		expect(document.querySelector('#register-confirm')).toBeNull();
		leaving.resolve();
	});

	it('keeps both passwords when creating the account fails', async () => {
		keystore.opaqueStartRegistration.mockRejectedValue(new Error('network down'));
		render(RegisterPage);
		await vi.waitFor(() => expect(suffix()).toBe('@temail.org'));
		await continueToPassword('camille');

		await submitPassword();
		await vi.waitFor(() => expect(document.querySelector('#register-confirm-msg')?.textContent).toContain('network down'));

		expect(document.querySelector<HTMLInputElement>('#register-confirm')!.value).toBe('Quiet-harbour-lantern-47');
		expect(document.querySelector<HTMLInputElement>('#register-password')!.value).toBe('Quiet-harbour-lantern-47');
		expect(button('Create my account')?.disabled).toBe(false);
	});
});
