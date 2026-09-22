import { describe, it, expect } from 'vitest';
import type {
	CustomDomain,
	CustomDomainCheck,
	CustomDomainCheckResult,
	CustomDomainCheckState
} from '$core/api/customDomains';
import {
	DOMAIN_STEPS,
	canRequestCheck,
	canSend,
	checkRunning,
	domainBadge,
	inboundLive,
	ownershipLapsing,
	ownershipProven,
	reachableStep,
	reasonMessage,
	reasonStage,
	resumeStep,
	stageCheckState,
	stepComplete,
	stepReachable,
	stepRunning,
	usable,
	type CheckStage,
	type DomainStep
} from './steps';

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
const pendingWithProof = domain({ ownershipVerifiedAt: at });
const owned = domain({ status: 'owned', ownershipVerifiedAt: at, actionableStage: 'sending' });
const ownedWithAddresses = domain({ ...owned, addressCount: 2 });
const ready = domain({
	status: 'ready',
	ownershipVerifiedAt: at,
	...sendingFacets,
	actionableStage: null
});
const readyWithAddresses = domain({ ...ready, addressCount: 2, actionableStage: 'routing' });
const live = domain({
	status: 'active',
	ownershipVerifiedAt: at,
	...sendingFacets,
	mxVerifiedAt: at,
	addressCount: 2,
	actionableStage: null
});
const sendingLost = domain({
	...live,
	status: 'failed',
	dkimVerifiedAt: null,
	actionableStage: 'sending'
});
const mxLost = domain({ ...live, status: 'failed', mxVerifiedAt: null, actionableStage: 'routing' });
const lapsing = domain({
	...live,
	ownershipMissingSince: iso(-6 * HOUR),
	releaseAt: iso(42 * HOUR),
	actionableStage: 'ownership'
});
const pausedLive = domain({ ...live, dormantAt: iso(-DAY), actionableStage: null });

const ALL: DomainStep[] = [...DOMAIN_STEPS];

describe('stepReachable', () => {
	it.each([
		['fresh', fresh, ['ownership']],
		['pendingWithProof', pendingWithProof, ['ownership']],
		['owned', owned, ['ownership', 'sending']],
		['ownedWithAddresses', ownedWithAddresses, ['ownership', 'sending']],
		['ready', ready, ['ownership', 'sending', 'recipients']],
		['readyWithAddresses', readyWithAddresses, ['ownership', 'sending', 'recipients', 'routing']],
		['live', live, ALL],
		['sendingLost', sendingLost, ['ownership', 'sending']],
		['mxLost', mxLost, ['ownership', 'sending', 'recipients', 'routing']],
		['lapsing', lapsing, ALL],
		['pausedLive', pausedLive, ALL]
	] as const)('opens only the steps a domain has earned: %s', (_, d, steps) => {
		expect(DOMAIN_STEPS.filter((s) => stepReachable(d, s))).toEqual(steps);
	});

	it('holds back the done step until the domain is live with addresses', () => {
		expect(stepReachable(owned, 'done')).toBe(false);
		expect(stepReachable(domain({ ...live, addressCount: 0 }), 'done')).toBe(false);
		expect(stepReachable(domain({ ...live, mxVerifiedAt: null }), 'done')).toBe(false);
		expect(stepReachable(live, 'done')).toBe(true);
	});
});

describe('stepComplete', () => {
	it('never marks routing done before sending is verified', () => {
		expect(stepComplete(domain({ ...owned, mxVerifiedAt: at }), 'routing')).toBe(false);
	});

	it('never marks recipients done before sending is verified', () => {
		expect(stepComplete(ownedWithAddresses, 'recipients')).toBe(false);
	});

	it('reopens ownership while the ownership record is missing', () => {
		expect(stepComplete(lapsing, 'ownership')).toBe(false);
		expect(stepComplete(live, 'ownership')).toBe(true);
	});

	it('gives a domain without a claim no credit for records it published', () => {
		const d = domain({ ownershipVerifiedAt: at, ...sendingFacets, mxVerifiedAt: at, addressCount: 2 });
		expect(DOMAIN_STEPS.filter((s) => stepComplete(d, s))).toEqual([]);
	});
});

describe('resumeStep', () => {
	it.each([
		['fresh', fresh, 'ownership'],
		['pendingWithProof', pendingWithProof, 'ownership'],
		['owned', owned, 'sending'],
		['ownedWithAddresses', ownedWithAddresses, 'sending'],
		['ready', ready, 'recipients'],
		['readyWithAddresses', readyWithAddresses, 'routing'],
		['live', live, 'done'],
		['sendingLost', sendingLost, 'sending'],
		['mxLost', mxLost, 'routing'],
		['lapsing', lapsing, 'ownership'],
		['pausedLive', pausedLive, 'done']
	] as const)('resumes %s at the step that still needs work', (_, d, step) => {
		expect(resumeStep(d)).toBe(step);
	});
});

describe('reachableStep', () => {
	it('sends a deep link past ownership back to ownership', () => {
		expect(reachableStep(fresh, 'recipients')).toBe('ownership');
		expect(reachableStep(fresh, 'done')).toBe('ownership');
	});

	it('sends an early routing link back to sending', () => {
		expect(reachableStep(owned, 'routing')).toBe('sending');
		expect(reachableStep(owned, 'recipients')).toBe('sending');
	});

	it('sends a routing link without addresses to recipients', () => {
		expect(reachableStep(ready, 'routing')).toBe('recipients');
	});

	it('keeps a reachable step as asked', () => {
		expect(reachableStep(owned, 'sending')).toBe('sending');
		expect(reachableStep(readyWithAddresses, 'routing')).toBe('routing');
		expect(reachableStep(live, 'done')).toBe('done');
	});
});

describe('usage gates', () => {
	it('treats a paused domain as unusable while keeping its setup', () => {
		expect(ownershipProven(pausedLive)).toBe(false);
		expect(canSend(pausedLive)).toBe(false);
		expect(inboundLive(pausedLive)).toBe(false);
		expect(usable(pausedLive)).toBe(false);
		expect(stepReachable(pausedLive, 'done')).toBe(true);
		expect(stepComplete(pausedLive, 'done')).toBe(true);
	});

	it('ignores proof on a domain that holds no claim', () => {
		const d = domain({ ownershipVerifiedAt: at, ...sendingFacets, mxVerifiedAt: at });
		expect(ownershipProven(d)).toBe(false);
		expect(canSend(d)).toBe(false);
		expect(inboundLive(d)).toBe(false);
	});

	it('keeps a lapsing domain sending and receiving until release', () => {
		expect(ownershipLapsing(lapsing)).toBe(true);
		expect(ownershipProven(lapsing)).toBe(true);
		expect(canSend(lapsing)).toBe(true);
		expect(inboundLive(lapsing)).toBe(true);
	});

	it('holds back new addresses until the domain can send and while its ownership record is missing', () => {
		expect(usable(owned)).toBe(false);
		expect(usable(ready)).toBe(true);
		expect(usable(live)).toBe(true);
		expect(usable(lapsing)).toBe(false);
	});

	it('only counts a missing ownership record against a claimed domain', () => {
		expect(ownershipLapsing(live)).toBe(false);
		expect(ownershipLapsing(domain({ ownershipMissingSince: iso(-HOUR) }))).toBe(false);
	});
});

describe('stageCheckState', () => {
	it('reports a running window for its own stage only', () => {
		const d = withCheck(owned, 'sending', 'running');
		expect(stageCheckState(d, 'sending')).toBe('running');
		expect(stageCheckState(d, 'routing')).toBe('idle');
		expect(stageCheckState(d, 'ownership')).toBe('verified');
	});

	it('reports an expired window', () => {
		expect(stageCheckState(withCheck(fresh, 'ownership', 'expired'), 'ownership')).toBe('expired');
	});

	it('prefers verified over a stale window', () => {
		expect(stageCheckState(withCheck(ready, 'sending', 'expired'), 'sending')).toBe('verified');
	});

	it('reports idle before the first press', () => {
		expect(stageCheckState(fresh, 'ownership')).toBe('idle');
	});

	it('opens ownership again while its record is missing', () => {
		expect(stageCheckState(lapsing, 'ownership')).toBe('idle');
		expect(stageCheckState(lapsing, 'sending')).toBe('verified');
	});
});

describe('running checks', () => {
	it('marks only the step whose window is running', () => {
		const d = withCheck(owned, 'sending', 'running');
		expect(checkRunning(d)).toBe(true);
		expect(DOMAIN_STEPS.filter((s) => stepRunning(d, s))).toEqual(['sending']);
	});

	it('marks nothing once the window has expired', () => {
		const d = withCheck(owned, 'sending', 'expired');
		expect(checkRunning(d)).toBe(false);
		expect(DOMAIN_STEPS.filter((s) => stepRunning(d, s))).toEqual([]);
	});
});

describe('canRequestCheck', () => {
	it.each([
		['fresh ownership for a manager', fresh, 'ownership', true, true],
		['fresh ownership for a member', fresh, 'ownership', false, false],
		['fresh sending', fresh, 'sending', true, false],
		['fresh ownership while running', withCheck(fresh, 'ownership', 'running'), 'ownership', true, false],
		['fresh ownership after expiry', withCheck(fresh, 'ownership', 'expired'), 'ownership', true, true],
		['owned sending', owned, 'sending', true, true],
		['owned ownership', owned, 'ownership', true, false],
		['owned sending held back by the server', domain({ ...owned, actionableStage: null }), 'sending', true, false],
		['ready routing', ready, 'routing', true, false],
		['readyWithAddresses routing', readyWithAddresses, 'routing', true, true],
		['live ownership', live, 'ownership', true, false],
		['live sending', live, 'sending', true, false],
		['live routing', live, 'routing', true, false],
		['lapsing ownership', lapsing, 'ownership', true, true],
		['lapsing ownership with a running sending window', withCheck(lapsing, 'sending', 'running'), 'ownership', true, false],
		['pausedLive ownership', pausedLive, 'ownership', true, false],
		['pausedLive sending', pausedLive, 'sending', true, false],
		['pausedLive routing', pausedLive, 'routing', true, false],
		['sendingLost sending', sendingLost, 'sending', true, true],
		['sendingLost routing', sendingLost, 'routing', true, false]
	] as const)(
		'allows one press only where the server says the stage is actionable: %s',
		(_, d, stage, manage, expected) => {
			expect(canRequestCheck(d, stage, manage)).toBe(expected);
		}
	);
});

describe('domainBadge', () => {
	it('names the stage being verified', () => {
		expect(domainBadge(withCheck(owned, 'sending', 'running'))).toEqual({
			label: 'Verifying sending',
			kind: 'info'
		});
		expect(domainBadge(withCheck(fresh, 'ownership', 'running')).label).toBe('Verifying ownership');
		expect(domainBadge(withCheck(readyWithAddresses, 'routing', 'running')).label).toBe('Verifying MX');
	});

	it('flags an expired check', () => {
		expect(domainBadge(withCheck(fresh, 'ownership', 'expired'))).toEqual({
			label: 'Check expired',
			kind: 'warn'
		});
	});

	it('puts a missing ownership record first', () => {
		expect(domainBadge(domain({ ...lapsing, dormantAt: iso(-HOUR) }))).toEqual({
			label: 'Ownership record missing',
			kind: 'warn'
		});
	});

	it('says a paused domain is paused', () => {
		expect(domainBadge(pausedLive)).toEqual({ label: 'Paused', kind: 'warn' });
	});

	it('falls back to the setup status', () => {
		expect(domainBadge(live)).toEqual({ label: 'Live', kind: 'ok' });
		expect(domainBadge(fresh)).toEqual({ label: 'Not started', kind: 'neutral' });
	});
});

const REASON_STAGE = {
	ownership_missing: 'ownership',
	ownership_mismatch: 'ownership',
	ownership_wildcard: 'ownership',
	claimed_elsewhere: 'ownership',
	dkim_missing: 'sending',
	dkim_mismatch: 'sending',
	spf_missing: 'sending',
	spf_mismatch: 'sending',
	dmarc_missing: 'sending',
	mx_missing: 'routing',
	mx_mismatch: 'routing',
	dns_unavailable: null
} satisfies Record<CustomDomainCheckResult, CheckStage | null>;

const UNKNOWN_REASON = 'The last check did not find the records.';

describe('reasons', () => {
	it('explains known reasons and falls back for new ones', () => {
		expect(reasonMessage('claimed_elsewhere')).toBe('Another workspace has already verified this domain.');
		expect(reasonMessage('ownership_wildcard')).toBe(
			'The last check found the ownership record through a wildcard or catch-all DNS entry. Publish it as its own TXT record at this host.'
		);
		expect(reasonMessage('dkim_missing')).toBe('The last check did not find the DKIM records.');
		expect(reasonMessage('brand_new')).toBe(UNKNOWN_REASON);
		expect(reasonMessage(null)).toBeNull();
		expect(reasonMessage(undefined)).toBeNull();
		expect(reasonMessage('')).toBeNull();
	});

	it('has its own copy for every reason the server sends', () => {
		const codes = Object.keys(REASON_STAGE);
		const copy = codes.map((c) => reasonMessage(c));
		expect(copy).not.toContain(UNKNOWN_REASON);
		expect(copy).not.toContain(null);
		expect(new Set(copy).size).toBe(codes.length);
	});

	it.each(Object.entries(REASON_STAGE))('ties %s to its stage', (code, stage) => {
		expect(reasonStage(code)).toBe(stage);
	});

	it('ties unknown and empty reasons to no stage', () => {
		expect(reasonStage('brand_new')).toBeNull();
		expect(reasonStage(null)).toBeNull();
		expect(reasonStage(undefined)).toBeNull();
	});
});
