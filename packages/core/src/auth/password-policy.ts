import { m } from '$paraglide/messages.js';

export function strengthLabel(score: number): string {
	switch (score) {
		case 1:
			return m.auth_password_strength_weak();
		case 2:
			return m.auth_password_strength_fair();
		case 3:
			return m.auth_password_strength_good();
		case 4:
			return m.auth_password_strength_strong();
		default:
			return '';
	}
}

export function scorePassword(p: string): number {
	let s = 0;
	if (p.length >= 8) s++;
	if (p.length >= 12) s++;
	if (/[a-z]/.test(p) && /[A-Z]/.test(p)) s++;
	if (/\d/.test(p) && /[^A-Za-z0-9]/.test(p)) s++;
	return Math.min(s, 4);
}

export interface PasswordReq {
	k: string;
	label: string;
	met: boolean;
}

export function passwordReqs(p: string): PasswordReq[] {
	return [
		{ k: 'len', label: m.auth_password_req_length(), met: p.length >= 8 },
		{ k: 'mix', label: m.auth_password_req_mixed_case(), met: /[a-z]/.test(p) && /[A-Z]/.test(p) },
		{ k: 'num', label: m.auth_password_req_number_symbol(), met: /\d/.test(p) || /[^A-Za-z0-9]/.test(p) }
	];
}
