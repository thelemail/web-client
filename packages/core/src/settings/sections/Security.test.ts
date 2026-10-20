import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render } from '@testing-library/svelte';
import Security from './Security.svelte';
import { twofactor } from '$core/stores/twofactor.svelte';
import { SETTINGS_DEFAULTS } from '../data';
import type { TwoFactorStatus } from '$core/api/types';

const api = vi.hoisted(() => ({
	getTwoFactorStatus: vi.fn(),
	webauthnRename: vi.fn(),
	webauthnDelete: vi.fn(),
	totpDisable: vi.fn(),
	regenerateBackupCodes: vi.fn()
}));

vi.mock('$env/dynamic/public', () => ({ env: {} }));
vi.mock('$platform', () => ({ platform: {} }));
vi.mock('$core/mail/senderVerify', () => ({ forgetSenderTrust: vi.fn() }));
vi.mock('$core/api/twofactor', () => api);
vi.mock('$core/api/auth', () => ({
	listSessions: vi.fn().mockResolvedValue({ sessions: [] }),
	listSecurityEvents: vi.fn().mockResolvedValue({ events: [] }),
	revokeSession: vi.fn(),
	revokeOtherSessions: vi.fn()
}));
vi.mock('$core/stores/auth.svelte', () => ({
	auth: {
		accountId: 'me',
		recoveryEnabled: true,
		sessionRotations: 0,
		keyRotationBlockerFor: () => null,
		adoptRotatedSession: vi.fn()
	}
}));
vi.mock('$core/stores/accountKeys.svelte', () => ({
	accountKeys: { current: null, history: [], authScheme: 'opaque', ready: vi.fn() }
}));
vi.mock('$core/keystore/keystore-client', () => ({ keystore: { subscribeAccount: () => () => {} } }));
vi.mock('$core/auth/webauthn', () => ({ webauthnSupported: () => true }));
vi.mock('$core/auth/reauth.svelte', () => ({ isReauthenticationRequired: () => false }));

const at = '2026-10-19T12:00:00Z';

function status(name: string): TwoFactorStatus {
	return {
		enabled: true,
		totp: null,
		webauthnCredentials: [{ id: 'k1', name, createdAt: at, backupState: false, userVerified: true }]
	} as unknown as TwoFactorStatus;
}

function button(label: string) {
	return [...document.querySelectorAll('button')].find((b) => b.textContent?.trim() === label);
}

function open() {
	return render(Security, {
		props: { s: { ...SETTINGS_DEFAULTS }, set: vi.fn(), launch: vi.fn() }
	});
}

beforeEach(() => {
	twofactor.status = status('Security key · Oct 19, 2026');
	api.getTwoFactorStatus.mockResolvedValue(status('Desk YubiKey'));
	api.webauthnRename.mockResolvedValue({ id: 'k1', name: 'Desk YubiKey', createdAt: at });
});

afterEach(() => {
	cleanup();
	twofactor.status = null;
	vi.clearAllMocks();
});

describe('Security key rename', () => {
	it('renames a key and shows the new name in the list and the remove dialog', async () => {
		open();
		await fireEvent.click(button('Rename')!);
		const field = document.querySelector<HTMLInputElement>('.cfd-input')!;
		expect(field.value).toBe('Security key · Oct 19, 2026');

		await fireEvent.input(field, { target: { value: ' Desk YubiKey ' } });
		await fireEvent.click(button('Save')!);
		await vi.waitFor(() => expect(document.querySelector('.cfd-input')).toBeNull());

		expect(api.webauthnRename).toHaveBeenCalledWith('k1', 'Desk YubiKey', 'me');
		await vi.waitFor(() => expect(document.querySelector('.tfa-t')?.textContent).toContain('Desk YubiKey'));

		await fireEvent.click(button('Remove')!);
		expect(document.body.textContent).toContain('Remove “Desk YubiKey”');
	});

	it('keeps save disabled until the name changes', async () => {
		open();
		await fireEvent.click(button('Rename')!);
		expect(button('Save')?.disabled).toBe(true);

		await fireEvent.input(document.querySelector('.cfd-input')!, { target: { value: '   ' } });
		expect(button('Save')?.disabled).toBe(true);
		expect(api.webauthnRename).not.toHaveBeenCalled();
	});
});
