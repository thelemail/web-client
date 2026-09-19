export const LOCALE_COOKIE = 'thelemail_locale';

const APEX = 'thelemail.com';
const MAX_AGE = 31536000;

export function localeCookies(hostname: string, locale: string | null): string[] {
	const value = locale ?? '';
	const age = locale ? MAX_AGE : 0;
	const hostOnly = `${LOCALE_COOKIE}=${value}; Max-Age=${age}; Path=/; SameSite=Lax`;
	if (hostname === APEX || hostname.endsWith(`.${APEX}`)) {
		return [
			`${LOCALE_COOKIE}=; Max-Age=0; Path=/; SameSite=Lax`,
			`${hostOnly}; Domain=.${APEX}; Secure`
		];
	}
	return [hostOnly];
}

export function readLocaleCookie(cookies: string): string | null {
	for (const part of cookies.split(';')) {
		const [name, value] = part.trim().split('=');
		if (name === LOCALE_COOKIE && value) return decodeURIComponent(value);
	}
	return null;
}

export function writeLocaleCookie(locale: string | null): void {
	for (const cookie of localeCookies(location.hostname, locale)) document.cookie = cookie;
}
