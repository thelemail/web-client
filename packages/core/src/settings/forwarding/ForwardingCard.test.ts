import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, waitFor } from '@testing-library/svelte';
import type { ReadDelegation } from '$core/api/readDelegations';
import type { Subscription } from '$core/api/billing';
import { billing } from '$core/stores/billing.svelte';
import ForwardingCard from './ForwardingCard.svelte';

const api = vi.hoisted(() => ({ listReadDelegations: vi.fn() }));
vi.mock('$core/api/readDelegations', () => api);
vi.mock('$core/keystore/keystore-client', () => ({ keystore: {} }));
vi.mock('./authorize', () => ({ prepareForwarding: vi.fn() }));

const at = '2026-09-21T12:00:00Z';

function delegation(id: string, over: Partial<ReadDelegation>): ReadDelegation {
	return {
		id,
		addressId: 'x',
		address: 'sales@acme.co.uk',
		label: id,
		destination: `${id}@example.org`,
		mode: 'encrypted',
		state: 'active',
		encryptionKeyFingerprint: 'abcdabcdabcdabcdabcd',
		notBefore: at,
		createdAt: at,
		recent: [],
		...over
	};
}

function button(label: string): HTMLButtonElement[] {
	return [...document.querySelectorAll('button')].filter((b) => b.textContent?.trim() === label);
}

const NOTE = 'New signing and forwarding can be set up once acme.co.uk is verified again.';

beforeEach(() => {
	billing.subscription = { planCode: 'business' } as Subscription;
	api.listReadDelegations.mockResolvedValue({
		readDelegations: [
			delegation('Archive', { state: 'active' }),
			delegation('Backup', { state: 'paused' }),
			delegation('Ledger', { state: 'pending_verification' })
		]
	});
});

afterEach(() => {
	cleanup();
	billing.subscription = null;
});

async function mount(addressId: string, blocked?: string) {
	render(ForwardingCard, { props: { addressId, email: 'sales@acme.co.uk', blocked } });
	await waitFor(() => expect(button('Pause')).toHaveLength(1));
}

async function menuText(): Promise<string> {
	const row = [...document.querySelectorAll<HTMLElement>('.rec-row')].find((r) =>
		r.textContent?.includes('Archive')
	)!;
	await fireEvent.click(row.querySelector('.rowmenu')!);
	return row.querySelector('.addr-menu')?.textContent ?? '';
}

describe('ForwardingCard', () => {
	it('keeps pause and turn off while new forwarding is on hold', async () => {
		await mount('blocked', NOTE);
		expect(document.querySelector('.card-note')?.textContent).toContain(NOTE);
		expect(button('Forward to a system')[0].disabled).toBe(true);
		expect(button('Send link again')[0].disabled).toBe(true);
		expect(button('Resume')[0].disabled).toBe(true);
		expect(button('Pause')[0].disabled).toBe(false);
		const menu = await menuText();
		expect(menu).toContain('Turn off');
		expect(menu).not.toContain('Replace the key');
	});

	it('offers every action on a live address', async () => {
		await mount('live');
		expect(document.querySelector('.card-note')).toBeNull();
		expect(button('Forward to a system')[0].disabled).toBe(false);
		expect(button('Send link again')[0].disabled).toBe(false);
		expect(button('Resume')[0].disabled).toBe(false);
		const menu = await menuText();
		expect(menu).toContain('Turn off');
		expect(menu).toContain('Replace the key');
	});
});
