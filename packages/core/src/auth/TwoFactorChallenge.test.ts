import { afterEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen } from '@testing-library/svelte';
import type { TwoFactorMethod } from '$core/api/types';
import TwoFactorChallenge from './TwoFactorChallenge.svelte';

vi.mock('$core/auth/webauthn', () => ({ webauthnSupported: () => true }));

function mount(methods: TwoFactorMethod[], error: string | null = null, keyNotice: string | null = null) {
	const onWebauthn = vi.fn();
	render(TwoFactorChallenge, {
		email: 'ada@thelemail.com',
		methods,
		busy: false,
		error,
		keyNotice,
		onTotp: vi.fn(),
		onBackupCode: vi.fn(),
		onWebauthn,
		onBack: vi.fn()
	});
	return onWebauthn;
}

describe('TwoFactorChallenge', () => {
	afterEach(cleanup);

	it('opens with the security key when one is enrolled alongside an authenticator app', () => {
		const onWebauthn = mount(['totp', 'webauthn', 'backupCode']);
		expect(onWebauthn).toHaveBeenCalledTimes(1);
	});

	it('falls back to the authenticator app without a key', () => {
		const onWebauthn = mount(['totp', 'backupCode']);
		expect(onWebauthn).not.toHaveBeenCalled();
		expect(document.querySelector('input[autocomplete="one-time-code"]')).not.toBeNull();
	});

	it('names every code digit and ties a rejected code to the inputs', () => {
		mount(['totp', 'backupCode'], 'bad code');
		const digits = [...document.querySelectorAll<HTMLInputElement>('input[autocomplete="one-time-code"]')];
		expect(digits).toHaveLength(6);
		const alert = document.querySelector('[role="alert"]');
		expect(alert?.id).toBeTruthy();
		for (const [i, input] of digits.entries()) {
			expect(input.getAttribute('aria-label')).toContain(String(i + 1));
			expect(input.getAttribute('aria-invalid')).toBe('true');
			expect(input.getAttribute('aria-describedby')).toBe(alert!.id);
		}
	});

	it('explains a key prompt that closed and offers it again', async () => {
		const onWebauthn = mount(['webauthn', 'backupCode'], null, 'The browser closed the request.');
		const alert = screen.getByRole('alert');
		expect(alert.textContent).toContain('The browser closed the request.');
		await fireEvent.click(screen.getByRole('button', { name: 'Try again' }));
		expect(onWebauthn).toHaveBeenCalledTimes(2);
	});
});
