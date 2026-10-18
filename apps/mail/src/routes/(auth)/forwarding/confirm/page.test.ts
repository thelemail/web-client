import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render } from '@testing-library/svelte';
import { ApiCallError, type ErrorCode } from '$core/api/types';
import ConfirmPage from './+page.svelte';

const api = vi.hoisted(() => ({ confirmForwarding: vi.fn() }));
vi.mock('$core/api/readDelegations', () => api);

const state = vi.hoisted(() => ({ page: { url: new URL('https://app.test/forwarding/confirm?token=tok1') } }));
vi.mock('$app/state', () => state);

function failure(status: number, code: ErrorCode) {
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
	await fireEvent.click(button('Confirm forwarding')!);
}

beforeEach(() => {
	api.confirmForwarding.mockReset();
	state.page.url = new URL('https://app.test/forwarding/confirm?token=tok1');
});

afterEach(() => {
	cleanup();
});

describe('forwarding confirm page', () => {
	it('waits for a click before confirming', () => {
		render(ConfirmPage);
		expect(text()).toContain('Confirm this destination');
		expect(button('Confirm forwarding')).toBeDefined();
		expect(api.confirmForwarding).not.toHaveBeenCalled();
	});

	it('confirms the token from the link', async () => {
		api.confirmForwarding.mockResolvedValue({ alreadyConfirmed: false });
		await confirm();

		await vi.waitFor(() => expect(text()).toContain('Forwarding confirmed'));
		expect(api.confirmForwarding).toHaveBeenCalledWith('tok1');
		expect(api.confirmForwarding).toHaveBeenCalledTimes(1);
		expect(document.querySelector('button')).toBeNull();
	});

	it('disables the button while confirming', async () => {
		api.confirmForwarding.mockReturnValue(new Promise(() => {}));
		await confirm();

		await vi.waitFor(() => expect(button('Confirming…')?.disabled).toBe(true));
	});

	it('reports a destination confirmed earlier', async () => {
		api.confirmForwarding.mockResolvedValue({ alreadyConfirmed: true });
		await confirm();

		await vi.waitFor(() => expect(text()).toContain('Already confirmed'));
	});

	it.each([
		[410, 'confirmation_link_expired', 'This link has expired'],
		[404, 'confirmation_link_invalid', 'This link cannot be used'],
		[400, 'invalid_request', 'This link cannot be used'],
		[409, 'forwarding_source_unavailable', 'This address is not receiving mail']
	] as const)('explains a %i %s', async (status, code, title) => {
		api.confirmForwarding.mockRejectedValue(failure(status, code));
		await confirm();

		await vi.waitFor(() => expect(text()).toContain(title));
		expect(text()).not.toContain(code);
		expect(document.querySelector('button')).toBeNull();
	});

	it('allows a retry after an unexpected failure', async () => {
		api.confirmForwarding.mockRejectedValueOnce(failure(500, 'internal_error'));
		api.confirmForwarding.mockResolvedValueOnce({ alreadyConfirmed: false });
		await confirm();

		await vi.waitFor(() => expect(text()).toContain('Something went wrong'));
		await fireEvent.click(button('Try again')!);

		await vi.waitFor(() => expect(text()).toContain('Forwarding confirmed'));
		expect(api.confirmForwarding).toHaveBeenCalledTimes(2);
	});

	it('treats a network failure as retryable', async () => {
		api.confirmForwarding.mockRejectedValue(new TypeError('Failed to fetch'));
		await confirm();

		await vi.waitFor(() => expect(text()).toContain('Something went wrong'));
		expect(button('Try again')).toBeDefined();
	});

	it('explains a link without a token', () => {
		state.page.url = new URL('https://app.test/forwarding/confirm');
		render(ConfirmPage);

		expect(text()).toContain('This link did not work');
		expect(document.querySelector('button')).toBeNull();
		expect(api.confirmForwarding).not.toHaveBeenCalled();
	});
});
