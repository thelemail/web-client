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
