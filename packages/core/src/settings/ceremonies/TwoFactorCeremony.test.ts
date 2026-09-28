import { afterEach, describe, expect, it, vi } from 'vitest';
import { cleanup, render } from '@testing-library/svelte';
import { tick } from 'svelte';
import TwoFactorCeremony from './TwoFactorCeremony.svelte';

const webauthn = vi.hoisted(() => ({ supported: true, platform: true }));

vi.mock('$platform', () => ({ platform: {} }));
vi.mock('$core/api/twofactor', () => ({}));
vi.mock('$core/auth/enrollment-step-up', () => ({ enrollmentStepUp: vi.fn() }));
vi.mock('$core/auth/webauthn', () => ({
	createCredential: vi.fn(),
	isWebauthnCancelled: () => false,
	webauthnSupported: () => webauthn.supported,
	platformAuthenticatorAvailable: () => Promise.resolve(webauthn.platform)
}));
vi.mock('$core/stores/auth.svelte', () => ({ auth: { accountId: null, email: 'ada@thelemail.com' } }));
vi.mock('$core/stores/twofactor.svelte', () => ({
	twofactor: { status: null, loading: false, load: vi.fn() }
}));

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
