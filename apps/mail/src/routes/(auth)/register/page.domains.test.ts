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

vi.mock('$core/auth/proof-of-work', () => ({
	createProofOfWork: () => ({ prepare: vi.fn(), dispose: vi.fn() }),
	withProofOfWork: (_proof: unknown, run: (payload: undefined) => unknown) => run(undefined)
}));
vi.mock('$core/auth/perform-login', () => ({ performLogin: vi.fn() }));
vi.mock('$core/stores/auth.svelte', () => ({ auth: { email: null } }));
vi.mock('$platform', () => ({ platform: { returnOrigin: () => 'http://localhost', openExternal: vi.fn() } }));
vi.mock('$app/navigation', () => ({ goto: vi.fn() }));
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

async function submitPassword() {
	const [pw, confirm] = [...document.querySelectorAll<HTMLInputElement>('input[type="password"]')];
	await fireEvent.input(pw, { target: { value: 'Quiet-harbour-lantern-47' } });
	await fireEvent.input(confirm, { target: { value: 'Quiet-harbour-lantern-47' } });
	await fireEvent.click(button('Create my mailbox')!);
}

beforeEach(() => {
	for (const fn of [...Object.values(authApi), ...Object.values(keystore)]) fn.mockReset();
	authApi.getPlatformDomains.mockResolvedValue({
		domains: ['temail.org', 'example.net'],
		hosted: ['temail.org', 'example.net', 'thelemail.com'],
		default: 'temail.org'
	});
	authApi.checkAddressAvailability.mockResolvedValue({ available: true });
});

afterEach(() => {
	cleanup();
});

describe('register page with several signup domains', () => {
	it('offers only the signup domains and registers on the picked one', async () => {
		keystore.opaqueStartRegistration.mockRejectedValue(new Error('stop'));
		render(RegisterPage);

		await vi.waitFor(() => expect(select()).not.toBeNull());
		expect(select()!.value).toBe('temail.org');
		expect([...select()!.options].map((o) => o.value)).toEqual(['temail.org', 'example.net']);

		await fireEvent.change(select()!, { target: { value: 'example.net' } });
		await continueToPassword('camille');
		await submitPassword();

		await vi.waitFor(() => expect(keystore.opaqueStartRegistration).toHaveBeenCalled());
		expect(keystore.opaqueStartRegistration.mock.calls[0][0].email).toBe('camille@example.net');
	});
});
