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

vi.mock('$core/auth/registration-proof', () => ({
	createRegistrationProof: () => ({ prepare: vi.fn(), dispose: vi.fn() }),
	withRegistrationProof: (_proof: unknown, run: (payload: undefined) => unknown) => run(undefined)
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

beforeEach(() => {
	for (const fn of [...Object.values(authApi), ...Object.values(keystore)]) fn.mockReset();
	authApi.getPlatformDomains.mockResolvedValue({ domains: ['temail.org', 'thelemail.com'], default: 'temail.org' });
	authApi.checkAddressAvailability.mockResolvedValue({ available: true });
});

afterEach(() => {
	cleanup();
});

describe('register page', () => {
	it('offers every platform domain and starts on the default one', async () => {
		render(RegisterPage);

		await vi.waitFor(() => expect(select()).not.toBeNull());
		expect(select()!.value).toBe('temail.org');
		expect([...select()!.options].map((o) => o.value)).toEqual(['temail.org', 'thelemail.com']);
	});

	it('checks the handle once for every platform domain and names the other address', async () => {
		render(RegisterPage);
		await vi.waitFor(() => expect(select()).not.toBeNull());

		await typeAddress('camille');
		await vi.waitFor(() => expect(authApi.checkAddressAvailability).toHaveBeenCalledWith('camille', expect.stringMatching(/^[0-9a-f]{32}$/)));
		await vi.waitFor(() => expect(document.body.textContent).toContain('Mail to camille@thelemail.com reaches you too.'));

		await fireEvent.change(select()!, { target: { value: 'thelemail.com' } });
		await vi.waitFor(() => expect(document.body.textContent).toContain('Mail to camille@temail.org reaches you too.'));
		expect(authApi.checkAddressAvailability).toHaveBeenCalledTimes(1);
	});

	it('registers the address on the picked domain', async () => {
		keystore.opaqueStartRegistration.mockRejectedValue(new Error('stop'));
		render(RegisterPage);
		await vi.waitFor(() => expect(select()).not.toBeNull());

		await fireEvent.change(select()!, { target: { value: 'thelemail.com' } });
		await typeAddress('camille');
		await vi.waitFor(() => expect(button('Continue')?.disabled).toBe(false));
		await fireEvent.click(button('Continue')!);

		const [pw, confirm] = [...document.querySelectorAll<HTMLInputElement>('input[type="password"]')];
		await fireEvent.input(pw, { target: { value: 'Quiet-harbour-lantern-47' } });
		await fireEvent.input(confirm, { target: { value: 'Quiet-harbour-lantern-47' } });
		await fireEvent.click(button('Create my mailbox')!);

		await vi.waitFor(() => expect(keystore.opaqueStartRegistration).toHaveBeenCalled());
		expect(keystore.opaqueStartRegistration.mock.calls[0][0].email).toBe('camille@thelemail.com');
	});
});
