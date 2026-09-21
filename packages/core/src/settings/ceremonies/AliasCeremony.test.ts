import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { cleanup, render } from '@testing-library/svelte';
import AliasCeremony from './AliasCeremony.svelte';
import { customDomains } from '$core/stores/customDomains.svelte';
import { billing } from '$core/stores/billing.svelte';
import { aliases } from '$core/stores/aliases.svelte';
import type { CustomDomain } from '$core/api/customDomains';
import type { Subscription } from '$core/api/billing';
import { SHARED_DOMAIN } from '$core/settings/entitlements';

vi.mock('$core/keystore/keystore-client', () => ({ keystore: {} }));
vi.mock('$core/directory/lookup', () => ({ lookupDirectory: vi.fn() }));
vi.mock('$core/directory/verify', () => ({
	verifyDirectoryLookup: vi.fn(),
	DirectoryVerificationError: class extends Error {}
}));

const at = '2026-09-21T12:00:00Z';

function domain(id: string, name: string, owned: boolean): CustomDomain {
	return {
		id,
		workspaceId: 'w1',
		domain: name,
		status: owned ? 'owned' : 'pending',
		addressCount: 0,
		ownershipVerifiedAt: owned ? at : null,
		createdAt: at,
		updatedAt: at
	};
}

function open(presetDomainId: string | null) {
	return render(AliasCeremony, {
		props: { mode: 'create', presetDomainId, onClose: () => {}, onComplete: () => {} }
	});
}

function selectValues(container: HTMLElement) {
	return [...container.ownerDocument.querySelectorAll('select')].map((s) => ({
		value: s.value,
		options: [...s.options].map((o) => o.value),
		disabled: s.disabled
	}));
}

function continueButton(container: HTMLElement) {
	return [...container.ownerDocument.querySelectorAll('button')].find(
		(b) => b.textContent?.trim() === 'Continue'
	);
}

beforeEach(() => {
	billing.subscription = { planCode: 'business' } as Subscription;
	aliases.items = [];
});

afterEach(() => {
	cleanup();
	customDomains.clear();
	billing.subscription = null;
});

describe('AliasCeremony with a preset domain', () => {
	it('refuses to fall back to another domain when the preset is unverified', () => {
		customDomains.items = [domain('d1', 'acme.test', false)];
		const { container } = open('d1');

		expect(container.ownerDocument.body.textContent).toContain(
			'Addresses can be added once ownership of this domain is verified.'
		);
		expect(selectValues(container)).toEqual([]);
		expect(container.ownerDocument.body.textContent).not.toContain(`@${SHARED_DOMAIN}`);
		expect(continueButton(container)?.disabled).toBe(true);
	});

	it('locks the address to the preset domain when it is verified', () => {
		customDomains.items = [domain('d0', 'other.test', true), domain('d1', 'acme.test', true)];
		const { container } = open('d1');

		expect(selectValues(container)).toEqual([
			{ value: 'acme.test', options: ['acme.test'], disabled: true }
		]);
	});

	it('still offers every owned domain and the shared one without a preset', () => {
		customDomains.items = [domain('d0', 'other.test', true), domain('d1', 'acme.test', false)];
		const { container } = open(null);

		expect(selectValues(container)).toEqual([
			{ value: 'other.test', options: ['other.test', SHARED_DOMAIN], disabled: false }
		]);
	});
});
