import { afterEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render } from '@testing-library/svelte';
import { tick } from 'svelte';
import TwoFactorCeremony from './TwoFactorCeremony.svelte';

const webauthn = vi.hoisted(() => ({ supported: true, platform: true }));

const api = vi.hoisted(() => ({ webauthnEnrollInit: vi.fn(), webauthnActivate: vi.fn() }));
const stepUp = vi.hoisted(() => ({ enrollmentStepUp: vi.fn() }));
const createCredential = vi.hoisted(() => vi.fn());
const authState = vi.hoisted(() => ({
	accountId: null as string | null,
	email: 'ada@thelemail.com',
	adoptRotatedSession: vi.fn()
}));
const tfState = vi.hoisted(() => ({ status: null as unknown, phase: 'unknown', load: vi.fn(), ensure: vi.fn() }));

vi.mock('$platform', () => ({ platform: {} }));
vi.mock('$core/api/twofactor', () => api);
vi.mock('$core/auth/enrollment-step-up', () => stepUp);
vi.mock('$core/auth/webauthn', () => ({
	createCredential,
	isWebauthnCancelled: () => false,
	webauthnSupported: () => webauthn.supported,
	platformAuthenticatorAvailable: () => Promise.resolve(webauthn.platform)
}));
vi.mock('$core/stores/auth.svelte', () => ({ auth: authState }));
vi.mock('$core/stores/twofactor.svelte', () => ({ twofactor: tfState }));

async function selected(): Promise<string | undefined> {
	render(TwoFactorCeremony, { onClose: vi.fn(), onComplete: vi.fn() });
	await Promise.resolve();
	await tick();
	return document.querySelector('.method-opt.on .mo-t')?.textContent?.trim();
}

describe('TwoFactorCeremony', () => {
	afterEach(cleanup);

	it('starts on a passkey on this device', async () => {
		Object.assign(webauthn, { supported: true, platform: true });
		expect(await selected()).toMatch(/^This device/);
	});

	it('starts on a security key without a platform authenticator', async () => {
		Object.assign(webauthn, { supported: true, platform: false });
		expect(await selected()).toMatch(/^Security key/);
	});

	it('starts on the authenticator app without WebAuthn', async () => {
		Object.assign(webauthn, { supported: false, platform: false });
		expect(await selected()).toMatch(/^Authenticator app/);
	});

	it('lists passkeys before the authenticator app', async () => {
		Object.assign(webauthn, { supported: true, platform: true });
		await selected();
		const titles = [...document.querySelectorAll('.method-opt .mo-t')].map((n) => n.textContent?.trim() ?? '');
		expect(titles[0]).toMatch(/^This device/);
		expect(titles[2]).toMatch(/^Authenticator app/);
	});
});

describe('TwoFactorCeremony key names', () => {
	const macSafari =
		'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/18.4 Safari/605.1.15';

	afterEach(() => {
		cleanup();
		vi.unstubAllGlobals();
		authState.accountId = null;
		tfState.status = null;
	});

	function button(label: RegExp) {
		return [...document.querySelectorAll('button')].find((b) => label.test(b.textContent?.trim() ?? ''));
	}

	async function unlock(method: 'device' | 'key') {
		vi.stubGlobal('navigator', { ...navigator, userAgent: macSafari });
		Object.assign(webauthn, { supported: true, platform: true });
		authState.accountId = 'me';
		tfState.status = { totp: null, webauthnCredentials: [] };
		stepUp.enrollmentStepUp.mockResolvedValue({ ok: true, grant: 'g1' });
		api.webauthnEnrollInit.mockResolvedValue({ registrationId: 'r1', publicKey: {} });
		createCredential.mockResolvedValue({ id: 'cred' });
		api.webauthnActivate.mockResolvedValue({ credential: {}, session: {} });
		render(TwoFactorCeremony, { onClose: vi.fn(), onComplete: vi.fn(), initialMethod: method });
		await tick();
		await fireEvent.input(document.querySelector('#twofa-pw')!, { target: { value: 'pw' } });
		await fireEvent.click(button(/^Confirm/)!);
		await vi.waitFor(() => expect(document.querySelector('#twofa-key-name')).not.toBeNull());
		return document.querySelector<HTMLInputElement>('#twofa-key-name')!;
	}

	it('proposes a passkey name from the device and browser', async () => {
		const field = await unlock('device');

		expect(field.value).toMatch(/^Mac, Safari · /);
		await fireEvent.click(button(/Touch ID/)!);
		await vi.waitFor(() => expect(api.webauthnActivate).toHaveBeenCalled());
		const name = api.webauthnActivate.mock.calls.at(-1)![0].name;
		expect(name).toMatch(/^Mac, Safari · /);
		expect(name).not.toBe('This device');
	});

	it('sends the name the user typed', async () => {
		const field = await unlock('key');

		expect(field.value).toMatch(/^Security key · /);
		await fireEvent.input(field, { target: { value: '  Desk YubiKey ' } });
		await fireEvent.click(button(/Touch the key/)!);
		await vi.waitFor(() => expect(api.webauthnActivate).toHaveBeenCalled());
		expect(api.webauthnActivate.mock.calls.at(-1)![0].name).toBe('Desk YubiKey');
	});

	it('will not register a key without a name', async () => {
		const field = await unlock('key');
		await fireEvent.input(field, { target: { value: '   ' } });

		expect(document.body.textContent).toContain('Give this key a name.');
		expect(button(/Touch the key/)?.disabled).toBe(true);
	});
});
