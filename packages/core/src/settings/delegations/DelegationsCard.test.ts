import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { cleanup, render, screen } from '@testing-library/svelte';
import type { AccountAddress } from '$core/api/addresses';
import type { Subscription } from '$core/api/billing';
import type { SigningDelegation } from '$core/api/delegations';
import { billing } from '$core/stores/billing.svelte';
import DelegationsCard from './DelegationsCard.svelte';

vi.mock('$core/keystore/keystore-client', () => ({ keystore: {} }));
const { listSigningDelegations } = vi.hoisted(() => ({
	listSigningDelegations: vi.fn()
}));

vi.mock('$core/api/delegations', () => ({ listSigningDelegations }));

const at = '2026-09-21T12:00:00Z';

function address(id: string): AccountAddress {
	return {
		id,
		accountId: 'me',
		email: 'sales@acme.co.uk',
		localPart: 'sales',
		customDomainId: 'd1',
		isPrimary: false,
		createdAt: at,
		updatedAt: at
	};
}

function delegation(id: string, label: string, notAfter: string, revokedAt?: string): SigningDelegation {
	return {
		id,
		addressId: 's3',
		address: 'sales@acme.co.uk',
		label,
		signerFingerprint: 'AB12CD34EF56AB12CD34EF56AB12CD34EF56AB12',
		keyAlgorithm: 'ed25519',
		publicKeyArmored: '',
		notBefore: '2026-01-01T00:00:00Z',
		notAfter,
		revokedAt: revokedAt ?? null,
		createdAt: '2026-01-01T00:00:00Z'
	};
}

function row(label: string): HTMLElement {
	const el = screen.getByText(label).closest('.rec-row');
	if (!(el instanceof HTMLElement)) throw new Error(`no row for ${label}`);
	return el;
}

function revokeButton(el: HTMLElement): HTMLButtonElement | undefined {
	return [...el.querySelectorAll('button')].find((b) => b.textContent?.trim() === 'Revoke');
}

function authorize(): HTMLButtonElement | undefined {
	return [...document.querySelectorAll('button')].find(
		(b) => b.textContent?.trim() === 'Authorize a service'
	);
}

const NOTE = 'New signing and forwarding can be set up once acme.co.uk is verified again.';

beforeEach(() => {
	billing.subscription = { planCode: 'business' } as Subscription;
	listSigningDelegations.mockResolvedValue({ delegations: [] });
});

afterEach(() => {
	cleanup();
	billing.subscription = null;
	vi.useRealTimers();
});

describe('DelegationsCard', () => {
	it('holds back new signing while setup is blocked and says why', () => {
		render(DelegationsCard, { props: { address: address('s1'), blocked: NOTE } });
		expect(authorize()?.disabled).toBe(true);
		expect(document.querySelector('.card-note')?.textContent).toContain(NOTE);
	});

	it('lets a live address authorize a service', () => {
		render(DelegationsCard, { props: { address: address('s2') } });
		expect(authorize()?.disabled).toBe(false);
		expect(document.querySelector('.card-note')).toBeNull();
	});

	it('treats a delegation past notAfter as expired', async () => {
		vi.useFakeTimers({ toFake: ['Date'] });
		vi.setSystemTime(at);
		listSigningDelegations.mockResolvedValueOnce({
			delegations: [
				delegation('a', 'Billing', '2027-09-21T12:00:00Z'),
				delegation('b', 'Newsletter', '2026-08-01T12:00:00Z'),
				delegation('c', 'Helpdesk', '2027-09-21T12:00:00Z', '2026-09-01T12:00:00Z'),
				delegation('d', 'Receipts', at)
			]
		});
		render(DelegationsCard, { props: { address: address('s3') } });
		await screen.findByText('Billing');

		expect(document.querySelector('.card-meta')?.textContent?.trim()).toBe('1 active');

		const live = row('Billing');
		expect(live.querySelector('.b-ok')?.textContent).toContain('Active');
		expect(live.textContent).toContain('Expires Sep 21, 2027');
		expect(revokeButton(live)).toBeDefined();

		const expired = row('Newsletter');
		expect(expired.querySelector('.b-ok')).toBeNull();
		expect(expired.querySelector('.badge')?.textContent).toContain('Expired');
		expect(expired.textContent).toContain('Expired Aug 1, 2026');
		expect(revokeButton(expired)).toBeUndefined();

		const revoked = row('Helpdesk');
		expect(revoked.querySelector('.b-warn')?.textContent).toContain('Revoked');
		expect(revokeButton(revoked)).toBeUndefined();

		const boundary = row('Receipts');
		expect(boundary.querySelector('.b-ok')).toBeNull();
		expect(boundary.textContent).toContain('Expired Sep 21, 2026');
		expect(revokeButton(boundary)).toBeUndefined();
	});
});
