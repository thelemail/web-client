import { m } from '$paraglide/messages.js';
import type { PlanCode } from '$core/api/billing';
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
	type: WorkspaceType | undefined | null,
	subscribedSeats: number | null = null
): number | null {
	switch (type) {
		case 'personal':
			return 1;
		case 'family':
			return 6;
		case 'business':
			return subscribedSeats;
		default:
			return null;
	}
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
): string {
	void total;
	if (type === 'family' && planCode === 'free_family') {
		return m.settings_member_seats_full_free_family();
	}
	if (type === 'family') {
		return m.settings_member_seats_full_family();
	}
	return m.settings_member_seats_prorated();
}

export function personalNote(): string {
	return m.settings_member_personal_note();
}

export function freeNote(type?: WorkspaceType | null, planCode?: PlanCode | null): string {
	if (planCode === 'free_family' || (type === 'family' && planCode !== 'free')) {
		return m.settings_plan_free_family_note();
	}
	return m.settings_plan_free_note();
}
