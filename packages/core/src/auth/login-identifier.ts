import { isEmail } from '$core/email';

export function loginIdentifier(value: string): string {
	return value.trim();
}

export function isLoginIdentifier(value: string): boolean {
	return isEmail(value);
}
