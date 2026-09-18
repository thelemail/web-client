import { describe, it, expect } from 'vitest';
import {
	canConfirm,
	entryPointVisible,
	formatBytes,
	groupHeading,
	groupsOf,
	ineligibleMessage,
	parseDowngradePreview,
	parseSeverity,
	scheduledLine,
	severityLabel,
	sortImpact,
	storeCancelRequired,
	storeStep,
	targetPlanName
} from './downgrade';
import type { DowngradeFinding, DowngradePreview, Subscription } from '$core/api/billing';

const GIB = 1024 ** 3;

function finding(partial: Partial<DowngradeFinding>): DowngradeFinding {
	return {
		capability: 'storage',
		severity: 'warn',
		title: 'Storage',
		summary: 'summary',
		...partial
	};
}

function preview(partial: Partial<DowngradePreview> = {}): DowngradePreview {
	return {
		eligible: true,
		blocked: false,
		currentPlanCode: 'personal',
		targetPlanCode: 'free',
		findings: [],
		...partial
	};
}

function sub(partial: Partial<Subscription> = {}): Subscription {
	return {
		status: 'active',
		entitled: true,
		cancelAtPeriodEnd: false,
		planCode: 'personal',
		...partial
	};
}

describe('sortImpact', () => {
	it('orders blocker, stops, warn then unaffected', () => {
		const got = sortImpact([
			finding({ capability: 'calendar', severity: 'unaffected' }),
			finding({ capability: 'send_caps', severity: 'warn' }),
			finding({ capability: 'seats', severity: 'blocker' }),
			finding({ capability: 'custom_domains', severity: 'stops' })
		]);
		expect(got.map((f) => f.capability)).toEqual([
			'seats',
			'custom_domains',
			'send_caps',
			'calendar'
		]);
	});

	it('is stable inside a severity', () => {
		const got = sortImpact([
			finding({ capability: 'a', severity: 'warn' }),
			finding({ capability: 'b', severity: 'warn' }),
			finding({ capability: 'c', severity: 'warn' })
		]);
		expect(got.map((f) => f.capability)).toEqual(['a', 'b', 'c']);
	});
});

describe('canConfirm', () => {
	it('is false without a preview', () => {
		expect(canConfirm(null)).toBe(false);
	});

	it('is false when a blocker is present', () => {
		expect(canConfirm(preview({ blocked: true }))).toBe(false);
	});

	it('is false when the workspace is not eligible', () => {
		expect(canConfirm(preview({ eligible: false }))).toBe(false);
	});

	it('stays true when a mailbox is over quota', () => {
		const over = preview({
			findings: [
				finding({
					capability: 'storage',
					severity: 'stops',
					mailboxes: [{ email: 'vlad@thelemail.com', bytesUsed: 41 * GIB, bytesOver: 40 * GIB }]
				})
			]
		});
		expect(canConfirm(over)).toBe(true);
	});
});

describe('parseDowngradePreview', () => {
	it('survives a missing findings array', () => {
		expect(parseDowngradePreview({ eligible: true }).findings).toEqual([]);
	});

	it('keeps an unknown capability with its own words', () => {
		const got = parseDowngradePreview({
			eligible: true,
			findings: [{ capability: 'something_new', severity: 'stops', title: 'New', summary: 'It stops.' }]
		});
		expect(got.findings[0].capability).toBe('something_new');
		expect(got.findings[0].summary).toBe('It stops.');
	});

	it('degrades an unknown severity to warn, never to unaffected', () => {
		const got = parseDowngradePreview({
			eligible: true,
			findings: [{ capability: 'x', severity: 'catastrophic' }]
		});
		expect(got.findings[0].severity).toBe('warn');
	});

	it('derives blocked from the findings when the server omits it', () => {
		const got = parseDowngradePreview({
			eligible: true,
			findings: [{ capability: 'seats', severity: 'blocker' }]
		});
		expect(got.blocked).toBe(true);
	});
});

describe('parseSeverity', () => {
	it('defaults to warn', () => {
		expect(parseSeverity(undefined)).toBe('warn');
		expect(parseSeverity('nonsense')).toBe('warn');
	});

	it('passes known values through', () => {
		expect(parseSeverity('blocker')).toBe('blocker');
		expect(parseSeverity('unaffected')).toBe('unaffected');
	});
});

describe('groups', () => {
	it('labels every severity', () => {
		expect(groupHeading('blocker', 1)).toBe('Sort this out first');
		expect(groupHeading('stops', 2)).toBe('Stops working');
		expect(groupHeading('warn', 3)).toBe('Worth knowing');
		expect(groupHeading('unaffected', 4)).toBe('Stays the same (4)');
	});

	it('omits empty groups', () => {
		const got = groupsOf(
			preview({
				findings: [finding({ severity: 'warn' }), finding({ capability: 'calendar', severity: 'unaffected' })]
			})
		);
		expect(got.map((g) => g.severity)).toEqual(['warn', 'unaffected']);
	});

	it('names each severity for assistive text', () => {
		expect(severityLabel('blocker')).toBe('Action needed');
		expect(severityLabel('unaffected')).toBe('Unaffected');
	});
});

describe('targetPlanName', () => {
	it('never derives the target itself', () => {
		expect(targetPlanName(preview({ targetPlanCode: 'free_family' }))).toBe('Free Family');
		expect(targetPlanName(preview({ targetPlanCode: 'free' }))).toBe('Free');
		expect(targetPlanName(preview({ targetPlanCode: undefined }))).toBe('the free plan');
	});
});

describe('storeStep', () => {
	it('is null for stripe and for a self-managed subscription', () => {
		expect(storeStep(sub({ provider: 'stripe' }))).toBeNull();
		expect(storeStep(sub())).toBeNull();
	});

	it('points apple at the account subscriptions page', () => {
		expect(storeStep(sub({ provider: 'apple' }))).toEqual({
			label: 'App Store',
			url: 'https://apps.apple.com/account/subscriptions'
		});
	});

	it('never names a free product to a store', () => {
		const step = storeStep(sub({ provider: 'google_play', planCode: 'family' }));
		expect(step?.label).toBe('Google Play');
		expect(step?.url).toContain('sku=family');
		expect(step?.url).not.toContain('free');
	});
});

describe('storeCancelRequired', () => {
	it('prefers the server flag', () => {
		expect(storeCancelRequired(preview({ storeCancellationRequired: true }))).toBe(true);
		expect(
			storeCancelRequired(preview({ storeCancellationRequired: false, provider: 'apple' }))
		).toBe(false);
	});

	it('falls back to the provider', () => {
		expect(storeCancelRequired(preview({ provider: 'google_play' }))).toBe(true);
		expect(storeCancelRequired(preview({ provider: 'stripe' }))).toBe(false);
	});
});

describe('entryPointVisible', () => {
	it('hides the entry point without the server flag', () => {
		expect(entryPointVisible(sub())).toBe(false);
		expect(entryPointVisible(sub({ downgradeEligible: false }))).toBe(false);
		expect(entryPointVisible(null)).toBe(false);
	});

	it('hides it on a plan that is already free', () => {
		expect(entryPointVisible(sub({ downgradeEligible: true, planCode: 'free' }))).toBe(false);
		expect(entryPointVisible(sub({ downgradeEligible: true, planCode: 'free_family' }))).toBe(false);
	});

	it('shows it for a paid plan the server marked eligible', () => {
		expect(entryPointVisible(sub({ downgradeEligible: true, planCode: 'family' }))).toBe(true);
	});
});

describe('scheduledLine', () => {
	it('is null when nothing is scheduled', () => {
		expect(scheduledLine(sub())).toBeNull();
	});

	it('names the plan and the date', () => {
		const line = scheduledLine(
			sub({ pendingPlanCode: 'free_family', pendingPlanEffectiveAt: '2026-10-12T09:00:00Z' })
		);
		expect(line).toContain('Free Family');
		expect(line).toContain('2026');
	});

	it('copes with a missing date', () => {
		expect(scheduledLine(sub({ pendingPlanCode: 'free' }))).toBe(
			'Moving to Free when this period ends.'
		);
	});
});

describe('formatBytes', () => {
	it('reads in the largest sensible unit', () => {
		expect(formatBytes(4 * GIB)).toBe('4 GB');
		expect(formatBytes(640 * 1024 ** 2)).toBe('640 MB');
		expect(formatBytes(2048)).toBe('2 KB');
		expect(formatBytes(512)).toBe('512 bytes');
	});

	it('is empty for a missing figure', () => {
		expect(formatBytes(undefined)).toBe('');
	});
});

describe('ineligibleMessage', () => {
	it('is null while the workspace is eligible', () => {
		expect(ineligibleMessage(preview(), 'Gorokhov')).toBeNull();
	});

	it('points a member at the owner', () => {
		const msg = ineligibleMessage(
			preview({ eligible: false, ineligibleReason: 'not_owner' }),
			'Gorokhov'
		);
		expect(msg).toContain('Gorokhov');
		expect(msg).toContain('owner');
	});

	it('explains business separately', () => {
		expect(
			ineligibleMessage(preview({ eligible: false, ineligibleReason: 'no_free_tier' }), 'Acme')
		).toContain('Business');
	});
});
