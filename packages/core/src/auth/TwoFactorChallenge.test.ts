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

	it('names the code blank and ties a rejected code to it', () => {
		mount(['totp', 'backupCode'], 'bad code');
		const inputs = [...document.querySelectorAll<HTMLInputElement>('input[autocomplete="one-time-code"]')];
		expect(inputs).toHaveLength(1);
		const alert = document.querySelector('[role="alert"]');
		expect(alert?.textContent).toContain('didn’t match');
		expect(inputs[0].getAttribute('aria-label')).toBe('Six-digit code');
		expect(inputs[0].getAttribute('aria-invalid')).toBe('true');
		const described = document.getElementById(inputs[0].getAttribute('aria-describedby')!);
		expect(described?.contains(alert)).toBe(true);
	});

	it('keeps only digits and submits six of them', async () => {
		const onTotp = vi.fn();
		render(TwoFactorChallenge, {
			email: 'ada@thelemail.com',
			methods: ['totp'],
			busy: false,
			error: null,
			onTotp,
			onBackupCode: vi.fn(),
			onWebauthn: vi.fn(),
			onBack: vi.fn()
		});
		const input = document.querySelector<HTMLInputElement>('#twofa-code')!;
		await fireEvent.input(input, { target: { value: '123 45x6' } });
		expect(input.value).toBe('123456');
		await fireEvent.keyDown(input, { key: 'Enter' });
		expect(onTotp).toHaveBeenCalledWith('123456');
	});

	it('explains a key prompt that closed and offers it again', async () => {
		const onWebauthn = mount(['webauthn', 'backupCode'], null, 'The browser closed the request.');
		const alert = screen.getByRole('alert');
		expect(alert.textContent).toContain('The browser closed the request.');
		await fireEvent.click(screen.getByRole('button', { name: 'Try again' }));
		expect(onWebauthn).toHaveBeenCalledTimes(2);
	});
});
