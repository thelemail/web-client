import { afterEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen } from '@testing-library/svelte';
import PasswordCeremony from './PasswordCeremony.svelte';
import { m } from '$paraglide/messages.js';

vi.mock('$platform', () => ({ platform: {} }));
vi.mock('$app/navigation', () => ({ goto: vi.fn() }));
vi.mock('$core/api/auth', () => ({
	passwordChangeComplete: vi.fn(),
	passwordChangeCompleteOpaque: vi.fn(),
	passwordChangeInit: vi.fn(),
	passwordChangeOpaqueInit: vi.fn(async () => ({ challengeId: 'c1', ke2: 'ke2' })),
	passwordChangeOpaqueRegistrationInit: vi.fn(),
	passwordChangeOpaqueVerify: vi.fn(async () => ({ changeToken: 'ct', changeTokenExpiresInSeconds: 600 })),
	passwordChangeVerify: vi.fn()
}));
vi.mock('$core/api/twofactor', () => ({
	init2faWebauthn: vi.fn(),
	verify2faBackupCode: vi.fn(),
	verify2faTotp: vi.fn(),
	verify2faWebauthn: vi.fn()
}));
vi.mock('$core/keystore/keystore-client', () => ({
	keystore: {
		subscribeAccount: () => () => {},
		abandonPasswordChange: vi.fn(async () => {}),
		status: vi.fn(async () => ({ accounts: [{ accountId: 'me', authScheme: 'opaque_v1' }] })),
		opaqueStartAuth: vi.fn(async () => ({ operationId: 'op1', ke1: 'ke1' })),
		opaqueFinishAuth: vi.fn(async () => ({ ok: true, ke3: 'ke3' }))
	}
}));
vi.mock('$core/auth/webauthn', () => ({ webauthnSupported: () => false, webauthnFailure: () => null, webauthnFailureMessage: () => '' }));
vi.mock('$core/stores/auth.svelte', () => ({ auth: { accountId: 'me', email: 'ada@thelemail.com' } }));

afterEach(cleanup);

function input(id: string): HTMLInputElement {
	return document.getElementById(id) as HTMLInputElement;
}

function submit(): HTMLButtonElement {
	return screen.getByRole('button', { name: m.settings_ceremony_password_submit() }) as HTMLButtonElement;
}

describe('PasswordCeremony', () => {
	it('refuses short and common passwords and accepts a plain long one', async () => {
		render(PasswordCeremony, { props: { onClose: vi.fn(), onComplete: vi.fn() } });
		await fireEvent.input(input('cur-pw'), { target: { value: 'old harbour lamp' } });
		await fireEvent.click(screen.getByRole('button', { name: m.common_continue() }));
		await vi.waitFor(() => expect(input('new-pw')).not.toBeNull());

		const fill = async (value: string) => {
			await fireEvent.input(input('new-pw'), { target: { value } });
			await fireEvent.input(input('new-pw2'), { target: { value } });
		};

		await fill('Password1234');
		expect(submit().disabled).toBe(true);
		await fill('harbourlamp');
		expect(submit().disabled).toBe(true);
		await fill('harbour lamp');
		expect(submit().disabled).toBe(false);
	});
});
