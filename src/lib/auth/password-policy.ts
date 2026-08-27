export const STRENGTH_LABELS = ['', 'weak', 'fair', 'good', 'strong'];

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
		{ k: 'len', label: 'At least 8 characters', met: p.length >= 8 },
		{ k: 'mix', label: 'Upper & lowercase letters', met: /[a-z]/.test(p) && /[A-Z]/.test(p) },
		{ k: 'num', label: 'A number or symbol', met: /\d/.test(p) || /[^A-Za-z0-9]/.test(p) }
	];
}
