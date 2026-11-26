import { m } from '$paraglide/messages.js';

export interface AuthSwitch {
	lead: string;
	label: string;
	href: string;
}

type PageUrl = Pick<URL, 'pathname'> & { searchParams: { get(name: string): string | null } };

function carry(url: PageUrl, path: string): string {
	const q = new URLSearchParams();
	for (const key of ['addAccount', 'redirect']) {
		const value = url.searchParams.get(key);
		if (value) q.set(key, value);
	}
	const s = q.toString();
	return s ? `${path}?${s}` : path;
}

export function authSwitch(url: PageUrl): AuthSwitch | null {
	switch (url.pathname) {
		case '/login':
			return { lead: m.auth_switch_new_lead(), label: m.auth_switch_create(), href: carry(url, '/register') };
		case '/register':
			return { lead: m.auth_switch_have_lead(), label: m.auth_switch_sign_in(), href: carry(url, '/login') };
		case '/recover':
			return { lead: m.auth_switch_remembered_lead(), label: m.auth_switch_sign_in(), href: carry(url, '/login') };
		default:
			return null;
	}
}
