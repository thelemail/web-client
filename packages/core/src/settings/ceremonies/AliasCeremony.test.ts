import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { cleanup, render } from '@testing-library/svelte';
import AliasCeremony from './AliasCeremony.svelte';
import { customDomains } from '$core/stores/customDomains.svelte';
import { billing } from '$core/stores/billing.svelte';
import { aliases } from '$core/stores/aliases.svelte';
import type { CustomDomain } from '$core/api/customDomains';
import type { Subscription } from '$core/api/billing';
import type { SharedAlias } from '$core/api/aliases';
import { SHARED_DOMAIN } from '$core/settings/entitlements';

vi.mock('$core/keystore/keystore-client', () => ({ keystore: {} }));
vi.mock('$core/directory/lookup', () => ({ lookupDirectory: vi.fn() }));
vi.mock('$core/directory/verify', () => ({
	verifyDirectoryLookup: vi.fn(),
	DirectoryVerificationError: class extends Error {}
}));

const at = '2026-09-21T12:00:00Z';

type Stage = 'pending' | 'owned' | 'ready';

function domain(id: string, name: string, stage: Stage, over: Partial<CustomDomain> = {}): CustomDomain {
	const owned = stage !== 'pending';
	const sending = stage === 'ready';
	return {
		id,
		workspaceId: 'w1',
		domain: name,
		status: stage,
		addressCount: 0,
		ownershipVerifiedAt: owned ? at : null,
		dkimVerifiedAt: sending ? at : null,
		spfVerifiedAt: sending ? at : null,
		dmarcVerifiedAt: sending ? at : null,
		createdAt: at,
		updatedAt: at,
		...over
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
	it('refuses a preset domain whose sending records are not verified', () => {
		customDomains.items = [domain('d1', 'acme.test', 'owned')];
		const { container } = open('d1');

		expect(container.ownerDocument.body.textContent).toContain(
			'Addresses can be added once the sending records of this domain are verified.'
		);
		expect(selectValues(container)).toEqual([]);
		expect(container.ownerDocument.body.textContent).not.toContain(`@${SHARED_DOMAIN}`);
		expect(continueButton(container)?.disabled).toBe(true);
	});

	it('refuses a preset domain that nobody has verified', () => {
		customDomains.items = [domain('d1', 'acme.test', 'pending')];
		const { container } = open('d1');

		expect(selectValues(container)).toEqual([]);
		expect(continueButton(container)?.disabled).toBe(true);
	});

	it('locks the address to the preset domain once it can send', () => {
		customDomains.items = [domain('d0', 'other.test', 'ready'), domain('d1', 'acme.test', 'ready')];
		const { container } = open('d1');

		expect(selectValues(container)).toEqual([
			{ value: 'acme.test', options: ['acme.test'], disabled: true }
		]);
	});

	it('says the ownership record has to come back for a lapsing preset domain', () => {
		customDomains.items = [
			domain('d1', 'acme.test', 'ready', { ownershipMissingSince: at, releaseAt: '2026-09-23T12:00:00Z' })
		];
		const { container } = open('d1');

		expect(container.ownerDocument.body.textContent).toContain(
			'Addresses can be added again once the ownership record for this domain is restored.'
		);
		expect(selectValues(container)).toEqual([]);
		expect(continueButton(container)?.disabled).toBe(true);
	});
});

describe('AliasCeremony without a preset domain', () => {
	it('offers only domains that can send, plus the shared one', () => {
		customDomains.items = [domain('d0', 'other.test', 'ready'), domain('d1', 'acme.test', 'owned')];
		const { container } = open(null);

		expect(selectValues(container)).toEqual([
			{ value: 'other.test', options: ['other.test', SHARED_DOMAIN], disabled: false }
		]);
	});

	it('leaves paused domains out', () => {
		customDomains.items = [
			domain('d0', 'other.test', 'ready'),
			domain('d1', 'acme.test', 'ready', { dormantAt: at })
		];
		const { container } = open(null);

		expect(selectValues(container)[0].options).toEqual(['other.test', SHARED_DOMAIN]);
	});

	it('leaves domains with a missing ownership record out', () => {
		customDomains.items = [
			domain('d0', 'other.test', 'ready'),
			domain('d1', 'acme.test', 'ready', { ownershipMissingSince: at, releaseAt: '2026-09-23T12:00:00Z' })
		];
		const { container } = open(null);

		expect(selectValues(container)[0].options).toEqual(['other.test', SHARED_DOMAIN]);
	});

	it('asks for a domain that can send when none is left', () => {
		aliases.items = [{ id: 'al1', customDomainId: null } as SharedAlias];
		customDomains.items = [domain('d1', 'acme.test', 'owned')];
		const { container } = open(null);

		expect(container.ownerDocument.body.textContent).toContain(
			'You need a custom domain with verified sending records first.'
		);
		expect(selectValues(container)).toEqual([]);
	});
});
