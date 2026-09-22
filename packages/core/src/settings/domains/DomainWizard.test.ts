import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render } from '@testing-library/svelte';
import type {
	CustomDomain,
	CustomDomainCheck,
	CustomDomainCheckState,
	CustomDomainWithRecords
} from '$core/api/customDomains';
import type { AccountAddress } from '$core/api/addresses';
import type { Workspace } from '$core/api/workspaces';
import { ApiCallError } from '$core/api/types';
import { formatMoment } from '$core/i18n/relative';
import { customDomains } from '$core/stores/customDomains.svelte';
import { addresses } from '$core/stores/addresses.svelte';
import { workspaceAddresses } from '$core/stores/workspaceAddresses.svelte';
import { workspaces } from '$core/stores/workspaces.svelte';
import DomainWizard from './DomainWizard.svelte';
import type { CheckStage, DomainStep } from './steps';

const api = vi.hoisted(() => ({
	listWorkspaceDomains: vi.fn(),
	createWorkspaceDomain: vi.fn(),
	getWorkspaceDomain: vi.fn(),
	startWorkspaceDomainCheck: vi.fn(),
	deleteWorkspaceDomain: vi.fn()
}));
vi.mock('$core/api/customDomains', () => api);

const perm = vi.hoisted(() => ({ manage: true }));
vi.mock('../permissions', () => ({
	canManageWorkspace: () => perm.manage,
	isWorkspaceOwner: () => perm.manage
}));

vi.mock('$core/keystore/keystore-client', () => ({ keystore: {} }));
vi.mock('$core/directory/lookup', () => ({ lookupDirectory: vi.fn() }));
vi.mock('$core/directory/verify', () => ({
	verifyDirectoryLookup: vi.fn(),
	DirectoryVerificationError: class extends Error {}
}));

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
const ready = domain({ status: 'ready', ownershipVerifiedAt: at, ...sendingFacets, actionableStage: null });
const readyWithAddresses = domain({ ...ready, addressCount: 2, actionableStage: 'routing' });
const live = domain({
	status: 'active',
	ownershipVerifiedAt: at,
	...sendingFacets,
	mxVerifiedAt: at,
	addressCount: 2,
	actionableStage: null
});
const sendingLost = domain({ ...live, status: 'failed', dkimVerifiedAt: null, actionableStage: 'sending' });
const lapsing = domain({
	...live,
	ownershipMissingSince: iso(-6 * HOUR),
	releaseAt: iso(42 * HOUR),
	actionableStage: 'ownership'
});
const pausedOwned = domain({ ...owned, dormantAt: iso(-DAY), actionableStage: null });

function withRecords(d: CustomDomain): CustomDomainWithRecords {
	return { domain: d, records: [] };
}

function address(email: string, customDomainId: string | null): AccountAddress {
	return {
		id: email,
		accountId: 'a2',
		email,
		localPart: email.split('@')[0],
		customDomainId,
		isPrimary: false,
		createdAt: at,
		updatedAt: at
	};
}

let visibility: DocumentVisibilityState = 'visible';

function show(next: DocumentVisibilityState) {
	visibility = next;
	document.dispatchEvent(new Event('visibilitychange'));
}

function open(d: CustomDomain, step: DomainStep) {
	customDomains.items = [d];
	const view = render(DomainWizard, {
		props: { domain: d, records: [], step, listHref: '/u/0/settings/domains', onStep: vi.fn() }
	});
	return {
		...view,
		sync: () => view.rerender({ domain: customDomains.items[0] })
	};
}

function text() {
	return document.body.textContent ?? '';
}

function button(label: string) {
	return [...document.querySelectorAll('button')].find((b) => b.textContent?.trim() === label);
}

function railStep(label: string) {
	return [...document.querySelectorAll('.dw-rail .dw-step')].find((b) =>
		b.querySelector('.dw-lbl')?.textContent?.trim() === label
	);
}

beforeEach(() => {
	vi.useFakeTimers({ now: NOW, toFake: ['setTimeout', 'clearTimeout', 'setInterval', 'clearInterval', 'Date'] });
	visibility = 'visible';
	Object.defineProperty(document, 'visibilityState', { configurable: true, get: () => visibility });
	perm.manage = true;
	for (const fn of Object.values(api)) fn.mockReset();
	workspaces.workspace = { id: 'w1', ownerAccountId: 'a1', name: 'Acme', type: 'business', createdAt: at, updatedAt: at } as Workspace;
	addresses.items = [];
	workspaceAddresses.items = [];
});

afterEach(() => {
	cleanup();
	vi.useRealTimers();
	customDomains.clear();
	workspaces.workspace = null;
	addresses.items = [];
	workspaceAddresses.items = [];
});

describe('DomainWizard checks', () => {
	it('does not start a check when the wizard opens', async () => {
		open(fresh, 'ownership');
		await vi.advanceTimersByTimeAsync(5 * MIN);

		expect(api.startWorkspaceDomainCheck).not.toHaveBeenCalled();
		expect(api.getWorkspaceDomain).not.toHaveBeenCalled();
		expect(button('Check DNS')).toBeDefined();
		expect(text()).toContain('then press Check DNS');
	});

	it('starts one check per press and then shows progress instead of the button', async () => {
		let resolve: (v: CustomDomainWithRecords) => void = () => {};
		api.startWorkspaceDomainCheck.mockReturnValue(new Promise((r) => (resolve = r)));
		const view = open(fresh, 'ownership');

		const press = button('Check DNS')!;
		await fireEvent.click(press);
		await fireEvent.click(press);
		expect(api.startWorkspaceDomainCheck).toHaveBeenCalledTimes(1);
		expect(api.startWorkspaceDomainCheck).toHaveBeenCalledWith('w1', 'd1', 'ownership');

		const started = withCheck(fresh, 'ownership', 'running', {
			startedAt: iso(0),
			lastCheckedAt: iso(0),
			nextCheckAt: iso(5 * MIN),
			deadlineAt: iso(2 * DAY),
			attempts: 1,
			result: 'ownership_missing'
		});
		resolve(withRecords(started));
		await vi.advanceTimersByTimeAsync(0);
		await view.sync();

		expect(button('Check DNS')).toBeUndefined();
		expect(button('Checking…')).toBeUndefined();
		expect(text()).toContain('Ownership verification in progress.');
		expect(text()).toContain('Last checked just now.');
		expect(text()).toContain('Next check in 5 minutes.');
		expect(text()).toContain(`We keep checking until ${formatMoment(iso(2 * DAY))}.`);
		expect(text()).toContain('The last check did not find the ownership TXT record.');
		expect(button('Continue')?.disabled).toBe(true);
	});

	it('moves the relative times along while the page stays open', async () => {
		open(withCheck(fresh, 'ownership', 'running', { lastCheckedAt: iso(0), nextCheckAt: iso(5 * MIN) }), 'ownership');
		api.getWorkspaceDomain.mockResolvedValue(withRecords(fresh));

		await vi.advanceTimersByTimeAsync(3 * MIN);

		expect(text()).toContain('Last checked 3 minutes ago.');
		expect(text()).toContain('Next check in 2 minutes.');
	});

	it('moves on when the first check already finds the record', async () => {
		api.startWorkspaceDomainCheck.mockResolvedValue(withRecords(owned));
		const view = open(fresh, 'ownership');

		await fireEvent.click(button('Check DNS')!);
		await view.sync();

		expect(text()).toContain('Ownership confirmed.');
		expect(button('Check DNS')).toBeUndefined();
		expect(button('Continue')?.disabled).toBe(false);
	});

	it('keeps Continue disabled on sending until the sending records are verified', async () => {
		const view = open(withCheck(owned, 'sending', 'running'), 'sending');
		expect(button('Continue')?.disabled).toBe(true);
		expect(button('Check DNS')).toBeUndefined();
		expect(text()).toContain('Sending records verification in progress.');

		customDomains.items = [ready];
		await view.sync();

		expect(button('Continue')?.disabled).toBe(false);
		expect(text()).toContain('Sending records confirmed.');
	});

	it('keeps Continue disabled on an idle step that is not verified', () => {
		open(owned, 'sending');

		expect(button('Check DNS')).toBeDefined();
		expect(button('Continue')?.disabled).toBe(true);
	});

	it('polls the domain only while a check runs and the tab is visible', async () => {
		const running = withCheck(fresh, 'ownership', 'running');
		api.getWorkspaceDomain.mockResolvedValue(withRecords(running));
		open(running, 'ownership');

		await vi.advanceTimersByTimeAsync(30_000);
		expect(api.getWorkspaceDomain).toHaveBeenCalledTimes(1);
		expect(api.getWorkspaceDomain).toHaveBeenCalledWith('w1', 'd1');
		await vi.advanceTimersByTimeAsync(30_000);
		expect(api.getWorkspaceDomain).toHaveBeenCalledTimes(2);

		show('hidden');
		await vi.advanceTimersByTimeAsync(90_000);
		expect(api.getWorkspaceDomain).toHaveBeenCalledTimes(2);

		show('visible');
		await vi.advanceTimersByTimeAsync(0);
		expect(api.getWorkspaceDomain).toHaveBeenCalledTimes(3);
		expect(api.startWorkspaceDomainCheck).not.toHaveBeenCalled();
	});

	it('stops polling once the check is over', async () => {
		const running = withCheck(fresh, 'ownership', 'running');
		api.getWorkspaceDomain.mockResolvedValue(withRecords(owned));
		const view = open(running, 'ownership');

		await vi.advanceTimersByTimeAsync(30_000);
		expect(api.getWorkspaceDomain).toHaveBeenCalledTimes(1);
		await view.sync();

		await vi.advanceTimersByTimeAsync(120_000);
		expect(api.getWorkspaceDomain).toHaveBeenCalledTimes(1);
	});

	it('does not poll when no check is running', async () => {
		open(fresh, 'ownership');
		await vi.advanceTimersByTimeAsync(120_000);

		expect(api.getWorkspaceDomain).not.toHaveBeenCalled();
	});

	it('offers one new press after the window expires', async () => {
		const expired = withCheck(fresh, 'ownership', 'expired', { result: 'ownership_mismatch' });
		api.startWorkspaceDomainCheck.mockResolvedValue(withRecords(withCheck(fresh, 'ownership', 'running')));
		const view = open(expired, 'ownership');

		expect(text()).toContain(`We stopped checking on ${formatMoment(iso(-DAY))}`);
		expect(text()).toContain('press Check DNS to try again');
		expect(text()).toContain('its value does not match');
		expect(document.querySelectorAll('button')).toSatisfy((list: NodeListOf<HTMLButtonElement>) =>
			[...list].filter((b) => b.textContent?.trim() === 'Check DNS').length === 1
		);

		await fireEvent.click(button('Check DNS')!);
		await view.sync();

		expect(api.startWorkspaceDomainCheck).toHaveBeenCalledTimes(1);
		expect(button('Check DNS')).toBeUndefined();
		expect(text()).toContain('Ownership verification in progress.');
	});
});

describe('DomainWizard for members', () => {
	it('shows members the progress but no button', async () => {
		perm.manage = false;
		const idle = open(fresh, 'ownership');
		expect(text()).toContain('an owner or admin can start the DNS check here');
		expect(button('Check DNS')).toBeUndefined();
		idle.unmount();

		const running = withCheck(fresh, 'ownership', 'running');
		api.getWorkspaceDomain.mockResolvedValue(withRecords(running));
		open(running, 'ownership');
		expect(text()).toContain('Ownership verification in progress.');
		expect(button('Check DNS')).toBeUndefined();

		await vi.advanceTimersByTimeAsync(30_000);
		expect(api.getWorkspaceDomain).toHaveBeenCalledTimes(1);
		expect(api.startWorkspaceDomainCheck).not.toHaveBeenCalled();
	});

	it('tells members who can restart an expired check', () => {
		perm.manage = false;
		open(withCheck(fresh, 'ownership', 'expired'), 'ownership');

		expect(text()).toContain('An owner or admin can start a new check.');
		expect(button('Check DNS')).toBeUndefined();
	});

	it('tells members an owner or admin has to restore a missing ownership record', () => {
		perm.manage = false;
		open(lapsing, 'ownership');

		expect(text()).toContain(`has been missing since ${formatMoment(iso(-6 * HOUR))}`);
		expect(text()).toContain(`An owner or admin needs to restore it by ${formatMoment(iso(42 * HOUR))}`);
		expect(text()).not.toContain('Restore it by');
	});

	it('tells members an owner or admin has to upgrade a paused domain', () => {
		perm.manage = false;
		open(pausedOwned, 'sending');

		expect(text()).toContain('Setup continues when an owner or admin upgrades the workspace.');
		expect(text()).not.toContain('Keep the ownership record in place');
	});

	it('keeps the add address button off for members', () => {
		perm.manage = false;
		open(ready, 'recipients');

		expect(button('Add an address')?.disabled).toBe(true);
	});
});

describe('DomainWizard states', () => {
	it('warns about a missing ownership record with the release date', () => {
		open(lapsing, 'ownership');

		expect(text()).toContain(`has been missing since ${formatMoment(iso(-6 * HOUR))}`);
		expect(text()).toContain(`Restore it by ${formatMoment(iso(42 * HOUR))}`);
		expect(button('Check DNS')).toBeDefined();
		expect(text()).not.toContain('Ownership confirmed.');
	});

	it('explains that another workspace holds the domain', () => {
		open(withCheck(fresh, 'ownership', 'running', { result: 'claimed_elsewhere' }), 'ownership');

		expect(text()).toContain('Another workspace has already verified this domain.');
		expect(text()).toContain('Ownership verification in progress.');
	});

	it('refreshes instead of showing an error when a check is refused', async () => {
		api.startWorkspaceDomainCheck.mockRejectedValue(
			new ApiCallError(409, { error: { code: 'conflict', message: 'check already running' } }, 'check already running')
		);
		api.getWorkspaceDomain.mockResolvedValue(withRecords(withCheck(fresh, 'ownership', 'running')));
		const view = open(fresh, 'ownership');

		await fireEvent.click(button('Check DNS')!);
		await vi.advanceTimersByTimeAsync(0);
		await view.sync();

		expect(api.getWorkspaceDomain).toHaveBeenCalledWith('w1', 'd1');
		expect(text()).not.toContain('Could not start');
		expect(text()).not.toContain('check already running');
		expect(text()).toContain('Ownership verification in progress.');
	});

	it('says when checks can start again after a rate limit', async () => {
		api.startWorkspaceDomainCheck.mockRejectedValue(
			new ApiCallError(429, { error: { code: 'rate_limited', message: 'slow down', retryAfterSeconds: 600 } }, 'slow down')
		);
		api.getWorkspaceDomain.mockResolvedValue(withRecords(fresh));
		open(fresh, 'ownership');

		await fireEvent.click(button('Check DNS')!);
		await vi.advanceTimersByTimeAsync(0);

		expect(text()).toContain('Try again in 10 minutes.');
		expect(text()).not.toContain('slow down');
	});

	it('hides the check on a paused domain', () => {
		open(pausedOwned, 'sending');

		expect(text()).toContain('This domain is paused while the workspace is on the free plan.');
		expect(button('Check DNS')).toBeUndefined();
		expect(text()).not.toContain('then press Check DNS');
	});

	it('counts every workspace address on the recipients step for managers', () => {
		workspaceAddresses.items = [address('bob@acme.test', 'd1'), address('eve@other.test', 'd2')];
		open(readyWithAddresses, 'recipients');

		expect(text()).toContain('bob@acme.test');
		expect(text()).not.toContain('eve@other.test');
		expect(text()).not.toContain('No addresses on this domain yet.');
	});

	it('tells members how many addresses exist when it cannot list them', () => {
		perm.manage = false;
		workspaceAddresses.items = [address('bob@acme.test', 'd1')];
		open(readyWithAddresses, 'recipients');

		expect(text()).not.toContain('bob@acme.test');
		expect(text()).not.toContain('No addresses on this domain yet.');
		expect(text()).toContain('2 addresses');
	});

	it('marks the step whose check is running on the rail', () => {
		open(withCheck(owned, 'sending', 'running'), 'ownership');

		expect(railStep('Sending')?.classList.contains('run')).toBe(true);
		expect(railStep('Ownership')?.classList.contains('run')).toBe(false);
	});

	it("shows a live domain's missing record only on its own step", async () => {
		const lost = domain({ ...sendingLost, lastError: 'dkim_missing' });
		const view = open(lost, 'sending');
		expect(text()).toContain('The last check did not find the DKIM records.');
		expect(text()).not.toContain('dkim_missing');

		await view.rerender({ step: 'ownership' });
		expect(text()).not.toContain('The last check did not find the DKIM records.');
	});

	it('drops a stale ownership reason once a window restores the record', () => {
		open(domain({ ...live, lastError: 'ownership_missing' }), 'ownership');

		expect(text()).toContain('Ownership confirmed.');
		expect(text()).not.toContain('The last check did not find the ownership TXT record.');
		expect(document.querySelector('.dw-note.warn')).toBeNull();
	});

	it('drops a stale DKIM reason once sending verifies', () => {
		open(domain({ ...live, status: 'failed', mxVerifiedAt: null, lastError: 'dkim_missing', actionableStage: 'routing' }), 'sending');

		expect(text()).not.toContain('The last check did not find the DKIM records.');
		expect(document.querySelector('.dw-note.warn')).toBeNull();
	});
});
