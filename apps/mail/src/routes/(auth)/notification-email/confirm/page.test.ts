import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render } from '@testing-library/svelte';
import { ApiCallError } from '$core/api/types';
import ConfirmPage from './+page.svelte';

const api = vi.hoisted(() => ({ confirmNotificationEmail: vi.fn() }));
vi.mock('$core/api/lifecycle', () => api);

const nav = vi.hoisted(() => ({ goto: vi.fn() }));
vi.mock('$app/navigation', () => nav);

const state = vi.hoisted(() => ({
	page: { url: new URL('https://app.test/notification-email/confirm?token=tok1') }
}));
vi.mock('$app/state', () => state);

function failure(status: number, code: string) {
	return new ApiCallError(status, { error: { code, message: code } }, code);
}

function text() {
	return document.body.textContent ?? '';
}

function button(label: string) {
	return [...document.querySelectorAll('button')].find((b) => b.textContent?.trim() === label);
}

async function confirm() {
	render(ConfirmPage);
	await fireEvent.click(button('Confirm this address')!);
}

beforeEach(() => {
	api.confirmNotificationEmail.mockReset();
	nav.goto.mockReset();
	state.page.url = new URL('https://app.test/notification-email/confirm?token=tok1');
});

afterEach(() => {
	cleanup();
});

describe('notification email confirm page', () => {
	it('waits for a click before confirming', () => {
		render(ConfirmPage);
		expect(text()).toContain('Thelemail will use this address only to reach you about the account itself');
		expect(api.confirmNotificationEmail).not.toHaveBeenCalled();
	});

	it('confirms the token from the link and offers the app', async () => {
		api.confirmNotificationEmail.mockResolvedValue({ alreadyConfirmed: false });
		await confirm();

		await vi.waitFor(() => expect(text()).toContain('Address confirmed'));
		expect(api.confirmNotificationEmail).toHaveBeenCalledWith('tok1');
		await fireEvent.click(button('Open Thelemail')!);
		expect(nav.goto).toHaveBeenCalledWith('/');
	});

	it('disables the button while confirming', async () => {
		api.confirmNotificationEmail.mockReturnValue(new Promise(() => {}));
		await confirm();

		await vi.waitFor(() => expect(button('Confirming…')?.disabled).toBe(true));
	});

	it('reports an address confirmed earlier', async () => {
		api.confirmNotificationEmail.mockResolvedValue({ alreadyConfirmed: true });
		await confirm();

		await vi.waitFor(() => expect(text()).toContain('This address was confirmed earlier.'));
		expect(button('Open Thelemail')).toBeDefined();
	});

	it.each([
		[410, 'confirmation_link_expired', 'This link has expired'],
		[404, 'confirmation_link_invalid', 'This link cannot be used']
	])('explains a %i %s', async (status, code, title) => {
		api.confirmNotificationEmail.mockRejectedValue(failure(status, code));
		await confirm();

		await vi.waitFor(() => expect(text()).toContain(title));
		expect(text()).not.toContain(code);
		expect(button('Open Thelemail')).toBeDefined();
	});

	it('allows a retry after an unexpected failure', async () => {
		api.confirmNotificationEmail.mockRejectedValueOnce(failure(500, 'internal_error'));
		api.confirmNotificationEmail.mockResolvedValueOnce({ alreadyConfirmed: false });
		await confirm();

		await vi.waitFor(() => expect(text()).toContain('The address was not confirmed.'));
		expect(button('Open Thelemail')).toBeUndefined();
		await fireEvent.click(button('Try again')!);

		await vi.waitFor(() => expect(text()).toContain('Address confirmed'));
		expect(api.confirmNotificationEmail).toHaveBeenCalledTimes(2);
	});

	it('explains a link without a token', () => {
		state.page.url = new URL('https://app.test/notification-email/confirm');
		render(ConfirmPage);

		expect(text()).toContain('This link did not work');
		expect(document.querySelector('button')).toBeNull();
		expect(api.confirmNotificationEmail).not.toHaveBeenCalled();
	});
});
