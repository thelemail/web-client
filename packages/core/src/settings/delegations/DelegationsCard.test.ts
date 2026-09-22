import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { cleanup, render } from '@testing-library/svelte';
import type { AccountAddress } from '$core/api/addresses';
import type { Subscription } from '$core/api/billing';
import { billing } from '$core/stores/billing.svelte';
import DelegationsCard from './DelegationsCard.svelte';

vi.mock('$core/keystore/keystore-client', () => ({ keystore: {} }));
vi.mock('$core/api/delegations', () => ({
	listSigningDelegations: vi.fn().mockResolvedValue({ delegations: [] })
}));

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

function authorize(): HTMLButtonElement | undefined {
	return [...document.querySelectorAll('button')].find(
		(b) => b.textContent?.trim() === 'Authorize a service'
	);
}

const NOTE = 'New signing and forwarding can be set up once acme.co.uk is verified again.';

beforeEach(() => {
	billing.subscription = { planCode: 'business' } as Subscription;
});

afterEach(() => {
	cleanup();
	billing.subscription = null;
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
});
