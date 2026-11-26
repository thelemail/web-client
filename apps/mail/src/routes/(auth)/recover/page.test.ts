import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen } from '@testing-library/svelte';
import { m } from '$paraglide/messages.js';
import RecoverPage from './+page.svelte';

const recovery = vi.hoisted(() => {
	class RecoveryPhraseError extends Error {}
	class RecoveryResetExpiredError extends Error {}
	return {
		verifyRecoveryPhrase: vi.fn(),
		discardRecovery: vi.fn(),
		completeRecoveryReset: vi.fn(),
		submitRecoveryTwoFactorTotp: vi.fn(),
		submitRecoveryTwoFactorBackupCode: vi.fn(),
		submitRecoveryTwoFactorWebauthn: vi.fn(),
		RecoveryPhraseError,
		RecoveryResetExpiredError
	};
});
vi.mock('$core/auth/perform-recovery', () => recovery);

vi.mock('$core/auth/perform-login', () => ({
	TwoFactorRejectedError: class extends Error {},
	TwoFactorExpiredError: class extends Error {}
}));
vi.mock('$app/navigation', () => ({ goto: vi.fn() }));
vi.mock('$app/state', () => ({
	page: { params: {}, url: new URL('http://localhost/recover?email=r@thelemail.com') }
}));
vi.mock('$platform', () => ({ platform: {} }));

const moved = vi.hoisted(() => ({ signInMovedToAuth: vi.fn() }));
vi.mock('$core/custody/unlock', () => moved);
vi.mock('$core/products', async (importOriginal) => ({
	...(await importOriginal<typeof import('$core/products')>()),
	productTarget: (audience: string) => (audience === 'auth' ? { origin: 'https://auth.thelemail.test' } : null)
}));

const OPERATION = 'op-rec';
const PHRASE = [...Array(11).fill('abandon'), 'about'];

function button(label: string) {
	return (screen.queryByRole('button', { name: label }) as HTMLButtonElement | null) ?? undefined;
}

async function enterPhrase() {
	await vi.waitFor(() => expect(document.querySelectorAll('.af-words input')).toHaveLength(12));
	const inputs = document.querySelectorAll<HTMLInputElement>('.af-words input');
	for (const [i, word] of PHRASE.entries()) {
		await fireEvent.input(inputs[i], { target: { value: word } });
	}
	await fireEvent.click(button(m.auth_recover_phrase_unlock())!);
}

async function reachTwoFactor() {
	recovery.verifyRecoveryPhrase.mockResolvedValue({
		status: 'twoFactorRequired',
		pending: {
			pendingToken: 'pt-1',
			methods: ['totp'],
			expiresAt: Date.now() + 5 * 60 * 1000,
			opaqueOperationId: OPERATION
		}
	});
	await enterPhrase();
	await vi.waitFor(() => expect(document.querySelector('#twofa-code')).not.toBeNull());
}

async function reachNewPassword() {
	recovery.verifyRecoveryPhrase.mockResolvedValue({
		status: 'complete',
		result: { resetToken: 'rt-1', resetTokenExpiresAt: Date.now() + 600_000, opaqueOperationId: OPERATION }
	});
	await enterPhrase();
	await vi.waitFor(() => expect(document.querySelector('input[type="password"]')).not.toBeNull());
}

beforeEach(() => {
	for (const fn of [recovery.verifyRecoveryPhrase, recovery.discardRecovery, recovery.completeRecoveryReset]) {
		fn.mockReset();
	}
	recovery.discardRecovery.mockResolvedValue(undefined);
	moved.signInMovedToAuth.mockReset();
	moved.signInMovedToAuth.mockResolvedValue(false);
});

afterEach(() => {
	cleanup();
	vi.useRealTimers();
});

describe('recover page routing', () => {
	it('sends recovery to the account origin once sign-in has moved there', async () => {
		const assign = vi.fn();
		vi.stubGlobal('location', { ...window.location, assign });
		try {
			moved.signInMovedToAuth.mockResolvedValue(true);
			render(RecoverPage);

			await vi.waitFor(() => expect(assign).toHaveBeenCalledWith('https://auth.thelemail.test/recover?email=r@thelemail.com'));
			expect(button(m.auth_recover_phrase_unlock())).toBeUndefined();
		} finally {
			vi.unstubAllGlobals();
		}
	});

	it('recovers here while sign-in is still on mail', async () => {
		render(RecoverPage);

		await vi.waitFor(() => expect(button(m.auth_recover_phrase_unlock())).toBeDefined());
		expect(document.querySelector<HTMLInputElement>('#rec-email')!.value).toBe('r@thelemail.com');
	});
});

describe('recover page OPAQUE cleanup', () => {
	it('discards the pending operation when backing out of two-factor', async () => {
		render(RecoverPage);
		await reachTwoFactor();

		await fireEvent.click(button(m.common_back())!);

		expect(recovery.discardRecovery).toHaveBeenCalledWith(OPERATION);
	});

	it('discards the pending operation once two-factor expires', async () => {
		vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout', 'Date'] });
		render(RecoverPage);
		await reachTwoFactor();

		await vi.advanceTimersByTimeAsync(5 * 60 * 1000 + 1);

		expect(recovery.discardRecovery).toHaveBeenCalledWith(OPERATION);
		await vi.waitFor(() => expect(document.body.textContent).toContain(m.auth_recover_2fa_expired()));
	});

	it('discards the pending operation when torn down mid-challenge', async () => {
		const { unmount } = render(RecoverPage);
		await reachTwoFactor();

		unmount();

		expect(recovery.discardRecovery).toHaveBeenCalledWith(OPERATION);
	});

	it('discards the unlocked operation when torn down before a new password is set', async () => {
		const { unmount } = render(RecoverPage);
		await reachNewPassword();

		unmount();

		expect(recovery.discardRecovery).toHaveBeenCalledWith(OPERATION);
	});

	it('discards the previous operation before verifying the phrase again', async () => {
		render(RecoverPage);
		await reachNewPassword();

		await fireEvent.click(button(m.common_back())!);
		await vi.waitFor(() => expect(button(m.auth_recover_phrase_unlock())).toBeDefined());
		await fireEvent.click(button(m.auth_recover_phrase_unlock())!);

		await vi.waitFor(() => expect(recovery.verifyRecoveryPhrase).toHaveBeenCalledTimes(2));
		expect(recovery.discardRecovery).toHaveBeenCalledWith(OPERATION);
	});

	it('discards the pending operation when the tab is hidden', async () => {
		render(RecoverPage);
		await reachTwoFactor();

		window.dispatchEvent(new Event('pagehide'));

		expect(recovery.discardRecovery).toHaveBeenCalledWith(OPERATION);
		await vi.waitFor(() => expect(document.querySelector('#twofa-code')).toBeNull());
	});

	it('refuses short and common passwords and accepts a plain long one', async () => {
		render(RecoverPage);
		await reachNewPassword();
		const fill = async (value: string) => {
			await fireEvent.input(document.querySelector('#rec-password')!, { target: { value } });
			await fireEvent.input(document.querySelector('#rec-confirm')!, { target: { value } });
		};
		const blocked = () => button(m.auth_recover_reset_password())?.disabled;

		await fill('Password1234');
		expect(blocked()).toBe(true);
		await fill('harbourlamp');
		expect(blocked()).toBe(true);
		await fill('harbour lamp');
		expect(blocked()).toBe(false);

		await fireEvent.input(document.querySelector('#rec-confirm')!, { target: { value: 'harbour lam' } });
		expect(button(m.auth_recover_reset_password())?.disabled).toBe(true);
		await fireEvent.input(document.querySelector('#rec-confirm')!, { target: { value: 'harbour lamp' } });
		expect(button(m.auth_recover_reset_password())?.disabled).toBe(false);
	});
});
