import type { WorkspaceType } from '$lib/api/workspaces';

export function planLabel(type: WorkspaceType | undefined | null): string {
	switch (type) {
		case 'personal':
			return 'Personal';
		case 'family':
			return 'Family';
		case 'business':
			return 'Business';
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
			return 'Household';
		case 'business':
			return 'Members & seats';
		default:
			return 'This account';
	}
}

export function addMemberLabel(type: WorkspaceType | undefined | null): string {
	return type === 'family' ? 'Add a family member' : 'Add member';
}

export function seatsFullNote(
	type: WorkspaceType | undefined | null,
	total: number | null
): string {
	void total;
	if (type === 'family') {
		return 'All 6 included seats are in use. A larger team needs a Business plan.';
	}
	return 'Inviting another member adds a prorated seat to your subscription.';
}

export function personalNote(): string {
	return 'Personal plans cover one person. There is no one else to manage.';
}
