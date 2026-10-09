import { afterEach, describe, expect, it, vi } from 'vitest';
import { cleanup, render } from '@testing-library/svelte';
import type { TwoFactorMethod } from '$core/api/types';
import TwoFactorChallenge from './TwoFactorChallenge.svelte';

vi.mock('$core/auth/webauthn', () => ({ webauthnSupported: () => true }));

function mount(methods: TwoFactorMethod[], error: string | null = null) {
	const onWebauthn = vi.fn();
	render(TwoFactorChallenge, {
		email: 'ada@thelemail.com',
		methods,
		busy: false,
		error,
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
});
