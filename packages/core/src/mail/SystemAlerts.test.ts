import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { cleanup, render } from '@testing-library/svelte';
import type { CustomDomain } from '$core/api/customDomains';
import { formatMoment } from '$core/i18n/relative';
import { customDomains } from '$core/stores/customDomains.svelte';
import SystemAlerts from './SystemAlerts.svelte';

vi.mock('$app/state', () => ({ page: { params: { slot: '0' } } }));

const perm = vi.hoisted(() => ({ manage: true }));
vi.mock('$core/settings/permissions', () => ({
	canManageWorkspace: () => perm.manage,
	isWorkspaceOwner: () => perm.manage
}));

const NOW = Date.parse('2026-09-22T12:00:00Z');
const HOUR = 3_600_000;
const DAY = 24 * HOUR;

function iso(offsetMs: number): string {
	return new Date(NOW + offsetMs).toISOString();
}

const at = iso(-2 * DAY);

function domain(over: Partial<CustomDomain> = {}): CustomDomain {
	return {
		id: 'd1',
		workspaceId: 'w1',
		domain: 'acme.test',
		status: 'active',
		ownershipVerifiedAt: at,
		dkimVerifiedAt: at,
		spfVerifiedAt: at,
		dmarcVerifiedAt: at,
		mxVerifiedAt: at,
		addressCount: 2,
		actionableStage: null,
		createdAt: at,
		updatedAt: at,
		...over
	};
}

const lapsing = domain({
	ownershipMissingSince: iso(-6 * HOUR),
	releaseAt: iso(42 * HOUR),
	actionableStage: 'ownership'
});
const sendingLost = domain({ status: 'failed', dkimVerifiedAt: null, actionableStage: 'sending' });

function open(...items: CustomDomain[]) {
	customDomains.items = items;
	return render(SystemAlerts);
}

function text() {
	return document.body.textContent ?? '';
}

function links() {
	return [...document.querySelectorAll('a.sa-act')].map((a) => a.getAttribute('href'));
}

beforeEach(() => {
	vi.useFakeTimers({ now: NOW, toFake: ['Date'] });
	perm.manage = true;
});

afterEach(() => {
	cleanup();
	vi.useRealTimers();
	customDomains.clear();
});

describe('SystemAlerts domains', () => {
	it('warns managers about a missing ownership record and links to the ownership step', () => {
		open(lapsing);

		expect(text()).toContain('Domain ownership record missing.');
		expect(text()).toContain(`Restore it by ${formatMoment(iso(42 * HOUR))}, or the domain will be released`);
		expect(document.querySelector('.sa-d .mono')?.textContent).toBe('acme.test');
		expect(links()).toEqual(['/u/0/settings/domains/d1?step=ownership']);
	});

	it('tells members who needs to act', () => {
		perm.manage = false;
		open(lapsing);

		expect(text()).toContain(`An owner or admin needs to restore it by ${formatMoment(iso(42 * HOUR))}`);
		expect(text()).not.toContain('Restore record');
		expect(links()).toEqual([]);
	});

	it('warns about each lapsing domain on its own', () => {
		open(lapsing, { ...lapsing, id: 'd2', domain: 'other.test' });

		expect(links()).toEqual([
			'/u/0/settings/domains/d1?step=ownership',
			'/u/0/settings/domains/d2?step=ownership'
		]);
	});

	it('shows only the lapse warning for a failing domain whose ownership record is missing', () => {
		open(domain({ ...lapsing, status: 'failed' }));

		expect(text()).not.toContain('DNS check failing.');
		expect(links()).toEqual(['/u/0/settings/domains/d1?step=ownership']);
	});

	it('sends a failing domain to the step that needs attention', () => {
		open(sendingLost);

		expect(text()).toContain('DNS check failing.');
		expect(links()).toEqual(['/u/0/settings/domains/d1?step=sending']);
	});

	it('stays quiet about paused domains', () => {
		open(domain({ ...sendingLost, dormantAt: iso(-DAY) }));

		expect(document.querySelector('.sysalerts')).toBeNull();
	});
});
