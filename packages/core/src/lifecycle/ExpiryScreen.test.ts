import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render } from '@testing-library/svelte';

const markExpiryScreenShown = vi.hoisted(() => vi.fn());
const goto = vi.hoisted(() => vi.fn(async () => {}));

vi.mock('$core/api/lifecycle', () => ({ markExpiryScreenShown }));
vi.mock('$app/navigation', () => ({ goto }));
vi.mock('$app/state', () => ({ page: { params: { slot: '0' } } }));
vi.mock('$core/stores/auth.svelte', () => ({ auth: { accountId: 'acc-1', loadProfile: vi.fn(async () => {}) } }));
vi.mock('$core/stores/billing.svelte', () => ({ billing: { subscription: null } }));
vi.mock('./lifecycle.svelte', () => ({ lifecycle: { markRestoreOrigin: vi.fn() } }));
vi.mock('./PersonalTimeline.svelte', () => ({ default: () => {} }));

import ExpiryScreen from './ExpiryScreen.svelte';

const ctx = { retentionDays: 30 } as never;

beforeEach(() => {
	markExpiryScreenShown.mockReset();
	goto.mockClear();
});

afterEach(() => cleanup());

describe('expiry screen actions', () => {
	it('stays put and says so when the server call fails', async () => {
		markExpiryScreenShown.mockRejectedValue(new Error('down'));
		const { getByRole, findByRole } = render(ExpiryScreen, { props: { ctx } });

		await fireEvent.click(getByRole('button', { name: /read-only/i }));

		expect(await findByRole('alert')).toBeTruthy();
		expect(goto).not.toHaveBeenCalled();
	});

	it('disables every action while one is running', async () => {
		const gate = Promise.withResolvers<void>();
		markExpiryScreenShown.mockReturnValue(gate.promise);
		const { getByRole, getAllByRole } = render(ExpiryScreen, { props: { ctx } });

		await fireEvent.click(getByRole('button', { name: /read-only/i }));

		expect(getAllByRole('button').every((b) => (b as HTMLButtonElement).disabled)).toBe(true);
		gate.resolve();
		await vi.waitFor(() => expect(goto).toHaveBeenCalledWith('/u/0/mail/inbox'));
	});
});
