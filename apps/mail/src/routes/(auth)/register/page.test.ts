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

async function typeAddress(handle: string) {
	await fireEvent.input(document.querySelector('#register-name')!, { target: { value: 'Camille Roux' } });
	await fireEvent.input(document.querySelector('#register-handle')!, { target: { value: handle } });
}

async function continueToPassword(handle: string) {
	await typeAddress(handle);
	await vi.waitFor(() => expect(button('Continue')?.disabled).toBe(false));
	await fireEvent.click(button('Continue')!);
}

async function fillPassword(value: string) {
	const [pw, confirm] = [...document.querySelectorAll<HTMLInputElement>('input[type="password"]')];
	await fireEvent.input(pw, { target: { value } });
	await fireEvent.input(confirm, { target: { value } });
}

async function submitPassword() {
	await fillPassword('Quiet-harbour-lantern-47');
	await fireEvent.click(button('Create my mailbox')!);
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

function passwordValues() {
	return [...document.querySelectorAll<HTMLInputElement>('input[type="password"]')].map((i) => i.value);
}

afterEach(() => {
	cleanup();
});

describe('register page', () => {
	it('shows a fixed suffix when only one domain is offered', async () => {
		render(RegisterPage);

		await vi.waitFor(() => expect(document.querySelector('.suf')?.textContent).toBe('@temail.org'));
		expect(select()).toBeNull();
	});

	it('checks the handle once and names only the new address', async () => {
		render(RegisterPage);

		await typeAddress('camille');
		await vi.waitFor(() => expect(authApi.checkAddressAvailability).toHaveBeenCalledWith('camille', expect.stringMatching(/^[0-9a-f]{32}$/)));
		await vi.waitFor(() => expect(document.body.textContent).toContain('camille@temail.org'));
		expect(document.body.textContent).not.toContain('thelemail.com');
		expect(authApi.checkAddressAvailability).toHaveBeenCalledTimes(1);
	});

	it('registers on the offered domain and keeps the legal line to it', async () => {
		keystore.opaqueStartRegistration.mockRejectedValue(new Error('stop'));
		render(RegisterPage);
		await vi.waitFor(() => expect(document.querySelector('.suf')?.textContent).toBe('@temail.org'));

		await continueToPassword('camille');
		expect(document.querySelector('.legal')?.textContent).toContain('temail.org');
		expect(document.querySelector('.legal')?.textContent).not.toContain('thelemail.com');
		await submitPassword();

		await vi.waitFor(() => expect(keystore.opaqueStartRegistration).toHaveBeenCalled());
		expect(keystore.opaqueStartRegistration.mock.calls[0][0].email).toBe('camille@temail.org');
	});

	it('binds the proof of work to the chosen address', async () => {
		authApi.registrationInit.mockRejectedValue(new Error('stop'));
		keystore.opaqueStartRegistration.mockResolvedValue({ operationId: 'op1', registrationRequest: 'req' });
		render(RegisterPage);
		await vi.waitFor(() => expect(document.querySelector('.suf')?.textContent).toBe('@temail.org'));

		await continueToPassword('camille');
		await vi.waitFor(() => expect(pow.prepare).toHaveBeenLastCalledWith('camille@temail.org'));
		await fireEvent.click(document.querySelector<HTMLButtonElement>('.btn-back')!);
		await continueToPassword('camilla');
		await vi.waitFor(() => expect(pow.prepare).toHaveBeenLastCalledWith('camilla@temail.org'));

		await submitPassword();
		await vi.waitFor(() => expect(pow.take).toHaveBeenCalledWith('camilla@temail.org'));
	});

	it('refuses short and common passwords and accepts a plain long one', async () => {
		render(RegisterPage);
		await vi.waitFor(() => expect(document.querySelector('.suf')?.textContent).toBe('@temail.org'));
		await continueToPassword('camille');

		await fillPassword('Password1234');
		expect(button('Create my mailbox')?.disabled).toBe(true);
		await fillPassword('harbourlamp');
		expect(button('Create my mailbox')?.disabled).toBe(true);
		await fillPassword('harbour lamp');
		expect(button('Create my mailbox')?.disabled).toBe(false);
	});

	it('keeps the filled password step on screen while the mailbox opens', async () => {
		succeedRegistration();
		const leaving = Promise.withResolvers<void>();
		goto.mockReturnValue(leaving.promise);
		render(RegisterPage);
		await vi.waitFor(() => expect(document.querySelector('.suf')?.textContent).toBe('@temail.org'));
		await continueToPassword('camille');

		await submitPassword();
		await vi.waitFor(() => expect(goto).toHaveBeenCalled());

		expect(passwordValues()).toEqual(['Quiet-harbour-lantern-47', 'Quiet-harbour-lantern-47']);
		expect(document.body.textContent).toContain('Opening your mailbox');
		expect(document.body.textContent).toContain('Passwords match');
		leaving.resolve();
	});

	it('keeps both passwords when creating the account fails', async () => {
		keystore.opaqueStartRegistration.mockRejectedValue(new Error('network down'));
		render(RegisterPage);
		await vi.waitFor(() => expect(document.querySelector('.suf')?.textContent).toBe('@temail.org'));
		await continueToPassword('camille');

		await submitPassword();
		await vi.waitFor(() => expect(document.body.textContent).toContain('network down'));

		expect(passwordValues()).toEqual(['Quiet-harbour-lantern-47', 'Quiet-harbour-lantern-47']);
		expect(button('Create my mailbox')?.disabled).toBe(false);
	});
});
