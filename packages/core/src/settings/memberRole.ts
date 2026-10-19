import { m } from '$paraglide/messages.js';

export function memberRoleLabel(role: string): string {
	switch (role) {
		case 'owner':
			return m.settings_member_role_owner();
		case 'admin':
			return m.settings_member_role_admin();
		case 'member':
			return m.settings_member_role_member();
		default:
			return role;
	}
}
