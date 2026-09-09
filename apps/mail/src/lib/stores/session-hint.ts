import { browser } from '$app/environment';

const COOKIE_NAME = 'thelemail_session';
const APEX = 'thelemail.com';
const MAX_AGE = 31536000;

export function sessionHintCookie(hostname: string, signedIn: boolean): string | null {
	const attributes = ['Path=/', 'SameSite=Lax'];
	if (hostname === APEX || hostname.endsWith(`.${APEX}`)) {
		attributes.push(`Domain=.${APEX}`, 'Secure');
	} else if (hostname !== 'localhost' && hostname !== '127.0.0.1') {
		return null;
	}
	attributes.push(signedIn ? `Max-Age=${MAX_AGE}` : 'Max-Age=0');
	return `${COOKIE_NAME}=1; ${attributes.join('; ')}`;
}

export function readSessionHint(cookies: string): boolean {
	return cookies.split(';').some((part) => part.trim().startsWith(`${COOKIE_NAME}=`));
}

export function syncSessionHint(signedIn: boolean): void {
	if (!browser) return;
	if (readSessionHint(document.cookie) === signedIn) return;
	const cookie = sessionHintCookie(location.hostname, signedIn);
	if (cookie) document.cookie = cookie;
}
