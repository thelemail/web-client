import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { cleanup, render } from '@testing-library/svelte';
import type {
	CustomDomain,
	CustomDomainCheck,
	CustomDomainCheckState
} from '$core/api/customDomains';
import type { Workspace, WorkspaceMember } from '$core/api/workspaces';
import { formatMoment } from '$core/i18n/relative';
import { customDomains } from '$core/stores/customDomains.svelte';
import { workspaces } from '$core/stores/workspaces.svelte';
import CustomDomains from './CustomDomains.svelte';
import type { CheckStage } from '$core/settings/domains/steps';

const api = vi.hoisted(() => ({
	listWorkspaceDomains: vi.fn(),
	createWorkspaceDomain: vi.fn(),
	getWorkspaceDomain: vi.fn(),
	startWorkspaceDomainCheck: vi.fn(),
	deleteWorkspaceDomain: vi.fn()
}));
vi.mock('$core/api/customDomains', () => api);

vi.mock('$app/state', () => ({ page: { params: { slot: '0' } } }));

const NOW = Date.parse('2026-09-22T12:00:00Z');
const MIN = 60_000;
const HOUR = 60 * MIN;
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
		status: 'pending',
		addressCount: 0,
		actionableStage: 'ownership',
		createdAt: at,
		updatedAt: at,
		...over
	};
}

function withCheck(
	d: CustomDomain,
	stage: CheckStage,
	state: CustomDomainCheckState,
	over: Partial<CustomDomainCheck> = {}
): CustomDomain {
	const running = state === 'running';
	return {
		...d,
		check: {
			stage,
			state,
			startedAt: running ? iso(-HOUR) : iso(-3 * DAY),
			deadlineAt: running ? iso(47 * HOUR) : iso(-DAY),
			attempts: 4,
			lastCheckedAt: running ? iso(-3 * MIN) : iso(-DAY),
			nextCheckAt: running ? iso(2 * MIN) : null,
			result: null,
			...over
		}
	};
}

const sendingFacets = { dkimVerifiedAt: at, spfVerifiedAt: at, dmarcVerifiedAt: at };

const fresh = domain();
const owned = domain({ status: 'owned', ownershipVerifiedAt: at, actionableStage: 'sending' });
const live = domain({
	status: 'active',
	ownershipVerifiedAt: at,
	...sendingFacets,
	mxVerifiedAt: at,
	lastCheckedAt: iso(-2 * HOUR),
	addressCount: 2,
	actionableStage: null
});
const lapsing = domain({
	...live,
	ownershipMissingSince: iso(-6 * HOUR),
	releaseAt: iso(42 * HOUR),
	actionableStage: 'ownership'
});

let visibility: DocumentVisibilityState = 'visible';

function show(next: DocumentVisibilityState) {
	visibility = next;
	document.dispatchEvent(new Event('visibilitychange'));
}

function open(...items: CustomDomain[]) {
	customDomains.items = items;
	return render(CustomDomains);
}

function text() {
	return document.body.textContent ?? '';
}

function stage(label: string) {
	return [...document.querySelectorAll('.cd-stage')].find(
		(s) => s.querySelector('.cd-stage-lbl')?.textContent?.trim() === label
	);
}

beforeEach(() => {
	vi.useFakeTimers({ now: NOW, toFake: ['setTimeout', 'clearTimeout', 'setInterval', 'clearInterval', 'Date'] });
	visibility = 'visible';
	Object.defineProperty(document, 'visibilityState', { configurable: true, get: () => visibility });
	for (const fn of Object.values(api)) fn.mockReset();
	api.listWorkspaceDomains.mockResolvedValue({ domains: [] });
	workspaces.setAccount('a1');
	workspaces.workspace = { id: 'w1', ownerAccountId: 'a1', name: 'Acme', type: 'business', createdAt: at, updatedAt: at } as Workspace;
	workspaces.members = [{ accountId: 'a1', role: 'owner' } as WorkspaceMember];
});

afterEach(() => {
	cleanup();
	vi.useRealTimers();
	customDomains.clear();
	workspaces.setAccount(null);
});

describe('CustomDomains list', () => {
	it('labels a domain that is being verified and says when it was last checked', () => {
		open(withCheck(fresh, 'ownership', 'running'));

		expect(document.querySelector('.cd-main')?.textContent).toContain('Verifying ownership');
		expect(text()).toContain(`Checking until ${formatMoment(iso(47 * HOUR))} · last check 3 minutes ago`);
		expect(stage('Ownership')?.classList.contains('run')).toBe(true);
	});

	it('keeps later pips off until sending is verified', () => {
		open(domain({ ...owned, mxVerifiedAt: at, addressCount: 2 }));

		const done = [...document.querySelectorAll('.cd-stage.done')].map((s) => s.textContent?.trim());
		expect(done).toEqual(['Ownership']);
	});

	it('explains the last check result instead of showing its code', () => {
		open(withCheck(owned, 'sending', 'running', { result: 'dkim_missing' }));

		expect(text()).not.toContain('dkim_missing');
		expect(document.querySelector('.cd-err')?.textContent).toBe('The last check did not find the DKIM records.');
	});

	it('falls back to the stored reason when no check window is left', () => {
		open(domain({ ...live, status: 'failed', dkimVerifiedAt: null, lastError: 'dkim_missing', actionableStage: 'sending' }));

		expect(document.querySelector('.cd-err')?.textContent).toBe('The last check did not find the DKIM records.');
	});

	it('drops a stale ownership reason once a window restores the record', () => {
		open(domain({ ...live, lastError: 'ownership_missing' }));

		expect(document.querySelector('.cd-err')).toBeNull();
	});

	it('drops a stale DKIM reason once sending verifies', () => {
		open(domain({ ...live, status: 'failed', mxVerifiedAt: null, lastError: 'dkim_missing', actionableStage: 'routing' }));

		expect(document.querySelector('.cd-err')).toBeNull();
	});

	it('shows a DNS outage only until the domain is live', () => {
		open(domain({ ...owned, lastError: 'dns_unavailable' }), { ...live, id: 'd2', domain: 'live.test', lastError: 'dns_unavailable' });

		const errs = [...document.querySelectorAll('.cd-row')].map((r) => r.querySelector('.cd-err')?.textContent ?? null);
		expect(errs[0]).toBeTruthy();
		expect(errs[1]).toBeNull();
	});

	it('says when checking stopped for an expired window', () => {
		open(withCheck(fresh, 'ownership', 'expired'));

		expect(document.querySelector('.cd-main')?.textContent).toContain('Check expired');
		expect(text()).toContain('Checking stopped yesterday');
	});

	it('shows the release date of a lapsing domain', () => {
		open(lapsing);

		expect(document.querySelector('.cd-main')?.textContent).toContain('Ownership record missing');
		expect(text()).toContain(`Restore the ownership record by ${formatMoment(iso(42 * HOUR))}`);
		expect(stage('Ownership')?.classList.contains('warn')).toBe(true);
		expect(stage('Ownership')?.classList.contains('done')).toBe(false);
	});

	it('tells members an owner or admin has to restore the ownership record', () => {
		workspaces.members = [{ accountId: 'a1', role: 'member' } as WorkspaceMember];
		open(lapsing);

		expect(text()).toContain(`An owner or admin needs to restore the ownership record by ${formatMoment(iso(42 * HOUR))}`);
		expect(text()).not.toContain('Restore the ownership record by');
	});

	it('reads a live domain as set up with a relative check time', () => {
		open(live);

		expect(text()).toContain('Checked 2 hours ago');
		expect(document.querySelector('.cd-row')?.classList.contains('live')).toBe(true);
	});

	it('polls the list only while a check runs and the tab is visible', async () => {
		api.listWorkspaceDomains.mockResolvedValue({ domains: [withCheck(fresh, 'ownership', 'running')] });
		open(withCheck(fresh, 'ownership', 'running'));

		await vi.advanceTimersByTimeAsync(60_000);
		expect(api.listWorkspaceDomains).toHaveBeenCalledTimes(1);
		expect(api.listWorkspaceDomains).toHaveBeenCalledWith('w1');

		show('hidden');
		await vi.advanceTimersByTimeAsync(3 * MIN);
		expect(api.listWorkspaceDomains).toHaveBeenCalledTimes(1);

		show('visible');
		await vi.advanceTimersByTimeAsync(0);
		expect(api.listWorkspaceDomains).toHaveBeenCalledTimes(2);
	});

	it('does not poll when no check is running', async () => {
		open(owned, { ...live, id: 'd2', domain: 'live.test' });

		await vi.advanceTimersByTimeAsync(5 * MIN);

		expect(api.listWorkspaceDomains).not.toHaveBeenCalled();
	});

	it('stops polling once the check ends', async () => {
		api.listWorkspaceDomains.mockResolvedValue({ domains: [owned] });
		open(withCheck(fresh, 'ownership', 'running'));

		await vi.advanceTimersByTimeAsync(60_000);
		await vi.advanceTimersByTimeAsync(5 * MIN);

		expect(api.listWorkspaceDomains).toHaveBeenCalledTimes(1);
	});
});
