import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, within } from '@testing-library/svelte';
import Security from './Security.svelte';
import { twofactor } from '$core/stores/twofactor.svelte';
import { securityActivity } from '../security/activity.svelte';
import { ApiCallError } from '$core/api/types';
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
const authApi = vi.hoisted(() => ({
	listSessions: vi.fn(),
	listSecurityEvents: vi.fn(),
	revokeSession: vi.fn(),
	revokeOtherSessions: vi.fn()
}));
vi.mock('$core/api/auth', () => authApi);
const auth = vi.hoisted(() => ({
	accountId: 'me',
	recoveryEnabled: true as boolean | null,
	recoveryState: 'set' as 'unknown' | 'error' | 'set' | 'unset',
	sessionRotations: 0,
	keyRotationBlockerFor: () => null,
	adoptRotatedSession: vi.fn(),
	loadProfile: vi.fn()
}));
vi.mock('$core/stores/auth.svelte', () => ({ auth }));
vi.mock('$core/stores/accountKeys.svelte', () => ({
	accountKeys: { current: null, history: [], authScheme: 'opaque', ready: vi.fn() }
}));
vi.mock('$core/keystore/keystore-client', () => ({ keystore: { subscribeAccount: () => () => {} } }));
vi.mock('$core/auth/webauthn', () => ({ webauthnSupported: () => true }));
vi.mock('$core/auth/reauth.svelte', () => ({ isReauthenticationRequired: () => false }));

const at = '2026-10-19T12:00:00Z';

const current = { id: 's1', client: 'web', current: true, createdAt: at, lastUsedAt: at };
const phone = { id: 's2', client: 'mobile', current: false, createdAt: at, lastUsedAt: at };
const event = (id: string) => ({ id, action: 'signed_in', client: 'web', occurredAt: at });

function card(title: string): HTMLElement {
	const h = [...document.querySelectorAll('.scard-h h3')].find((x) => x.textContent === title);
	return h!.closest('.scard') as HTMLElement;
}

function never<T>(): Promise<T> {
	return new Promise(() => {});
}

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
	auth.recoveryState = 'set';
	twofactor.status = status('Security key · Oct 19, 2026');
	twofactor.phase = 'ready';
	api.getTwoFactorStatus.mockResolvedValue(status('Desk YubiKey'));
	api.webauthnRename.mockResolvedValue({ id: 'k1', name: 'Desk YubiKey', createdAt: at });
	authApi.listSessions.mockResolvedValue({ sessions: [current] });
	authApi.listSecurityEvents.mockResolvedValue({ events: [] });
});

afterEach(() => {
	cleanup();
	twofactor.setAccount(null);
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

describe('Security layout', () => {
	it('groups every block under a heading', () => {
		open();
		const groups = [...document.querySelectorAll('section.sec-group')].map((g) => ({
			heading: g.querySelector('h2')?.textContent,
			cards: [...g.querySelectorAll('.scard-h h3, .cr-title')].map((h) => h.textContent?.trim())
		}));
		expect(groups.map((g) => g.heading)).toEqual(['Access', 'Encryption', 'Privacy & activity']);
		expect(groups[0].cards.join('|')).toMatch(/Account recovery.*Sign-in.*Active sessions/);
		expect(groups[1].cards.join('|')).toMatch(/Encryption keys.*Contact keys/);
		expect(groups[2].cards.join('|')).toMatch(/Privacy.*Security log/);
	});

	it('names every button and switch', () => {
		open();
		for (const el of document.querySelectorAll('button, [role="switch"]')) {
			const name = el.getAttribute('aria-label') ?? el.textContent?.trim();
			expect(name, el.outerHTML).toBeTruthy();
		}
	});
});

describe('recovery status', () => {
	it('shows the setup hero only when the server says recovery is off', () => {
		auth.recoveryState = 'unset';
		open();
		expect(document.querySelector('.recovery-hero')).not.toBeNull();
		expect(document.body.textContent).toContain('Not set up');
	});

	it('shows a compact row when recovery is set', () => {
		open();
		expect(document.querySelector('.recovery-hero')).toBeNull();
		expect(button('Regenerate recovery phrase')).toBeTruthy();
		expect(document.body.textContent).not.toContain('Not set up');
	});

	it('claims nothing while recovery status is unknown', () => {
		auth.recoveryState = 'unknown';
		open();
		expect(document.querySelector('.recovery-hero')).toBeNull();
		expect(document.body.textContent).not.toContain('Not set up');
		expect(document.body.textContent).not.toContain('Action recommended');
		expect(document.body.textContent).toContain('Checking account recovery');
	});

	it('offers a retry when recovery status failed to load', async () => {
		auth.recoveryState = 'error';
		open();
		expect(document.body.textContent).not.toContain('Not set up');
		expect(document.body.textContent).toContain('Couldn’t check whether account recovery is set up.');
		await fireEvent.click(button('Try again')!);
		expect(auth.loadProfile).toHaveBeenCalled();
	});
});

describe('two-factor status', () => {
	function badge() {
		return [...document.querySelectorAll('.scard-h')]
			.find((h) => h.textContent?.includes('Sign-in'))
			?.querySelector('.badge')?.textContent?.trim();
	}

	it('says checking while the status loads', () => {
		twofactor.status = null;
		twofactor.phase = 'loading';
		open();
		expect(badge()).toBe('Checking');
		expect(document.body.textContent).not.toContain('2FA off');
		expect(api.getTwoFactorStatus).not.toHaveBeenCalled();
	});

	it('shows an error with retry and does not reload on its own', async () => {
		twofactor.status = null;
		twofactor.phase = 'error';
		open();
		expect(badge()).toBe('Status unknown');
		expect(document.body.textContent).toContain('Couldn’t load your two-factor methods.');
		await new Promise((r) => setTimeout(r, 20));
		expect(api.getTwoFactorStatus).not.toHaveBeenCalled();

		await fireEvent.click(button('Try again')!);
		await vi.waitFor(() => expect(badge()).toBe('2FA on'));
		expect(api.getTwoFactorStatus).toHaveBeenCalledTimes(1);
	});

	it('says 2FA off only when the server said so', () => {
		twofactor.status = { enabled: false, totp: null, webauthnCredentials: [] } as unknown as TwoFactorStatus;
		open();
		expect(badge()).toBe('2FA off');
	});
});

describe('sessions', () => {
	it('shows a loading state, then the sessions', async () => {
		let resolve!: (v: unknown) => void;
		authApi.listSessions.mockReturnValue(new Promise((r) => (resolve = r)));
		open();
		const c = card('Active sessions');
		expect(c.querySelector('[aria-busy="true"]')?.textContent).toContain('Loading sessions');

		resolve({ sessions: [current, phone] });
		await vi.waitFor(() => expect(c.querySelectorAll('.devrow')).toHaveLength(2));
		expect(c.querySelector('[aria-busy="true"]')).toBeNull();
	});

	it('shows an error with retry when the first load fails', async () => {
		authApi.listSessions.mockRejectedValueOnce(new Error('HTTP 500'));
		open();
		const c = card('Active sessions');
		await vi.waitFor(() => expect(c.textContent).toContain('Couldn’t load your sessions.'));
		expect(within(c).queryByRole('button', { name: /Revoke all/ })).toBeNull();

		await fireEvent.click(within(c).getByRole('button', { name: 'Try again' }));
		await vi.waitFor(() => expect(c.querySelectorAll('.devrow')).toHaveLength(1));
		expect(c.textContent).not.toContain('Couldn’t load');
	});

	it('keeps the rows it has when a refresh fails', async () => {
		authApi.listSessions.mockResolvedValueOnce({ sessions: [current, phone] }).mockRejectedValueOnce(new Error('x'));
		open();
		const c = card('Active sessions');
		await vi.waitFor(() => expect(c.querySelectorAll('.devrow')).toHaveLength(2));

		authApi.revokeSession.mockResolvedValue(undefined);
		await fireEvent.click(within(c).getByRole('button', { name: 'Sign out' }));
		await vi.waitFor(() => expect(c.textContent).toContain('Couldn’t refresh the list.'));
		expect(c.querySelectorAll('.devrow')).toHaveLength(2);
	});

	it('reports a failed sign-out', async () => {
		authApi.listSessions.mockResolvedValue({ sessions: [current, phone] });
		authApi.revokeSession.mockRejectedValue(new ApiCallError(429, null, 'HTTP 429'));
		open();
		const c = card('Active sessions');
		await vi.waitFor(() => expect(c.querySelectorAll('.devrow')).toHaveLength(2));

		await fireEvent.click(within(c).getByRole('button', { name: 'Sign out' }));
		await vi.waitFor(() =>
			expect(within(c).getByRole('alert').textContent).toContain('Too many attempts. Wait a minute and try again.')
		);
		expect(within(c).getByRole('button', { name: 'Sign out' }).hasAttribute('disabled')).toBe(false);
	});

	it('hides revoke all when no other session exists', async () => {
		open();
		const c = card('Active sessions');
		await vi.waitFor(() => expect(c.querySelectorAll('.devrow')).toHaveLength(1));
		expect(c.textContent).not.toContain('Sign out everywhere else');
	});

	it('asks before signing out every other session', async () => {
		authApi.listSessions.mockResolvedValue({ sessions: [current, phone] });
		authApi.revokeOtherSessions.mockResolvedValue(undefined);
		open();
		const c = card('Active sessions');
		await vi.waitFor(() => expect(c.querySelectorAll('.devrow')).toHaveLength(2));

		await fireEvent.click(within(c).getByRole('button', { name: /Revoke all/ }));
		expect(document.body.textContent).toContain('Sign out everywhere else?');
		expect(authApi.revokeOtherSessions).not.toHaveBeenCalled();

		await fireEvent.click(button('Sign out other sessions')!);
		await vi.waitFor(() => expect(authApi.revokeOtherSessions).toHaveBeenCalledTimes(1));
	});

	it('reports a failed revoke all', async () => {
		authApi.listSessions.mockResolvedValue({ sessions: [current, phone] });
		authApi.revokeOtherSessions.mockRejectedValue(new Error('HTTP 500'));
		open();
		const c = card('Active sessions');
		await vi.waitFor(() => expect(c.querySelectorAll('.devrow')).toHaveLength(2));

		await fireEvent.click(within(c).getByRole('button', { name: /Revoke all/ }));
		await fireEvent.click(button('Sign out other sessions')!);
		await vi.waitFor(() =>
			expect(within(c).getByRole('alert').textContent).toContain('Couldn’t sign out your other sessions.')
		);
	});
});

describe('security log', () => {
	it('shows a loading state and no empty message while loading', () => {
		authApi.listSecurityEvents.mockReturnValue(never());
		open();
		const c = card('Security log');
		expect(c.querySelector('[aria-busy="true"]')?.textContent).toContain('Loading security log');
		expect(c.textContent).not.toContain('No security events yet');
	});

	it('shows an error, not an empty log, when loading fails', async () => {
		authApi.listSecurityEvents.mockRejectedValueOnce(new Error('HTTP 500'));
		open();
		const c = card('Security log');
		await vi.waitFor(() => expect(c.textContent).toContain('Couldn’t load the security log.'));
		expect(c.textContent).not.toContain('No security events yet');

		await fireEvent.click(within(c).getByRole('button', { name: 'Try again' }));
		await vi.waitFor(() => expect(c.textContent).toContain('No security events yet'));
	});

	it('keeps the events it has when a refresh fails', async () => {
		authApi.listSecurityEvents
			.mockResolvedValueOnce({ events: [event('e1'), event('e2')] })
			.mockRejectedValueOnce(new Error('x'));
		open();
		const c = card('Security log');
		await vi.waitFor(() => expect(c.querySelectorAll('.log-row')).toHaveLength(2));

		securityActivity.touch();
		await vi.waitFor(() => expect(c.textContent).toContain('Couldn’t refresh the log.'));
		expect(c.querySelectorAll('.log-row')).toHaveLength(2);
	});

	it('reports a failed load more', async () => {
		authApi.listSecurityEvents
			.mockResolvedValueOnce({ events: [event('e1')], nextCursor: 'c1' })
			.mockRejectedValueOnce(new Error('x'));
		open();
		const c = card('Security log');
		await vi.waitFor(() => expect(within(c).getByRole('button', { name: 'Show more' })).toBeTruthy());

		await fireEvent.click(within(c).getByRole('button', { name: 'Show more' }));
		await vi.waitFor(() => expect(within(c).getByRole('alert').textContent).toContain('Couldn’t load more events.'));
		expect(c.querySelectorAll('.log-row')).toHaveLength(1);
	});
});
