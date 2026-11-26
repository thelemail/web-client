import { m } from '$paraglide/messages.js';
import list from './common-passwords.txt?raw';

export const PASSWORD_MIN_LENGTH = 12;

const common = new Set(list.split('\n').filter(Boolean));

export function passwordLength(p: string): number {
	return [...p].length;
}

export function isCommonPassword(p: string): boolean {
	return common.has(p.toLowerCase());
}

export interface PasswordReq {
	k: string;
	label: string;
	met: boolean;
}

export function passwordReqs(p: string): PasswordReq[] {
	return [
		{
			k: 'len',
			label: m.auth_password_req_length({ count: PASSWORD_MIN_LENGTH }),
			met: passwordLength(p) >= PASSWORD_MIN_LENGTH
		},
		{ k: 'common', label: m.auth_password_req_not_common(), met: p !== '' && !isCommonPassword(p) }
	];
}

export function passwordStrength(p: string): 0 | 1 | 2 | 3 | 4 {
	if (!p) return 0;
	const length = passwordLength(p);
	if (length < PASSWORD_MIN_LENGTH) return length < 8 ? 1 : 2;
	if (isCommonPassword(p)) return 1;
	const classes = [/[a-z]/, /[A-Z]/, /[0-9]/, /[^a-zA-Z0-9]/].filter((r) => r.test(p)).length;
	return length >= 16 || classes >= 3 ? 4 : 3;
}
