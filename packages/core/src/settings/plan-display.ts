import { m } from '$paraglide/messages.js';
import type { Plan, PlanCode } from '$core/api/billing';
import { formatBytes } from '$core/lifecycle/downgrade';
import { platformDomains } from '$core/stores/platformDomains.svelte';
import type { WorkspaceType } from '$core/api/workspaces';

export function planLabel(type: WorkspaceType | undefined | null, planCode?: string | null): string {
	if (planCode === 'free_family') return m.settings_plan_free_family();
	if (planCode === 'free') return m.settings_plan_free();
	switch (type) {
		case 'personal':
			return m.settings_plan_personal();
		case 'family':
			return m.settings_plan_family();
		case 'business':
			return m.settings_plan_business();
		default:
			return '';
	}
}

export function seatLimitFor(
	plan: Plan | null | undefined,
	subscribedSeats: number | null = null
): number | null {
	if (!plan) return null;
	if (plan.pricingModel === 'per_mailbox') return subscribedSeats;
	return plan.maxSeats ?? null;
}

export function isInvitable(type: WorkspaceType | undefined | null): boolean {
	return type === 'family' || type === 'business';
}

export function membershipTitle(type: WorkspaceType | undefined | null): string {
	switch (type) {
		case 'family':
			return m.settings_member_title_family();
		case 'business':
			return m.settings_member_title_business();
		default:
			return m.settings_member_title_personal();
	}
}

export function addMemberLabel(type: WorkspaceType | undefined | null): string {
	return type === 'family' ? m.settings_member_add_family() : m.settings_member_add();
}

export function seatsFullNote(
	type: WorkspaceType | undefined | null,
	total: number | null,
	planCode?: PlanCode | null
): string | null {
	if (type === 'family') {
		if (total == null) return null;
		return planCode === 'free_family'
			? m.settings_member_seats_full_free_family({ seats: total })
			: m.settings_member_seats_full_family({ seats: total });
	}
	return m.settings_member_seats_prorated();
}

export function personalNote(): string {
	return m.settings_member_personal_note();
}

export function freeNote(
	type: WorkspaceType | null | undefined,
	planCode: PlanCode | null | undefined,
	plan: Plan | null | undefined
): string | null {
	if (!plan) return null;
	const storage = formatBytes(plan.storageBytesPerMailbox);
	const domain = platformDomains.default;
	if (planCode === 'free_family' || (type === 'family' && planCode !== 'free')) {
		if (plan.maxSeats == null) return null;
		return m.settings_plan_free_family_note({ seats: plan.maxSeats, domain, storage });
	}
	return m.settings_plan_free_note({ domain, storage });
}
