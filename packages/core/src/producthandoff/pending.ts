import { decodeSlots, type SlotMap } from './slots';

const PENDING_KEY = 'thelemail-authorize';
const LOGIN_TRIED_KEY = 'thelemail-authorize-login';
const ROUTE_KEY = 'thelemail-authorize-route';

const REGISTER_KEYS = ['plan', 'billing', 'src'] as const;

export function registerParams(query: string | null | undefined): string | null {
	if (!query) return null;
	const from = new URLSearchParams(query.replace(/^[?#]/, ''));
	const kept = new URLSearchParams();
	for (const key of REGISTER_KEYS) {
		const value = from.get(key);
		if (value && /^[a-z0-9_-]{1,32}$/i.test(value)) kept.set(key, value);
	}
	const out = kept.toString();
	return out === '' ? null : out;
}

export function takeAuthorizeFragment(): string | null {
	const w = window as unknown as { __thelemailAuthorize?: string };
	const fresh = w.__thelemailAuthorize;
	delete w.__thelemailAuthorize;
	if (fresh) {
		sessionStorage.setItem(PENDING_KEY, fresh);
		return fresh;
	}
	return sessionStorage.getItem(PENDING_KEY);
}

export function authorizeHint(fragment: string | null): string | null {
	if (!fragment) return null;
	const hint = new URLSearchParams(fragment.replace(/^#/, '')).get('hint');
	return hint && hint.length <= 254 && /^[^\s@]+@[^\s@]+$/.test(hint) ? hint : null;
}

export function authorizeIntent(fragment: string | null): 'register' | null {
	if (!fragment) return null;
	return new URLSearchParams(fragment.replace(/^#/, '')).get('intent') === 'register' ? 'register' : null;
}

export function authorizeSlots(fragment: string | null): SlotMap | null {
	if (!fragment) return null;
	return decodeSlots(new URLSearchParams(fragment.replace(/^#/, '')).get('slots'));
}

export function pendingProductSlots(): SlotMap | null {
	return authorizeSlots(sessionStorage.getItem(PENDING_KEY));
}

export function hasPendingAuthorize(): boolean {
	return sessionStorage.getItem(PENDING_KEY) !== null;
}

export function clearPendingAuthorize(): void {
	sessionStorage.removeItem(PENDING_KEY);
	sessionStorage.removeItem(LOGIN_TRIED_KEY);
	sessionStorage.removeItem(ROUTE_KEY);
}

export function authorizeRegisterQuery(fragment: string | null): string {
	if (!fragment) return '';
	const raw = new URLSearchParams(fragment.replace(/^#/, '')).get('register');
	const register = registerParams(raw);
	return register ? `?${register}` : '';
}

export function setAuthorizeRoute(route: string): void {
	sessionStorage.setItem(ROUTE_KEY, route);
}

export function authorizeRoute(): string | null {
	return sessionStorage.getItem(ROUTE_KEY);
}

export function markLoginTried(requestId: string): void {
	sessionStorage.setItem(LOGIN_TRIED_KEY, requestId);
}

export function loginTried(requestId: string): boolean {
	return sessionStorage.getItem(LOGIN_TRIED_KEY) === requestId;
}
